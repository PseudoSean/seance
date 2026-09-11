import {expect} from "chai";
import sinon from "ts-sinon";
import {
	emptyContext,
	type TranslateChunk,
	type TranslateRequest,
} from "../../client/js/translate/engine";
import {
	BATCH_MAX_LINES,
	DROP_AFTER_LINES,
	PAUSE_AFTER_FAILURES,
	REQUEST_TIMEOUT_MS,
	TranslateQueue,
	type QueueDeps,
	type QueueItem,
	type QueueUpdate,
} from "../../client/js/translate/queue";
import {protect} from "../../client/js/translate/spans";

type Script = (req: Omit<TranslateRequest, "id" | "model">) => string[] | Error;

function rig(script: Script = (req) => [`[en] ${req.lines ? req.lines.join(" | ") : req.text}`]) {
	const clock = sinon.useFakeTimers();
	const updates: [number, QueueUpdate][] = [];
	const requests: Omit<TranslateRequest, "id" | "model">[] = [];
	const paused: [string, string][] = [];
	const arrivals = new Map<number, number>();
	let engineFor: (from: string | null, to: string) => "llm" | "seq2seq" | null = () => "llm";
	const deps: QueueDeps = {
		route: (from, to) => Promise.resolve(engineFor(from, to)),
		translate(req) {
			requests.push(req);
			return (async function* (): AsyncIterable<TranslateChunk> {
				await Promise.resolve();
				const out = script(req);

				if (out instanceof Error) {
					throw out;
				}

				for (const text of out) {
					yield {id: 0, text, done: false};
				}

				yield {id: 0, text: out[out.length - 1], done: true};
			})();
		},
		priority: (chanId) => (chanId === 1 ? 0 : chanId),
		arrivals: (chanId) => arrivals.get(chanId) ?? 0,
		onUpdate: (id, update) => updates.push([id, update]),
		onPause: (engine, message) => paused.push([engine, message]),
	};
	const queue = new TranslateQueue(deps);

	return {
		queue,
		deps,
		clock,
		updates,
		requests,
		paused,
		arrivals,
		setEngine(fn: typeof engineFor) {
			engineFor = fn;
		},
	};
}

function item(id: number, text: string, overrides: Partial<QueueItem> = {}): QueueItem {
	const protectedText = protect(text);

	return {
		id,
		chanId: 1,
		text: protectedText.text,
		spans: protectedText.spans,
		from: "de",
		to: "en",
		context: emptyContext(),
		arrivalsAtEnqueue: 0,
		single: false,
		...overrides,
	};
}

async function settle(clock: sinon.SinonFakeTimers, rounds = 20) {
	for (let i = 0; i < rounds; i++) {
		await clock.tickAsync(1);
	}
}

