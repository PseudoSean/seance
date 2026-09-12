// A worker that never leaves the page, for `?fakeTranslate` on a
// development build (index.ts) and for tools/scenarios/translate-*.mjs:
// scripted engines that "download" over a few hundred milliseconds,
// remember what was downloaded in memory, and translate by echoing the
// text behind the target language's name, word by word. Vue-free so a
// mocha test can pin its shape.
//
// index.ts reaches this module behind `BUILD === "dev"`, and webpack
// folds it out of a production build: `NODE_ENV=production yarn build`
// ships neither the scripted engines nor the request log (grep
// `public/js/*.js` for `__seanceTranslateFake` to check).

import {
	Engine,
	EngineCapabilities,
	EngineName,
	EngineStatus,
	LoadProgress,
	ModelRef,
	TranslateChunk,
	TranslateRequest,
} from "./engine";
import {languageName} from "./languages";
import {Capability} from "./capability";
import {MainPort, createPortPair} from "./protocol";
import {END_SENTINEL} from "./prompt";
import {serveEngines} from "./worker";

export const FAKE_CAPABILITY: Capability = {
	tier: "gpu",
	reasons: [],
	f16: true,
	maxBufferBytes: 4 * 1024 * 1024 * 1024,
	deviceMemoryGiB: 8,
	storageQuotaBytes: 50 * 1024 * 1024 * 1024,
};

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The token a request's text (or any of its lines) can carry to fail once:
 *  browser scenarios exercise the failed-line/retry UI without a real
 *  engine ever failing. */
const FAIL_TOKEN = "[fail]";
/** The token a request's text (or any of its lines) can carry to come back
 *  as it went in: browser scenarios exercise the echo rule (outgoing.ts
 *  `isUnchanged`) without a real model ever declining to translate. Like
 *  `[fail]`'s, the token itself stays in the answer — what an echo drops is
 *  the `[Language]` prefix the fake otherwise puts in front, since an
 *  answer differing from the text by anything at all would not be one. */
const ECHO_TOKEN = "[echo]";

interface TranslateFakeRequestLog {
	id: number;
	model: string;
	text: string;
	purpose: "read" | "write";
	lines: number;
	/** The source the request asked for: null when it was left to the engine. */
	from: string | null;
	to: string;
	engine: EngineName;
	/** The marker form the route chose (spans.ts `renderMarkers`). */
	markers: string;
}

interface TranslateFakeGlobal {
	requests: TranslateFakeRequestLog[];
}

declare global {
	// eslint-disable-next-line no-var
	var __seanceTranslateFake: TranslateFakeGlobal | undefined;
}

function logRequest(req: TranslateRequest, engine: EngineName): void {
	const g = (globalThis.__seanceTranslateFake ??= {requests: []});

	g.requests.push({
		id: req.id,
		model: req.model,
		text: req.text,
		purpose: req.purpose,
		lines: req.lines ? req.lines.length : 0,
		from: req.from,
		to: req.to,
		engine,
		markers: req.markers ?? "placeholder",
	});
}

class ScriptedEngine implements Engine {
	readonly name: "llm" | "seq2seq";
	private stepMs: number;
	private loaded: string[] = [];
	private state: EngineStatus = "cold";
	/** Texts this engine has already failed once, so a retry succeeds. */
	private failedOnce = new Set<string>();

	constructor(name: "llm" | "seq2seq", stepMs: number) {
		this.name = name;
		this.stepMs = stepMs;
	}

	async load(ref: ModelRef, onProgress: (p: LoadProgress) => void): Promise<void> {
		this.state = "loading";

		for (let i = 1; i <= 10; i++) {
			await wait(this.stepMs);
			onProgress({fraction: i / 10, text: `shard ${i} of 10`});
		}

		this.loaded = this.name === "llm" ? [ref.id] : [...this.loaded, ref.id];
		this.state = "ready";
	}

	unload(): Promise<void> {
		this.loaded = [];
		this.state = "cold";

		return Promise.resolve();
	}

	status(): EngineStatus {
		return this.state;
	}

	loadedModels(): string[] {
		return [...this.loaded];
	}

	isLoaded(id: string): boolean {
		return this.loaded.includes(id);
	}

	capabilities(): EngineCapabilities {
		return {streams: this.name === "llm", batches: this.name === "llm", threads: false};
	}

	async *translate(req: TranslateRequest, signal: AbortSignal): AsyncIterable<TranslateChunk> {
		if (!this.isLoaded(req.model)) {
			throw new Error(`model not loaded: ${req.model}`);
		}

		logRequest(req, this.name);

		const failKey = req.lines ? req.lines.join("\n") : req.text;

		if (failKey.includes(FAIL_TOKEN) && !this.failedOnce.has(failKey)) {
			this.failedOnce.add(failKey);
			throw new Error("scripted failure");
		}

		const echoing = failKey.includes(ECHO_TOKEN);

		if (req.lines) {
			let text = "";

			for (let i = 0; i < req.lines.length; i++) {
				if (signal.aborted) {
					return;
				}

				await wait(this.stepMs);

				const line = echoing
					? `${i + 1}. ${req.lines[i]}`
					: `${i + 1}. [${languageName(req.to)}] ${req.lines[i]}`;

				text = text ? `${text}\n${line}` : line;
				yield {id: req.id, text, done: false};
			}

			if (signal.aborted) {
				return;
			}

			yield {id: req.id, text: `${text}\n${END_SENTINEL}`, done: true};
			return;
		}

		const words = (echoing ? req.text : `[${languageName(req.to)}] ${req.text}`).split(" ");
		let text = "";

		for (const word of words) {
			if (signal.aborted) {
				return;
			}

			await wait(this.stepMs);
			text = text ? `${text} ${word}` : word;
			yield {id: req.id, text, done: false};
		}

		yield {id: req.id, text, done: true};
	}
}

export function fakePort(options: {stepMs?: number} = {}): {port: MainPort; terminate: () => void} {
	const stepMs = options.stepMs ?? 120;
	const [mainPort, workerPort] = createPortPair();
	const cached = new Set<string>();
	const stop = serveEngines(
		workerPort,
		{llm: new ScriptedEngine("llm", stepMs), seq2seq: new ScriptedEngine("seq2seq", stepMs)},
		{
			configure() {},
			cache: {
				has(ref) {
					return Promise.resolve(cached.has(ref.id));
				},
				delete(ref) {
					cached.delete(ref.id);

					return Promise.resolve();
				},
			},
		}
	);
	// a "downloaded" model is one that was loaded once
	const originalOnMessage = workerPort.onmessage;

	workerPort.onmessage = (event) => {
		if (event.data.type === "load" || event.data.type === "translate") {
			cached.add(event.data.ref.id);
		}

		originalOnMessage?.(event);
	};

	return {port: mainPort, terminate: stop};
}
