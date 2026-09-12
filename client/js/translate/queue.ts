// The reading-side scheduler (spec § queue.ts). One instance per network:
// a FIFO ordered by the caller's priority (the active channel first), then
// live lines before history ones, then arrival; one request in flight per
// engine so the GPU and CPU engines
// overlap, LLM items of one channel and pair batched as numbered lines,
// items that fell DROP_AFTER_LINES messages behind dropped, and an engine
// paused after PAUSE_AFTER_FAILURES consecutive failures. A multi-line
// message is never batched with others and goes through the composer's own
// line logic (`translateDraft`), so every line of it is translated. The
// queue owns span restoration: items arrive protected and updates carry
// restored text — and since a message is protected when it arrives but
// routed when it runs, the marker form its engine reads (spans.ts
// `renderMarkers`) is chosen here, once the route has answered, and kept on
// the `Queued` record that both the request and the restore are built from.
// Vue-free; reader.ts feeds it and writes its updates to the store.

import {EngineName, PromptContext, TranslateChunk, TranslateRequest} from "./engine";
import {
	ABORTED,
	EMPTY_TRANSLATION,
	type OutgoingDeps,
	UNCHANGED,
	hasNoLetters,
	isUnchanged,
	translateDraft,
} from "./outgoing";
import {parseBatchedOutput} from "./prompt";
import {
	LLM_MARKERS,
	type Protected,
	type SpanMeta,
	renderMarkers,
	restore,
	restoreAll,
} from "./spans";

export const DROP_AFTER_LINES = 200;
export const BATCH_MAX_LINES = 6;
export const PAUSE_AFTER_FAILURES = 3;
export const REQUEST_TIMEOUT_MS = 2 * 60 * 1000;
export const NO_ROUTE = "no translation engine can take this request";
export const TIMED_OUT = "timed out";

export interface QueueItem {
	/** The message's store id. */
	id: number;
	chanId: number;
	/** Protected text (spans.ts), its spans and what each of them is. */
	text: string;
	spans: string[];
	meta: SpanMeta[];
	/** null = the source language could not be detected. */
	from: string | null;
	to: string;
	context: PromptContext;
	/** `deps.arrivals(chanId)` when the item was queued. */
	arrivalsAtEnqueue: number;
	/** Never batch this item (a retry, or a batch that failed to parse). */
	single: boolean;
	/**
	 * A history line (a join replay, or a page the reader loaded) rather
	 * than one that just arrived: it runs behind the channel's live items,
	 * and it is what a channel falling behind has left to drop.
	 */
	history?: true;
}

export type QueueUpdate =
	| {status: "pending"; text: string; engine: EngineName}
	| {status: "done"; text: string; engine: EngineName}
	| {status: "failed"; error: string}
	| {status: "dropped"};

export interface QueueDeps {
	route(from: string | null, to: string): Promise<EngineName | null>;
	translate(
		req: Omit<TranslateRequest, "id" | "model">,
		signal: AbortSignal
	): AsyncIterable<TranslateChunk>;
	/** Lower runs first; the active channel is 0. */
	priority(chanId: number): number;
	/** Messages that arrived in the channel so far (a counter the reader keeps). */
	arrivals(chanId: number): number;
	onUpdate(id: number, update: QueueUpdate): void;
	onPause(engine: EngineName, message: string): void;
}

interface Queued {
	item: QueueItem;
	engine: EngineName;
	seq: number;
	/**
	 * The item's protected text in the marker form `engine` reads (spans.ts
	 * `renderMarkers`). The reader protects a message when it arrives, long
	 * before a route is resolved, so the form is chosen here — where the
	 * engine first becomes known — and the one `Protected` then both builds
	 * the request and restores the answer.
	 */
	info: Protected;
}

interface Running {
	chanIds: Set<number>;
	abort: () => void;
}

export class TranslateQueue {
	private waiting: Queued[] = [];
	private inFlight = new Map<EngineName, Running>();
	private failures = new Map<EngineName, number>();
	private pausedEngines = new Set<EngineName>();
	/** Per-channel generation, bumped by cancelChannel/cancelAll: a route
	 *  that resolves for an older generation is dropped instead of queued. */
	private cancelled = new Map<number, number>();
	/** Bumped by cancelAll alone: catches an item still mid-route for a
	 *  channel cancelAll never got to see (not yet in waiting or inFlight). */
	private globalGeneration = 0;
	private seq = 0;
	private held = false;
	private deps: QueueDeps;

	constructor(deps: QueueDeps) {
		this.deps = deps;
	}

	enqueue(item: QueueItem): void {
		this.enqueueAt(item, false);
	}

