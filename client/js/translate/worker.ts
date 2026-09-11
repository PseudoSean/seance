// The worker's side of the protocol: one handler per message, the engines
// behind it. A translate request loads its model first when the engine does
// not have it (the page's service also loads explicitly, for Settings). A
// cancel aborts the request's signal; the engine stops at its next chunk.
// Nothing here knows about the libraries: worker-entry.ts hands in the real
// engines, tests and fakePort.ts hand in scripted ones.

import {Engine, EngineName, ModelRef} from "./engine";
import {CacheApi, ModelCatalog, cacheStates} from "./models";
import {EngineSnapshot, MainToWorker, WorkerPort, errorMessage} from "./protocol";

export interface EngineSet {
	llm: Engine;
	seq2seq: Engine;
}

export interface WorkerDeps {
	/** The libraries' global configuration (mirror base, ORT wasm path). */
	configure(catalog: ModelCatalog, ortBase: string): void;
	cache: CacheApi;
}

export function serveEngines(port: WorkerPort, engines: EngineSet, deps: WorkerDeps): () => void {
	const controllers = new Map<number, AbortController>();
	const loading = new Map<string, Promise<void>>();
	let catalog: ModelCatalog | null = null;

	// A model has two ways in — Settings' explicit `load` and the implicit one
	// a `translate` needs — and they can ask for the same model at once, so the
	// second joins the first rather than starting a second download. Progress
	// is posted once per report and client.ts fans it out to the `load` caller
	// and to every stream waiting on that model.
	const load = (ref: ModelRef): Promise<void> => {
		const inFlight = loading.get(ref.id);

		if (inFlight) {
			return inFlight;
		}

		const promise = engines[ref.engine]
			.load(ref, (progress) => port.postMessage({type: "progress", ref, progress}))
			.finally(() => loading.delete(ref.id));

		loading.set(ref.id, promise);

		return promise;
	};

	const snapshot = (): Record<EngineName, EngineSnapshot> => ({
		llm: {status: engines.llm.status(), models: engines.llm.loadedModels()},
		seq2seq: {
			status: engines.seq2seq.status(),
			models: engines.seq2seq.loadedModels(),
			threads: engines.seq2seq.capabilities().threads,
		},
	});

	const handle = async (message: MainToWorker): Promise<void> => {
		switch (message.type) {
			case "configure":
				try {
					catalog = message.catalog;
					deps.configure(message.catalog, message.ortBase);
				} catch (e) {
					port.postMessage({type: "error", scope: "worker", message: errorMessage(e)});
				}

				break;

			case "load": {
				try {
					await load(message.ref);
					port.postMessage({type: "loaded", ref: message.ref});
				} catch (e) {
					port.postMessage({
						type: "error",
						scope: "load",
						ref: message.ref,
						message: errorMessage(e),
					});
				}

				break;
			}

			case "unload":
				try {
					await engines[message.engine].unload();
					port.postMessage({type: "unloaded", engine: message.engine});
				} catch (e) {
					port.postMessage({
						type: "error",
						scope: "unload",
						engine: message.engine,
						message: errorMessage(e),
					});
				}

				break;

			case "translate": {
				const engine = engines[message.ref.engine];
				const controller = new AbortController();

				controllers.set(message.req.id, controller);

				try {
					if (!engine.isLoaded(message.ref.id)) {
						try {
							await load(message.ref);
						} catch (e) {
							// The model could not load: that is the model's
							// failure, not this request's, and the page tells
							// the two apart by the scope (the id says which
							// stream to fail).
							if (!controller.signal.aborted) {
								port.postMessage({
									type: "error",
									scope: "load",
									id: message.req.id,
									ref: message.ref,
									message: errorMessage(e),
								});
							}

							return;
						}
					}

					for await (const chunk of engine.translate(message.req, controller.signal)) {
						if (controller.signal.aborted) {
							break;
						}

						port.postMessage({type: "chunk", chunk});
					}

					if (!controller.signal.aborted) {
						port.postMessage({type: "done", id: message.req.id});
					}
				} catch (e) {
					if (!controller.signal.aborted) {
						port.postMessage({
							type: "error",
							scope: "translate",
							id: message.req.id,
							ref: message.ref,
							message: errorMessage(e),
						});
					}
				} finally {
					controllers.delete(message.req.id);
				}

				break;
			}

			case "cancel":
				controllers.get(message.id)?.abort();
				break;
			case "status":
				try {
					port.postMessage({type: "status", engines: snapshot()});
				} catch (e) {
					port.postMessage({type: "error", scope: "status", message: errorMessage(e)});
				}

				break;
			case "models":
				try {
					port.postMessage({
						type: "models",
						models: catalog ? await cacheStates(catalog, deps.cache) : [],
					});
				} catch (e) {
					port.postMessage({type: "error", scope: "models", message: errorMessage(e)});
				}

				break;
			case "delete":
				try {
					await deps.cache.delete(message.ref);
					port.postMessage({type: "deleted", ref: message.ref});
				} catch (e) {
					port.postMessage({
						type: "error",
						scope: "delete",
						ref: message.ref,
						message: errorMessage(e),
					});
				}

				break;
		}
	};

	port.onmessage = (event) => {
		handle(event.data).catch((e) =>
			port.postMessage({type: "error", scope: "worker", message: errorMessage(e)})
		);
	};

	return () => {
		port.onmessage = null;

		for (const controller of controllers.values()) {
			controller.abort();
		}
	};
}
