// The worker's side of the protocol: one handler per message, the engines
// behind it. A translate request loads its model first when the engine does
// not have it (the page's service also loads explicitly, for Settings). A
// cancel aborts the request's signal; the engine stops at its next chunk.
// Nothing here knows about the libraries: worker-entry.ts hands in the real
// engines, tests and fakePort.ts hand in scripted ones.

import {Engine, EngineName} from "./engine";
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
	let catalog: ModelCatalog | null = null;

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
				catalog = message.catalog;
				deps.configure(message.catalog, message.ortBase);
				break;
			case "load": {
				const engine = engines[message.ref.engine];

				try {
					await engine.load(message.ref, (progress) =>
						port.postMessage({type: "progress", ref: message.ref, progress})
					);
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
				await engines[message.engine].unload();
				port.postMessage({type: "unloaded", engine: message.engine});
				break;
			case "translate": {
				const engine = engines[message.ref.engine];
				const controller = new AbortController();

				controllers.set(message.req.id, controller);

				try {
					if (!engine.isLoaded(message.ref.id)) {
						await engine.load(message.ref, (progress) =>
							port.postMessage({type: "progress", ref: message.ref, progress})
						);
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
				port.postMessage({type: "status", engines: snapshot()});
				break;
			case "models":
				port.postMessage({
					type: "models",
					models: catalog ? await cacheStates(catalog, deps.cache) : [],
				});
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
