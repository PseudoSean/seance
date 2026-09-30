// The app's one TranslateService: the real worker (or the in-page fake on
// a development build opened with ?fakeTranslate), the deploy's
// config.json, the store's settings and the store's translation slice.
// Created on first use, so a page that never translates never pays.

import {getBranding} from "../branding";
import {BUILD} from "../build";
import {store} from "../store";
import {probeOnce} from "./capability";
import {emptyContext} from "./engine";
import {TranslateClient} from "./client";
import {FAKE_CAPABILITY, fakePort} from "./fakePort";
import {buildCatalog} from "./models";
import {MainPort} from "./protocol";
import {RouteTable} from "./router";
import {ServiceDeps, TranslateService} from "./service";

// Captured at module load (vue.ts imports the router, which statically
// imports Settings/Translation.vue, before `boot()` runs) rather than read
// inside useFake(): boot.ts's handleQueryParams() strips the page's query
// string on every load, and the service is created lazily, well after that
// — reading window.location.search at call time would never see the flag.
// Declared above every export so no caller, however early, can reach it
// before it is initialized.
const initialSearch = window.location.search;

let service: TranslateService | null = null;
let usage: (() => boolean) | null = null;

/**
 * What says translation is in use (reader.ts `translationInUse`): once it
 * is not and nothing is in flight, the service unloads every model at once.
 * Registered before the service exists (initReader runs at boot) and handed
 * to it when it is created.
 */
export function setTranslationUsage(inUse: () => boolean): void {
	usage = inUse;
	service?.setInUse(inUse);
}

export function translateService(): TranslateService {
	if (!service) {
		service = create();
	}

	return service;
}

function useFake(): boolean {
	return BUILD === "dev" && new URLSearchParams(initialSearch).has("fakeTranslate");
}

function workerUrl(): string {
	return new URL(`js/translate-worker.js?v=${BUILD}`, document.baseURI).href;
}

/** Whether the user's stored settings carry `name` at all (a default is not a choice). */
function create(): TranslateService {
	const branding = getBranding().translation ?? {};
	const fake = useFake();
	const deps: ServiceDeps = {
		createClient() {
			if (fake) {
				const {port, terminate} = fakePort();

				return {client: new TranslateClient(port), terminate};
			}

			const worker = new Worker(workerUrl());

			return {
				client: new TranslateClient(worker as unknown as MainPort),
				terminate: () => worker.terminate(),
			};
		},
		probe: () => (fake ? Promise.resolve(FAKE_CAPABILITY) : probeOnce()),
		setTimeout: (fn, ms) => window.setTimeout(fn, ms),
		clearTimeout: (handle) => window.clearTimeout(handle as number),
	};
	// An unset GPU model ("") is no choice: it resolves every time it is read
	// — the deploy's model, else what the device probe fits, else the shipped
	// default (models.ts `llmChoice`) — so a later deploy default, and a
	// device the probe has since measured, both reach everyone who never
	// picked one. Nothing writes a resolved id back to the settings.
	const selectedLlm = store.state.settings.translateLlmModel || null;
	const catalog = buildCatalog(branding, selectedLlm);
	const created = new TranslateService(
		deps,
		{
			catalog,
			selectedLlm,
			routes: (branding.routes ?? {}) as RouteTable,
			ortBase: new URL("js/ort/", document.baseURI).href,
			enabled: branding.enabled !== false,
		},
		{llm: store.state.settings.translateLlm, cpu: store.state.settings.translateCpu}
	);

	store.watch(
		() =>
			[store.state.settings.translateLlm, store.state.settings.translateCpu] as [
				boolean,
				boolean
			],
		([llm, cpu]) => created.setSettings({llm, cpu})
	);
	// A switch takes effect at once (service.ts `setLlmModel`): the old model
	// unloads once its running requests are done, later requests route anew.
	store.watch(
		() => store.state.settings.translateLlmModel,
		(id: string) => created.setLlmModel(id)
	);

	if (usage) {
		created.setInUse(usage);
	}

	// A channel switched off, a composer strip closed: the store state the
	// usage reads is reactive, so a change asks again (a queue draining asks
	// through reader.ts).
	store.watch(
		() => (usage ? usage() : true),
		(inUse: boolean) => {
			if (!inUse) {
				created.usageChanged();
			}
		}
	);
	created.onModels((models) => store.commit("translationModels", models));
	created.onWorkerError((message) => store.commit("translationWorkerError", message));
	// The service resolves an unset choice against the probe itself once it
	// lands (service.ts `capabilities`), and the store's capability is what
	// Settings reads it through: the pick is never persisted as a choice.
	void created.capabilities().then((capability) => {
		store.commit("translationCapability", capability);
	});
	window.addEventListener("pagehide", () => created.pagehide());

	return created;
}

// Development aid until plan 2 wires the channel switch: from the console,
// `await seanceTranslate("Hallo Welt", "en", "de")` returns the translation;
// pass `console.log` as the fourth argument to watch it stream. `from` null
// leaves the source to the LLM (the seq2seq engines need it).
if (BUILD === "dev") {
	(window as unknown as {seanceTranslate: unknown}).seanceTranslate = async (
		text: string,
		to: string,
		from: string | null = null,
		onChunk: (text: string, done: boolean) => void = () => {}
	): Promise<string> => {
		let last = "";

		for await (const chunk of translateService().translate({
			text,
			from,
			to,
			purpose: "read",
			context: emptyContext(),
		})) {
			last = chunk.text;
			onChunk(chunk.text, chunk.done);
		}

		return last;
	};
}