	retry(item: QueueItem): void {
		this.enqueueAt(
			{
				...item,
				single: true,
				// Someone asked for this line now, so it is no longer history:
				// a burst of live chat must not push a retry to the back.
				history: undefined,
				arrivalsAtEnqueue: this.deps.arrivals(item.chanId),
			},
			true
		);
	}

	cancelChannel(chanId: number): void {
		this.bumpGeneration(chanId);

		const dropped = this.waiting.filter((q) => q.item.chanId === chanId);

		this.waiting = this.waiting.filter((q) => q.item.chanId !== chanId);

		for (const q of dropped) {
			this.deps.onUpdate(q.item.id, {status: "dropped"});
		}

		for (const running of this.inFlight.values()) {
			if (running.chanIds.has(chanId)) {
				running.abort();
			}
		}
	}

	cancelAll(): void {
		this.globalGeneration++;

		const channels = new Set<number>();

		for (const q of this.waiting) {
			channels.add(q.item.chanId);
		}

		for (const running of this.inFlight.values()) {
			for (const chanId of running.chanIds) {
				channels.add(chanId);
			}
		}

		for (const chanId of channels) {
			this.bumpGeneration(chanId);
		}

		for (const q of this.waiting.splice(0)) {
			this.deps.onUpdate(q.item.id, {status: "dropped"});
		}

		for (const running of this.inFlight.values()) {
			running.abort();
		}
	}

	paused(engine: EngineName): boolean {
		return this.pausedEngines.has(engine);
	}

	resume(engine: EngineName): void {
		this.pausedEngines.delete(engine);
		this.failures.set(engine, 0);
		this.pump();
	}

	size(): number {
		return this.waiting.length;
	}

	/**
	 * Hold new runs: a composer request has the engines (spec § Composer);
	 * an item already in flight finishes. Idempotent.
	 */
	hold(): void {
		this.held = true;
	}

	release(): void {
		this.held = false;
		this.pump();
	}

	pauseForTest(): void {
		this.hold();
	}

	resumeForTest(): void {
		this.release();
	}

	private generation(chanId: number): number {
		return this.cancelled.get(chanId) ?? 0;
	}

	private bumpGeneration(chanId: number): void {
		this.cancelled.set(chanId, this.generation(chanId) + 1);
	}

	private enqueueAt(item: QueueItem, front: boolean): void {
		const generation = this.generation(item.chanId);
		const globalGeneration = this.globalGeneration;

		void this.deps.route(item.from, item.to).then(
			(engine) => {
				if (
					this.generation(item.chanId) !== generation ||
					this.globalGeneration !== globalGeneration
				) {
					this.deps.onUpdate(item.id, {status: "dropped"});
					return;
				}

				if (!engine) {
					this.deps.onUpdate(item.id, {status: "failed", error: NO_ROUTE});
					return;
				}

				const queued: Queued = {
					item,
					engine,
					seq: front ? -++this.seq : ++this.seq,
					info: renderMarkers(
						protectedOf(item),
						engine === "llm" ? LLM_MARKERS : "placeholder"
					),
				};

				this.waiting.push(queued);

				if (front && this.pausedEngines.has(engine)) {
					// A retry is someone asking for this line now: the engine its
					// failures paused gets another chance rather than leaving the
					// item waiting for ever. resume() pumps.
					this.resume(engine);
				} else {
					this.pump();
				}
			},
			(e) => {
				this.deps.onUpdate(item.id, {
					status: "failed",
					error: e instanceof Error ? e.message : String(e),
				});
			}
		);
	}

	private pump(): void {
		if (this.held) {
			return;
		}

		this.prune();

		// The active channel first, then what is being said now over what was
		// said then (a history page the reader loaded, or a join replay),
		// then the order they were queued in.
		this.waiting.sort(
			(a, b) =>
				this.deps.priority(a.item.chanId) - this.deps.priority(b.item.chanId) ||
				Number(a.item.history ?? false) - Number(b.item.history ?? false) ||
				a.seq - b.seq
		);

		for (const engine of ["llm", "seq2seq"] as EngineName[]) {
			if (this.inFlight.has(engine) || this.pausedEngines.has(engine)) {
				continue;
			}

			const head = this.takeHead(engine);

			if (head) {
				void this.run(engine, head);
			}
		}
	}

	/** Drops every waiting item that fell DROP_AFTER_LINES messages behind,
	 *  including an engine's that stays paused and never reaches takeHead. */
	private prune(): void {
		const stale = new Set(
			this.waiting.filter(
				(q) =>
					this.deps.arrivals(q.item.chanId) - q.item.arrivalsAtEnqueue > DROP_AFTER_LINES
			)
		);

		if (stale.size === 0) {
			return;
		}

		this.waiting = this.waiting.filter((q) => !stale.has(q));

		for (const q of stale) {
			this.deps.onUpdate(q.item.id, {status: "dropped"});
		}
	}

