import {expect} from "chai";
import sinon from "ts-sinon";
import {
	emptyContext,
	type TranslateChunk,
	type TranslateRequest,
} from "../../client/js/translate/engine";
import {
	ABORTED,
	TERM_MAX_WORDS,
	TIMED_OUT,
	WRITE_DETECT_MIN_GAP,
	WRITE_TIMEOUT_MS,
	draftGate,
	reverseTarget,
	termPair,
	translateDraft,
	writeSource,
	type OutgoingDeps,
	type OutgoingRequest,
} from "../../client/js/translate/outgoing";
import {protect} from "../../client/js/translate/spans";

type Req = Omit<TranslateRequest, "id" | "model">;
type Script = (req: Req) => string[] | Error;

function rig(script: Script) {
	const clock = sinon.useFakeTimers();
	const requests: Req[] = [];
	const signals: AbortSignal[] = [];
	const deps: OutgoingDeps = {
		translate(req, signal) {
			requests.push(req);
			signals.push(signal);

			return (async function* (): AsyncIterable<TranslateChunk> {
				await Promise.resolve();
				const out = script(req);

				if (out instanceof Error) {
					throw out;
				}

				for (const text of out) {
					if (signal.aborted) {
						return;
					}

					yield {id: 0, text, done: false};
				}

				yield {id: 0, text: out[out.length - 1], done: true};
			})();
		},
		setTimeout: (fn, ms) => setTimeout(fn, ms),
		clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout),
	};

	return {clock, requests, signals, deps};
}

function request(overrides: Partial<OutgoingRequest> = {}): OutgoingRequest {
	return {
		text: "please keep the log",
		from: "en",
		to: "de",
		purpose: "write",
		context: emptyContext(),
		batches: true,
		...overrides,
	};
}

/** The fake's shape: the target in brackets, then the text as given. */
const echo: Script = (req) =>
	req.lines
		? [
				`1. [de] ${req.lines[0]}`,
				req.lines.map((l, i) => `${i + 1}. [de] ${l}`).join("\n") + "\nEND",
		  ]
		: [`[de]`, `[de] ${req.text}`];