describe("translate/queue", () => {
	let clock: sinon.SinonFakeTimers | null = null;

	afterEach(() => {
		clock?.restore();
		clock = null;
	});

	it("translates one item, streaming, and restores the placeholders", async () => {
		const r = rig((req) => [`[en] ${req.text}`]);
		clock = r.clock;
		r.queue.enqueue(item(1, "siehe https://x.test bitte"));
		await settle(r.clock);

		expect(r.updates.map(([id, u]) => [id, u.status])).to.deep.equal([
			[1, "pending"],
			[1, "pending"],
			[1, "done"],
		]);
		expect(r.updates[2][1].text).to.equal("[en] siehe https://x.test bitte");
		expect(r.updates[2][1].engine).to.equal("llm");
		expect(r.requests[0].purpose).to.equal("read");
	});

	it("the active channel goes first, then arrival order", async () => {
		const r = rig();
		clock = r.clock;
		r.queue.pauseForTest();
		r.queue.enqueue(item(10, "eins zwei drei", {chanId: 2}));
		r.queue.enqueue(item(11, "vier fünf sechs", {chanId: 2, from: "fr"}));
		r.queue.enqueue(item(12, "sieben acht neun", {chanId: 1, from: "es"}));
		await settle(r.clock, 3);
		r.queue.resumeForTest();
		await settle(r.clock);

		expect(r.requests.map((q) => q.from)).to.deep.equal(["es", "de", "fr"]);
	});

	it("runs one request per engine, so the GPU and CPU engines overlap", async () => {
		const r = rig();
		clock = r.clock;
		r.setEngine((from) => (from === "de" ? "llm" : "seq2seq"));
		let inFlight = 0;
		let peak = 0;
		// eslint-disable-next-line @typescript-eslint/unbound-method
		const original = r.deps.translate;

		r.deps.translate = (req) => {
			inFlight++;
			peak = Math.max(peak, inFlight);
			const stream = original(req);
			return (async function* () {
				for await (const chunk of stream) {
					yield chunk;
				}

				inFlight--;
			})();
		};

		r.queue.enqueue(item(1, "eins zwei drei"));
		r.queue.enqueue(item(2, "quatre cinq six", {from: "fr"}));
		r.queue.enqueue(item(3, "vier fünf sechs"));
		await settle(r.clock);

		expect(peak).to.equal(2);
		expect(r.updates.filter(([, u]) => u.status === "done").length).to.equal(3);
	});

	it("batches queued LLM items of one channel and pair, up to BATCH_MAX_LINES", async () => {
		const r = rig((req) => {
			if (!req.lines) {
				return [`[en] ${req.text}`];
			}

			return [req.lines.map((line, i) => `${i + 1}. [en] ${line}`).join("\n") + "\nEND"];
		});
		clock = r.clock;
		r.queue.pauseForTest();

		for (let i = 1; i <= BATCH_MAX_LINES + 2; i++) {
			r.queue.enqueue(item(i, `zeile ${i} hier`));
		}

		await settle(r.clock, 3);
		r.queue.resumeForTest();
		await settle(r.clock);

		expect(r.requests.length).to.equal(2);
		expect(r.requests[0].lines?.length).to.equal(BATCH_MAX_LINES);
		expect(r.requests[1].lines?.length).to.equal(2);
		const done = r.updates.filter(([, u]) => u.status === "done");

		expect(done.length).to.equal(BATCH_MAX_LINES + 2);
		expect(done[0][1].text).to.equal("[en] zeile 1 hier");
	});

	it("a batch whose numbering does not match is redone one line at a time", async () => {
		let batched = 0;
		const r = rig((req) => {
			if (req.lines) {
				batched++;
				return ["1. only one line"];
			}

			return [`[en] ${req.text}`];
		});
		clock = r.clock;
		r.queue.pauseForTest();
		r.queue.enqueue(item(1, "eins zwei drei"));
		r.queue.enqueue(item(2, "vier fünf sechs"));
		await settle(r.clock, 3);
		r.queue.resumeForTest();
		await settle(r.clock);

		expect(batched).to.equal(1);
		expect(r.requests.filter((q) => !q.lines).length).to.equal(2);
		expect(r.updates.filter(([, u]) => u.status === "done").map(([id]) => id)).to.deep.equal([
			1, 2,
		]);
	});

	it("drops an item that fell more than DROP_AFTER_LINES messages behind", async () => {
		const r = rig();
		clock = r.clock;
		r.queue.pauseForTest();
		r.queue.enqueue(item(1, "alt und vergessen", {arrivalsAtEnqueue: 0}));
		r.arrivals.set(1, DROP_AFTER_LINES + 1);
		await settle(r.clock, 3);
		r.queue.resumeForTest();
		await settle(r.clock);

		expect(r.requests.length).to.equal(0);
		expect(r.updates).to.deep.equal([[1, {status: "dropped"}]]);
	});

	it("a stale item is pruned on the next pump even while its own engine stays paused", async () => {
		const r = rig(() => new Error("boom"));
		clock = r.clock;

		for (let i = 1; i <= PAUSE_AFTER_FAILURES; i++) {
			r.queue.enqueue(item(i, `zeile ${i} hier`, {single: true}));
		}

		await settle(r.clock);
		expect(r.queue.paused("llm")).to.equal(true);

		r.queue.enqueue(item(100, "alt und vergessen"));
		r.arrivals.set(1, DROP_AFTER_LINES + 1);

		r.setEngine(() => "seq2seq");
		r.queue.enqueue(item(200, "andere sprache", {chanId: 2}));
		await settle(r.clock);

		expect(r.updates.filter(([id]) => id === 100)).to.deep.equal([[100, {status: "dropped"}]]);
		expect(r.queue.paused("llm")).to.equal(true);
	});

	it("a failure is reported and three in a row pause the engine", async () => {
		const r = rig(() => new Error("boom"));
		clock = r.clock;

		for (let i = 1; i <= PAUSE_AFTER_FAILURES + 1; i++) {
			r.queue.enqueue(item(i, `zeile ${i} hier`, {single: true}));
		}

		await settle(r.clock);

		expect(r.updates.filter(([, u]) => u.status === "failed").length).to.equal(
			PAUSE_AFTER_FAILURES
		);
		expect(r.updates.filter(([, u]) => u.status === "failed")[0][1].error).to.equal("boom");
		expect(r.paused).to.deep.equal([["llm", "boom"]]);
		expect(r.queue.paused("llm")).to.equal(true);
		expect(r.queue.size()).to.equal(1);

		r.queue.resume("llm");
		await settle(r.clock);
		expect(r.requests.length).to.equal(PAUSE_AFTER_FAILURES + 1);
	});

	it("a route that rejects fails the item instead of losing it", async () => {
		const r = rig();
		clock = r.clock;
		r.deps.route = () => Promise.reject(new Error("router exploded"));
		r.queue.enqueue(item(1, "eins zwei drei"));
		await settle(r.clock);

		expect(r.updates).to.deep.equal([[1, {status: "failed", error: "router exploded"}]]);
	});

	it("an item with an unknown source routes and translates with from: null", async () => {
		const r = rig();
		clock = r.clock;
		const routedWith: (string | null)[] = [];
		// eslint-disable-next-line @typescript-eslint/unbound-method
		const originalRoute = r.deps.route;

		r.deps.route = (from, to) => {
			routedWith.push(from);
			return originalRoute(from, to);
		};

		r.queue.enqueue(item(1, "bonjour", {from: null}));
		await settle(r.clock);

		expect(routedWith).to.deep.equal([null]);
		expect(r.requests[0].from).to.equal(null);
		expect(r.updates.filter(([, u]) => u.status === "done").length).to.equal(1);
	});

	it("appends missing spans only to the final text, not a streaming chunk", async () => {
		const r = rig(() => ["step one no url", "step two no url"]);
		clock = r.clock;
		r.queue.enqueue(item(1, "siehe https://x.test bitte"));
		await settle(r.clock);

		const pending = r.updates.filter(([id, u]) => id === 1 && u.status === "pending");
		const done = r.updates.find(([id, u]) => id === 1 && u.status === "done");

		expect(pending[1][1].text).to.equal("step one no url");
		expect(pending[2][1].text).to.equal("step two no url");
		expect(done?.[1].text).to.equal("step two no url https://x.test");
	});

	it("cancelChannel drops queued items and the in-flight one of that channel", async () => {
		let release: (() => void) | null = null;
		const r = rig();
		clock = r.clock;
		let calls = 0;
		r.deps.translate = () =>
			(async function* () {
				if (calls++ === 0) {
					await new Promise<void>((resolve) => {
						release = resolve;
					});
				}

				yield {id: 0, text: "late", done: true};
			})();
		r.queue.enqueue(item(1, "eins zwei drei", {single: true}));
		r.queue.enqueue(item(2, "vier fünf sechs", {chanId: 2, single: true}));
		await settle(r.clock, 3);
		r.queue.cancelChannel(1);
		release?.();
		await settle(r.clock);

		expect(r.updates.filter(([id]) => id === 1).map(([, u]) => u.status)).to.deep.equal([
			"pending",
			"dropped",
		]);
		expect(r.updates.filter(([id]) => id === 2).map(([, u]) => u.status)).to.include("done");
	});

	it("cancelChannel calls the iterator's return, so a cancel reaches an engine that never yields", async () => {
		const r = rig();
		clock = r.clock;
		let returned = false;

		r.deps.translate = () => ({
			[Symbol.asyncIterator]: () => ({
				next: () => new Promise<IteratorResult<TranslateChunk>>(() => {}),
				return(value?: unknown) {
					returned = true;
					return Promise.resolve({done: true as const, value});
				},
			}),
		});
		r.queue.enqueue(item(1, "eins zwei drei", {single: true}));
		await settle(r.clock, 3);
		r.queue.cancelChannel(1);
		await settle(r.clock);

		expect(returned).to.equal(true);
		expect(r.updates.filter(([id]) => id === 1).map(([, u]) => u.status)).to.deep.equal([
			"pending",
			"dropped",
		]);
	});

	it("a request that never yields fails as timed out after REQUEST_TIMEOUT_MS", async () => {
		const r = rig();
		clock = r.clock;
		r.deps.translate = () =>
			(async function* () {
				await new Promise<void>(() => {});
				yield {id: 0, text: "never", done: true};
			})();
		r.queue.enqueue(item(1, "eins zwei drei", {single: true}));
		await settle(r.clock, 3);
		await clock.tickAsync(REQUEST_TIMEOUT_MS);
		await settle(r.clock);

		expect(r.updates.filter(([id]) => id === 1).map(([, u]) => u.status)).to.deep.equal([
			"pending",
			"failed",
		]);
		expect(
			r.updates.find(([id, u]) => id === 1 && u.status === "failed")?.[1] as {error: string}
		).to.deep.include({error: "timed out"});
	});

	it("route-after-cancel: cancelling before the route resolves drops the item", async () => {
		const r = rig();
		clock = r.clock;
		let resolveRoute: ((engine: "llm" | "seq2seq" | null) => void) | null = null;

		r.deps.route = () =>
			new Promise((resolve) => {
				resolveRoute = resolve;
			});
		r.queue.enqueue(item(1, "eins zwei drei"));
		r.queue.cancelChannel(1);
		resolveRoute?.("llm");
		await settle(r.clock);

		expect(r.updates).to.deep.equal([[1, {status: "dropped"}]]);
		expect(r.requests.length).to.equal(0);
	});

	it("retry re-enqueues an item at the front", async () => {
		let fail = true;
		const r = rig((req) => (fail ? new Error("once") : [`[en] ${req.text}`]));
		clock = r.clock;
		const first = item(1, "eins zwei drei", {single: true});
		r.queue.enqueue(first);
		await settle(r.clock);
		fail = false;
		r.queue.pauseForTest();
		r.queue.enqueue(item(2, "vier fünf sechs", {single: true}));
		r.queue.retry(first);
		await settle(r.clock, 3);
		r.queue.resumeForTest();
		await settle(r.clock);

		expect(r.requests.map((q) => q.text)).to.deep.equal([
			"eins zwei drei",
			"eins zwei drei",
			"vier fünf sechs",
		]);
	});

	it("an item with no route fails at once", async () => {
		const r = rig();
		clock = r.clock;
		r.setEngine(() => null);
		r.queue.enqueue(item(1, "eins zwei drei"));
		await settle(r.clock);

		expect(r.updates).to.deep.equal([
			[1, {status: "failed", error: "no translation engine can take this request"}],
		]);
	});
});