	private takeHead(engine: EngineName): Queued[] | null {
		const index = this.waiting.findIndex((q) => q.engine === engine);

		if (index < 0) {
			return null;
		}

		const head = this.waiting[index];

		this.waiting.splice(index, 1);

		if (engine !== "llm" || head.item.single || isMultiline(head.item)) {
			return [head];
		}

		const batch = [head];

		for (const q of [...this.waiting]) {
			if (batch.length >= BATCH_MAX_LINES) {
				break;
			}

			if (
				q.engine === engine &&
				!q.item.single &&
				!isMultiline(q.item) &&
				q.item.chanId === head.item.chanId &&
				q.item.from === head.item.from &&
				q.item.to === head.item.to
			) {
				batch.push(q);
				this.waiting.splice(this.waiting.indexOf(q), 1);
			}
		}

		return batch;
	}

	private async run(engine: EngineName, batch: Queued[]): Promise<void> {
		const head = batch[0];
		const first = head.item;

		// A `draft/multiline` message is one message whose text carries
		// newlines. Sending it as one line would leave the engine's cut
		// keeping only the first, so it goes through the composer's own line
		// logic instead — numbered lines to an LLM, one line at a time to a
		// seq2seq engine, blank lines where they were.
		if (batch.length === 1 && isMultiline(first)) {
			await this.runMultiline(engine, head);
			return;
		}

		// Every item of a batch went through the same route, so the marker
		// form is the batch's, not each line's.
		const markers = head.info.markers;
		const request: Omit<TranslateRequest, "id" | "model"> =
			batch.length > 1
				? {
						text: "",
						lines: batch.map((q) => q.info.text),
						from: first.from,
						to: first.to,
						purpose: "read",
						context: first.context,
						markers,
				  }
				: {
						text: head.info.text,
						from: first.from,
						to: first.to,
						purpose: "read",
						context: first.context,
						markers,
				  };

		const controller = new AbortController();
		const iterator = this.deps.translate(request, controller.signal)[Symbol.asyncIterator]();
		let aborted = false;
		let timedOut = false;

		let signalAbort: () => void = () => {};

		const abortSignal = new Promise<void>((resolve) => {
			signalAbort = resolve;
		});
		const running: Running = {
			chanIds: new Set(batch.map((q) => q.item.chanId)),
			abort() {
				if (aborted) {
					return;
				}

				aborted = true;
				signalAbort();
				controller.abort();
				void iterator.return?.();
			},
		};

		this.inFlight.set(engine, running);

		for (const q of batch) {
			this.deps.onUpdate(q.item.id, {status: "pending", text: "", engine});
		}

		const timer = setTimeout(() => {
			timedOut = true;
			running.abort();
		}, REQUEST_TIMEOUT_MS);

		try {
			let last = "";

			for (;;) {
				const nextPromise = iterator.next().then((next) => ({kind: "next" as const, next}));

				// The loser of the race, if it later rejects (the stream threw
				// after a cancel already won), must not be an unhandled rejection.
				nextPromise.catch(() => {});

				const outcome = await Promise.race([
					nextPromise,
					abortSignal.then(() => ({kind: "abort" as const})),
				]);

				if (outcome.kind === "abort") {
					break;
				}

				if (outcome.next.done) {
					break;
				}

				const chunk = outcome.next.value;

				last = chunk.text;

				if (batch.length === 1 && !chunk.done) {
					this.deps.onUpdate(first.id, {
						status: "pending",
						text: this.restoreText(head.info, chunk.text, false),
						engine,
					});
				}
			}

			if (aborted) {
				if (timedOut) {
					this.fail(engine, batch, TIMED_OUT);
				} else {
					for (const q of batch) {
						this.deps.onUpdate(q.item.id, {status: "dropped"});
					}
				}

				return;
			}

			if (batch.length === 1) {
				this.report(engine, head, this.restoreText(head.info, last, true));
			} else {
				const lines = parseBatchedOutput(last, batch.length);

				if (!lines) {
					for (const q of batch) {
						this.waiting.push({...q, item: {...q.item, single: true}});
					}
				} else {
					batch.forEach((q, i) => {
						this.report(engine, q, this.restoreText(q.info, lines[i], true));
					});
				}
			}

			this.failures.set(engine, 0);
		} catch (e) {
			this.fail(engine, batch, e instanceof Error ? e.message : String(e));
		} finally {
			clearTimeout(timer);
			this.inFlight.delete(engine);
			this.pump();
		}
	}