describe("translate/outgoing", () => {
	afterEach(() => sinon.restore());

	describe("draftGate", () => {
		it("lets text through and stops commands, edits and empty drafts", () => {
			expect(draftGate("hello there", false)).to.equal("ok");
			expect(draftGate("//not a command", false)).to.equal("ok");
			expect(draftGate("/me waves", false)).to.equal("command");
			expect(draftGate("/connect", false)).to.equal("command");
			expect(draftGate("hello there", true)).to.equal("edit");
			expect(draftGate("   \n", false)).to.equal("empty");
		});
	});

	describe("writeSource and reverseTarget", () => {
		it("trusts the reading language for an unplaced draft, then nobody", () => {
			expect(writeSource({lang: null, confidence: 0}, "en", "de")).to.equal("en");
			expect(writeSource({lang: null, confidence: 0}, "de", "de")).to.equal(null);
		});

		it("trusts a verdict that agrees with the reading language outright", () => {
			expect(writeSource({lang: "en", confidence: 0.05}, "en", "de")).to.equal("en");
		});

		it("falls back to the reading language when a differing verdict is weak", () => {
			// An English draft the detector calls Italian at a weak 0.12: not
			// sure enough to override the reading language.
			expect(writeSource({lang: "it", confidence: 0.12}, "en", "de")).to.equal("en");
		});

		it("trusts a differing verdict once it clears WRITE_DETECT_MIN_GAP", () => {
			expect(WRITE_DETECT_MIN_GAP).to.equal(0.3);
			expect(writeSource({lang: "it", confidence: 0.4}, "en", "de")).to.equal("it");
			expect(
				writeSource({lang: "it", confidence: WRITE_DETECT_MIN_GAP}, "en", "de")
			).to.equal("it");
		});

		// "From German into German" is a request the model answers by handing
		// the line back, so where the reading language is the write target
		// there is nothing to fall back to: the source is left to the LLM.
		it("never falls back to the reading language when that is the target", () => {
			expect(writeSource({lang: "en", confidence: 0.28}, "de", "de")).to.equal(null);
			expect(writeSource({lang: "en", confidence: 0.28}, "en", "de")).to.equal("en");
			expect(writeSource({lang: "it", confidence: 0.12}, "en", "de")).to.equal("en");
			expect(writeSource({lang: "it", confidence: 0.4}, "de", "de")).to.equal("it");
		});

		it("targets the reading language, never the draft's detected language", () => {
			expect(reverseTarget("en", "de")).to.equal("en");
			expect(reverseTarget("de", "de")).to.equal(null);
		});
	});

	describe("termPair", () => {
		it("keeps a short pair and drops sentences, commands, placeholders and identical text", () => {
			expect(termPair("rig", "Testaufbau")).to.deep.equal(["rig", "Testaufbau"]);
			expect(termPair("  log file ", "Protokolldatei")).to.deep.equal([
				"log file",
				"Protokolldatei",
			]);
			expect(termPair("please keep the log", "bitte behalte das Log")).to.equal(null);
			expect(termPair("a".repeat(41), "b")).to.equal(null);
			expect(termPair("rig", "a very long translation of a short term indeed")).to.equal(
				null
			);
			expect(termPair("/me", "ich")).to.equal(null);
			expect(termPair("see ⟦1⟧", "siehe ⟦1⟧")).to.equal(null);
			expect(termPair("Rig", "rig")).to.equal(null);
			expect(termPair("one\ntwo", "eins zwei")).to.equal(null);
			expect(TERM_MAX_WORDS).to.equal(3);
		});
	});

	describe("translateDraft", () => {
		it("translates one line, streaming restored text, and restores the spans at the end", async () => {
			const r = rig((req) => [`[de]`, `[de] ${req.text}`]);
			const chunks: string[] = [];
			const text = await translateDraft(
				r.deps,
				request({text: "see https://example.org/x?y=1 now"}),
				new AbortController().signal,
				(t) => chunks.push(t)
			);

			expect(r.requests).to.have.length(1);
			expect(r.requests[0].text).to.equal("see ⟦1⟧ now");
			expect(r.requests[0].purpose).to.equal("write");
			expect(text).to.equal("[de] see https://example.org/x?y=1 now");
			expect(chunks[chunks.length - 1]).to.equal(text);
		});

		it("appends a span the engine dropped", async () => {
			const r = rig(() => ["[de] gone"]);
			const text = await translateDraft(
				r.deps,
				request({text: "see https://example.org/"}),
				new AbortController().signal,
				() => {}
			);

			expect(text).to.equal("[de] gone https://example.org/");
		});

		it("sends a multi-line draft as numbered lines and keeps blank lines in place", async () => {
			const r = rig(echo);
			const chunks: string[] = [];
			const text = await translateDraft(
				r.deps,
				request({text: "one\n\ntwo\nthree"}),
				new AbortController().signal,
				(t) => chunks.push(t)
			);

			expect(r.requests).to.have.length(1);
			expect(r.requests[0].lines).to.deep.equal(["one", "two", "three"]);
			expect(r.requests[0].text).to.equal("");
			expect(text).to.equal("[de] one\n\n[de] two\n[de] three");
			expect(chunks[0]).to.equal("[de] one\n\n\n");
		});

		it("goes line by line when the numbering does not parse, and when the engine does not batch", async () => {
			const r = rig((req) => (req.lines ? ["garbage"] : [`[de] ${req.text}`]));
			const text = await translateDraft(
				r.deps,
				request({text: "one\ntwo"}),
				new AbortController().signal,
				() => {}
			);

			expect(r.requests.map((q) => q.lines?.length ?? 0)).to.deep.equal([2, 0, 0]);
			expect(text).to.equal("[de] one\n[de] two");

			const single = rig((req) => [`[de] ${req.text}`]);
			const plain = await translateDraft(
				single.deps,
				request({text: "one\ntwo", batches: false}),
				new AbortController().signal,
				() => {}
			);

			expect(single.requests.map((q) => q.text)).to.deep.equal(["one", "two"]);
			expect(plain).to.equal("[de] one\n[de] two");
		});

		it("goes line by line when the engine refuses the batch before it yields", async () => {
			const r = rig((req) =>
				req.lines ? new Error("seq2seq engines do not batch") : [`[de] ${req.text}`]
			);
			const text = await translateDraft(
				r.deps,
				request({text: "one\ntwo"}),
				new AbortController().signal,
				() => {}
			);

			expect(r.requests.map((q) => q.lines?.length ?? 0)).to.deep.equal([2, 0, 0]);
			expect(text).to.equal("[de] one\n[de] two");
		});

		it("hides markdown markers and the channel's nicks from the engine, and puts them back", async () => {
			const r = rig((req) => [`[de] ${req.text}`]);
			const text = await translateDraft(
				r.deps,
				request({
					text: "this is supposed to be in *German*. Ask hilde.",
					nicks: ["hilde", "otto"],
				}),
				new AbortController().signal,
				() => {}
			);

			expect(r.requests[0].text).to.equal("this is supposed to be in ⟦1⟧German⟦2⟧. Ask ⟦3⟧.");
			expect(text).to.equal("[de] this is supposed to be in *German*. Ask hilde.");
		});

		it("a marker whose partner the engine lost leaves no stray marker behind", async () => {
			const r = rig(() => ["[de] ⟦1⟧so wichtig"]);
			const text = await translateDraft(
				r.deps,
				request({text: "*so wichtig*"}),
				new AbortController().signal,
				() => {}
			);

			expect(text).to.equal("[de] so wichtig");
		});

		it("re-prepends a line prefix the engine dropped", async () => {
			const r = rig(() => ["[de] Titel"]);
			const text = await translateDraft(
				r.deps,
				request({text: "# Title"}),
				new AbortController().signal,
				() => {}
			);

			expect(r.requests[0].text).to.equal("⟦1⟧Title");
			expect(text).to.equal("# [de] Titel");
		});

		it("ships a fenced code block whole and never sends it for translation", async () => {
			const r = rig(echo);
			const text = await translateDraft(
				r.deps,
				request({text: "look at this\n```\nx = 1\n```\nand that is all"}),
				new AbortController().signal,
				() => {}
			);

			expect(r.requests).to.have.length(1);
			expect(r.requests[0].lines).to.deep.equal(["look at this", "and that is all"]);
			expect(text).to.equal("[de] look at this\n```\nx = 1\n```\n[de] and that is all");
		});

		it("takes an already-protected text and restores against its spans", async () => {
			const r = rig(echo);
			const info = protect("erste Zeile\nzweite *Zeile*");
			const text = await translateDraft(
				r.deps,
				request({text: info.text, protected: info}),
				new AbortController().signal,
				() => {}
			);

			expect(r.requests[0].lines).to.deep.equal(["erste Zeile", "zweite ⟦1⟧Zeile⟦2⟧"]);
			expect(text).to.equal("[de] erste Zeile\n[de] zweite *Zeile*");
		});

		it("keeps inline math intact through a draft's translation", async () => {
			const r = rig((req) => [`[de] ${req.text}`]);
			const text = await translateDraft(
				r.deps,
				request({text: "the result is $`x^2`$ and it is final"}),
				new AbortController().signal,
				() => {}
			);

			expect(r.requests[0].text).to.equal("the result is ⟦1⟧ and it is final");
			expect(text).to.equal("[de] the result is $`x^2`$ and it is final");
		});

		it("times out, aborting the request it made", async () => {
			const r = rig(() => ["never"]);
			const never: OutgoingDeps = {
				...r.deps,
				translate(_req, signal) {
					r.signals.push(signal);

					// eslint-disable-next-line require-yield -- ends only by abort or timeout, never yields
					return (async function* (): AsyncIterable<TranslateChunk> {
						await new Promise<void>((resolve) =>
							signal.addEventListener("abort", () => resolve())
						);
					})();
				},
			};
			const promise = translateDraft(
				never,
				request(),
				new AbortController().signal,
				() => {}
			);
			const failed = promise.catch((e: Error) => e.message);

			await r.clock.tickAsync(WRITE_TIMEOUT_MS + 1);
			expect(await failed).to.equal(TIMED_OUT);
			expect(r.signals[0].aborted).to.equal(true);
		});

		it("reports the caller's abort as ABORTED and passes it down", async () => {
			const r = rig(() => ["never"]);
			const controller = new AbortController();
			const never: OutgoingDeps = {
				...r.deps,
				translate(_req, signal) {
					r.signals.push(signal);

					// eslint-disable-next-line require-yield -- ends only by abort or timeout, never yields
					return (async function* (): AsyncIterable<TranslateChunk> {
						await new Promise<void>((resolve) =>
							signal.addEventListener("abort", () => resolve())
						);
					})();
				},
			};
			const failed = translateDraft(never, request(), controller.signal, () => {}).catch(
				(e: Error) => e.message
			);

			await Promise.resolve();
			controller.abort();
			expect(await failed).to.equal(ABORTED);
			expect(r.signals[0].aborted).to.equal(true);
		});

		it("passes the engine's own error through", async () => {
			const r = rig(() => new Error("no translation engine can take this request"));
			const failed = translateDraft(
				r.deps,
				request(),
				new AbortController().signal,
				() => {}
			).catch((e: Error) => e.message);

			expect(await failed).to.equal("no translation engine can take this request");
		});
	});
});
