// The reading-side scheduler (spec § queue.ts). One instance per network:
// a FIFO ordered by the caller's priority (the active channel first) and
// arrival, one request in flight per engine so the GPU and CPU engines
// overlap, LLM items of one channel and pair batched as numbered lines,
// items that fell DROP_AFTER_LINES messages behind dropped, and an engine
// paused after PAUSE_AFTER_FAILURES consecutive failures. The queue owns
// span restoration: items arrive protected and updates carry restored
// text. Vue-free; reader.ts feeds it and writes its updates to the store.

import {EngineName, PromptContext, TranslateChunk, TranslateRequest} from "./engine";
import {parseBatchedOutput} from "./prompt";
import {appendMissing, restore} from "./spans";

export const DROP_AFTER_LINES = 200;
export const BATCH_MAX_LINES = 6;
export const PAUSE_AFTER_FAILURES = 3;
export const NO_ROUTE = "no translation engine can take this request";

export interface QueueItem {
	/** The message's store id. */
	id: number;
	chanId: number;
	/** Protected text (spans.ts) and its spans. */
	text: string;
	spans: string[];
	from: string;
	to: string;
	context: PromptContext;
	/** `deps.arrivals(chanId)` when the item was queued. */
	arrivalsAtEnqueue: number;
	/** Never batch this item (a retry, or a batch that failed to parse). */
	single: boolean;
}

export type QueueUpdate =
	| {status: "pending"; text: string; engine: EngineName}
	| {status: "done"; text: string; engine: EngineName}
	| {status: "failed"; error: string}
	| {status: "dropped"};

export interface QueueDeps {
	route(from: string, to: string): Promise<EngineName | null>;
	translate(req: Omit<TranslateRequest, "id" | "model">): AsyncIterable<TranslateChunk>;
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
}

export class TranslateQueue {
	private waiting: Queued[] = [];
	private inFlight = new Map<EngineName, {chanIds: Set<number>; abort: () => void}>();
	private failures = new Map<EngineName, number>();
	private pausedEngines = new Set<EngineName>();
	private seq = 0;
	private held = false;
	private deps: QueueDeps;

	constructor(deps: QueueDeps) {
		this.deps = deps;
	}

	enqueue(item: QueueItem, front = false): void {
		void this.deps.route(item.from, item.to).then((engine) => {
			if (!engine) {
				this.deps.onUpdate(item.id, {status: "failed", error: NO_ROUTE});
				return;
			}

			const queued: Queued = {item, engine, seq: front ? -++this.seq : ++this.seq};

			this.waiting.push(queued);
			this.pump();
		});
	}

	retry(item: QueueItem): void {
		this.enqueue(
			{...item, single: true, arrivalsAtEnqueue: this.deps.arrivals(item.chanId)},
			true
		);
	}

	cancelChannel(chanId: number): void {
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

	/** Tests: hold the pump so several enqueues can be observed as one batch. */
	pauseForTest(): void {
		this.held = true;
	}

	resumeForTest(): void {
		this.held = false;
		this.pump();
	}

	private pump(): void {
		if (this.held) {
			return;
		}

		this.waiting.sort(
			(a, b) =>
				this.deps.priority(a.item.chanId) - this.deps.priority(b.item.chanId) ||
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

	private takeHead(engine: EngineName): Queued[] | null {
		for (;;) {
			const index = this.waiting.findIndex((q) => q.engine === engine);

			if (index < 0) {
				return null;
			}

			const head = this.waiting[index];

			if (
				this.deps.arrivals(head.item.chanId) - head.item.arrivalsAtEnqueue >
				DROP_AFTER_LINES
			) {
				this.waiting.splice(index, 1);
				this.deps.onUpdate(head.item.id, {status: "dropped"});
				continue;
			}

			this.waiting.splice(index, 1);

			if (engine !== "llm" || head.item.single) {
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
	}

	private async run(engine: EngineName, batch: Queued[]): Promise<void> {
		let aborted = false;
		const running = {
			chanIds: new Set(batch.map((q) => q.item.chanId)),
			abort() {
				aborted = true;
			},
		};

		this.inFlight.set(engine, running);

		const first = batch[0].item;
		const request: Omit<TranslateRequest, "id" | "model"> =
			batch.length > 1
				? {
						text: "",
						lines: batch.map((q) => q.item.text),
						from: first.from,
						to: first.to,
						purpose: "read",
						context: first.context,
				  }
				: {
						text: first.text,
						from: first.from,
						to: first.to,
						purpose: "read",
						context: first.context,
				  };

		for (const q of batch) {
			this.deps.onUpdate(q.item.id, {status: "pending", text: "", engine});
		}

		try {
			let last = "";

			for await (const chunk of this.deps.translate(request)) {
				if (aborted) {
					break;
				}

				last = chunk.text;

				if (batch.length === 1 && !chunk.done) {
					this.deps.onUpdate(first.id, {
						status: "pending",
						text: this.restoreText(first, chunk.text),
						engine,
					});
				}
			}

			if (aborted) {
				for (const q of batch) {
					this.deps.onUpdate(q.item.id, {status: "dropped"});
				}

				return;
			}

			if (batch.length === 1) {
				this.deps.onUpdate(first.id, {
					status: "done",
					text: this.restoreText(first, last),
					engine,
				});
			} else {
				const lines = parseBatchedOutput(last, batch.length);

				if (!lines) {
					for (const q of batch) {
						this.waiting.push({...q, item: {...q.item, single: true}});
					}
				} else {
					batch.forEach((q, i) => {
						this.deps.onUpdate(q.item.id, {
							status: "done",
							text: this.restoreText(q.item, lines[i]),
							engine,
						});
					});
				}
			}

			this.failures.set(engine, 0);
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);

			for (const q of batch) {
				this.deps.onUpdate(q.item.id, {status: "failed", error: message});
			}

			const count = (this.failures.get(engine) ?? 0) + 1;

			this.failures.set(engine, count);

			if (count >= PAUSE_AFTER_FAILURES) {
				this.pausedEngines.add(engine);
				this.deps.onPause(engine, message);
			}
		} finally {
			this.inFlight.delete(engine);
			this.pump();
		}
	}

	private restoreText(item: QueueItem, text: string): string {
		const restored = restore(text, item.spans);

		return appendMissing(restored.text, item.spans, restored.missing);
	}
}