	/**
	 * A multi-line item, translated line by line through `translateDraft`
	 * (outgoing.ts): the same request shapes, the same fallback to singles
	 * when the numbering does not parse, the same protection — except that
	 * the text arrives protected, so the whole message's spans are one
	 * numbering and a fenced block is one of them.
	 */
	private async runMultiline(engine: EngineName, queued: Queued): Promise<void> {
		const item = queued.item;
		const info = queued.info;
		const controller = new AbortController();

		let aborted = false;
		let timedOut = false;

		let signalAbort: () => void = () => {};

		// Raced against the work, the way run() races the iterator: a cancel
		// frees the engine at once even if the stream behind it takes its
		// time noticing the signal.
		const abortRace = new Promise<{kind: "abort"}>((resolve) => {
			signalAbort = () => resolve({kind: "abort"});
		});
		const running: Running = {
			chanIds: new Set([item.chanId]),
			abort() {
				if (aborted) {
					return;
				}

				aborted = true;
				signalAbort();
				controller.abort();
			},
		};
		const deps: OutgoingDeps = {
			translate: (req, signal) => this.deps.translate(req, signal),
			setTimeout: (fn, ms) => setTimeout(fn, ms),
			clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
		};

		this.inFlight.set(engine, running);
		this.deps.onUpdate(item.id, {status: "pending", text: "", engine});

		const timer = setTimeout(() => {
			timedOut = true;
			running.abort();
		}, REQUEST_TIMEOUT_MS);

		try {
			const work = translateDraft(
				deps,
				{
					text: info.text,
					protected: info,
					from: item.from,
					to: item.to,
					purpose: "read",
					context: item.context,
					batches: engine === "llm",
					markers: info.markers,
				},
				controller.signal,
				(partial) => {
					if (!aborted) {
						this.deps.onUpdate(item.id, {status: "pending", text: partial, engine});
					}
				}
			).then((text) => ({kind: "done" as const, text}));

			// The loser of the race, if it later rejects, must not be an
			// unhandled rejection.
			work.catch(() => {});

			const outcome = await Promise.race([work, abortRace]);

			if (outcome.kind === "abort") {
				if (timedOut) {
					this.fail(engine, [queued], TIMED_OUT);
				} else {
					this.deps.onUpdate(item.id, {status: "dropped"});
				}

				return;
			}

			this.report(engine, queued, outcome.text);
			this.failures.set(engine, 0);
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);

			// The queue's own abort is a drop (or the deadline); anything else
			// is this engine's failure, and three in a row pause it.
			if (timedOut) {
				this.fail(engine, [queued], TIMED_OUT);
			} else if (aborted || message === ABORTED) {
				this.deps.onUpdate(item.id, {status: "dropped"});
			} else {
				this.fail(engine, [queued], message);
			}
		} finally {
			clearTimeout(timer);
			this.inFlight.delete(engine);
			this.pump();
		}
	}

	/**
	 * An answer, reported as the translation or as the failure it is. A
	 * translation that came back as the original (the model echoing rather
	 * than translating) or with nothing in it a language could be is the
	 * *answer's* failure, not the engine's: it never goes through `fail()`,
	 * so it marks nothing down and counts toward no pause — the engine did
	 * complete, and the line keeps its chip with Retry / Retranslate from…
	 * Both sides of the comparison are restored (`restoreAll`), so whichever
	 * marker form the route chose cancels out.
	 */
	private report(engine: EngineName, q: Queued, text: string): void {
		if (hasNoLetters(text)) {
			this.deps.onUpdate(q.item.id, {status: "failed", error: EMPTY_TRANSLATION});
			return;
		}

		if (isUnchanged(restoreAll(q.info.text, q.info), text)) {
			this.deps.onUpdate(q.item.id, {status: "failed", error: UNCHANGED});
			return;
		}

		this.deps.onUpdate(q.item.id, {status: "done", text, engine});
	}

	private fail(engine: EngineName, batch: Queued[], message: string): void {
		for (const q of batch) {
			this.deps.onUpdate(q.item.id, {status: "failed", error: message});
		}

		const count = (this.failures.get(engine) ?? 0) + 1;

		this.failures.set(engine, count);

		if (count >= PAUSE_AFTER_FAILURES) {
			this.pausedEngines.add(engine);
			this.deps.onPause(engine, message);
		}
	}

	/** Missing spans (spans.ts) are appended only to the final text: a
	 *  streaming chunk restores placeholders in place but does not yet know
	 *  whether a later chunk will still be missing one. */
	private restoreText(info: Protected, text: string, final: boolean): string {
		return final ? restoreAll(text, info) : restore(text, info.spans).text;
	}
}

/** The item's protected text as spans.ts hands it around: the reader's own
 *  canonical protection, marker pairs still numbered. */
function protectedOf(item: QueueItem): Protected {
	return {text: item.text, spans: item.spans, meta: item.meta, markers: "placeholder"};
}

/** A `draft/multiline` message: one message, several lines. */
function isMultiline(item: QueueItem): boolean {
	return item.text.includes("\n");
}
