// The app's one TranslateService: the real worker (or the in-page fake on
// a development build opened with ?fakeTranslate), the deploy's
// config.json, the store's settings and the store's translation slice.
// Created on first use, so a page that never translates never pays.

import {getBranding} from "../branding";
import {BUILD} from "../build";
import storage from "../localStorage";
import {store} from "../store";
import {probeOnce} from "./capability";
import {emptyContext} from "./engine";
import {TranslateClient} from "./client";
import {FAKE_CAPABILITY, fakePort} from "./fakePort";
import {isSupported} from "./languages";
import {buildCatalog} from "./models";
import {MainPort} from "./protocol";
import {RouteTable, mergeRoutes} from "./router";
import {DEFAULT_ROUTES} from "./routes.default";
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

// The deploy's default reading target (branding.translation.defaultTarget)
// only applies while the user has never chosen one. settings.ts computes
// its `translateTo` default at import time, before config.json is fetched,
// so it cannot see the branding value; this runs after the service (and so
// after getBranding() has something to read) and, the first time only,
// dispatches the same action Settings uses so the choice persists like any
// other user setting.
function applyDefaultTarget(defaultTarget: string | undefined): void {
	if (!defaultTarget || !isSupported(defaultTarget)) {
		return;
	}

	let stored: Record<string, unknown> = {};

	try {
		stored = JSON.parse(storage.get("settings") || "{}");
	} catch (e) {
		stored = {};
	}

	if (!Object.prototype.hasOwnProperty.call(stored, "translateTo")) {
		void store.dispatch("settings/update", {name: "translateTo", value: defaultTarget});
	}
}

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
	const created = new TranslateService(
		deps,
		{
			catalog: buildCatalog(branding),
			routes: mergeRoutes(DEFAULT_ROUTES, (branding.routes ?? {}) as RouteTable),
			ortBase: new URL("js/ort/", document.baseURI).href,
			enabled: branding.enabled !== false,
		},
		{llm: store.state.settings.translateLlm, cpu: store.state.settings.translateCpu}
	);

	applyDefaultTarget(branding.defaultTarget);

	store.watch(
		() =>
			[store.state.settings.translateLlm, store.state.settings.translateCpu] as [
				boolean,
				boolean
			],
		([llm, cpu]) => created.setSettings({llm, cpu})
	);
	created.onModels((models) => store.commit("translationModels", models));
	created.onWorkerError((message) => store.commit("translationWorkerError", message));
	void created
		.capabilities()
		.then((capability) => store.commit("translationCapability", capability));
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
