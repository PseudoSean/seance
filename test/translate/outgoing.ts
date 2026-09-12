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
	WRITE_TIMEOUT_MS,
	draftGate,
	reverseTarget,
	termPair,
	translateDraft,
	writeSource,
	type OutgoingDeps,
	type OutgoingRequest,
} from "../../client/js/translate/outgoing";

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
		it("trust the detector, then the reading language, then nobody", () => {
			expect(writeSource("fr", "en", "de")).to.equal("fr");
			expect(writeSource(null, "en", "de")).to.equal("en");
			expect(writeSource(null, "de", "de")).to.equal(null);
			expect(reverseTarget("fr", "en", "de")).to.equal("fr");
			expect(reverseTarget(null, "en", "de")).to.equal("en");
			expect(reverseTarget(null, "de", "de")).to.equal(null);
			expect(reverseTarget("de", "en", "de")).to.equal(null);
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
