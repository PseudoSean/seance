// Expiry sweep for `ClientChan.typing` (docs/resources/bus-contract.md §1.5).
// Entries carry an `expiresAt`, but only the channel on screen has a mounted
// TypingIndicator, so a background channel whose typist vanished mid-sentence
// — no `done`, no message, no part — would keep its entry forever. One shared
// ticker sweeps every channel instead, which also lets the sidebar typing
// pulse be a plain reactive computed over the array rather than a per-row
// timer: entries only ever present are live ones.
//
// No store/DOM imports so it can be unit-tested under mocha; timers are the
// globals so tests can fake them with sinon.
import {expireTyping, type TypingEntry} from "./typingState";

/** Anything holding typing entries; a `ClientChan` in practice. */
export type TypingHolder = {typing: TypingEntry[]};

/** Sweep period. The shortest TTL is 6 s, so 1 s granularity is ample. */
export const TYPING_SWEEP_INTERVAL = 1000;

export class TypingExpiry {
	private timer: ReturnType<typeof setInterval> | null = null;
	private readonly holders: () => Iterable<TypingHolder>;
	private readonly interval: number;

	constructor(holders: () => Iterable<TypingHolder>, interval = TYPING_SWEEP_INTERVAL) {
		this.holders = holders;
		this.interval = interval;
	}

	/** Whether the sweep is running. */
	get running(): boolean {
		return this.timer !== null;
	}

	/** Start sweeping if it is not already. Call when a channel gains an entry. */
	schedule() {
		if (this.timer === null) {
			this.timer = setInterval(() => this.sweep(), this.interval);
		}
	}

	/**
	 * Drop every entry that has expired, then stop once no channel has any
	 * left — nothing needs sweeping until the next notification arrives.
	 * `expireTyping` returns the array untouched when nothing changed, so
	 * reactive watchers only fire on real removals.
	 */
	sweep(now = Date.now()) {
		let live = false;

		for (const holder of this.holders()) {
			holder.typing = expireTyping(holder.typing, now);

			if (holder.typing.length > 0) {
				live = true;
			}
		}

		if (!live) {
			this.dispose();
		}
	}

	/** Stop the ticker; safe to call when it is not running. */
	dispose() {
		if (this.timer !== null) {
			clearInterval(this.timer);
			this.timer = null;
		}
	}
}
