// A self-stopping ticker that expires short-lived per-channel state.
//
// Both sidebar pulses need the same thing: state that must lapse on its own in
// *every* channel, not just the one on screen. Only the active channel has
// mounted components, so a background channel whose typist vanished — or whose
// last message has gone quiet — would otherwise keep its state forever. One
// shared ticker per concern sweeps the whole store instead, which also lets the
// sidebar read a plain reactive computed rather than run a timer per row.
//
// No store/DOM imports so it can be unit-tested under mocha; timers are the
// globals so tests can fake them with sinon.

/** Default sweep period; the shortest TTL in use is 4 s, so 1 s is ample. */
export const SWEEP_INTERVAL = 1000;

/**
 * Expire one holder's state as of `now`, and report whether it still has
 * anything live. Implementations must leave the holder untouched when nothing
 * changed, so reactive watchers only fire on real updates.
 */
export type ExpireFn<T> = (holder: T, now: number) => boolean;

export class ExpirySweep<T> {
	private timer: ReturnType<typeof setInterval> | null = null;
	private readonly holders: () => Iterable<T>;
	private readonly expire: ExpireFn<T>;
	private readonly interval: number;

	constructor(holders: () => Iterable<T>, expire: ExpireFn<T>, interval = SWEEP_INTERVAL) {
		this.holders = holders;
		this.expire = expire;
		this.interval = interval;
	}

	/** Whether the sweep is running. */
	get running(): boolean {
		return this.timer !== null;
	}

	/** Start sweeping if it is not already. Call when a holder gains state. */
	schedule() {
		if (this.timer === null) {
			this.timer = setInterval(() => this.sweep(), this.interval);
		}
	}

	/**
	 * Expire every holder, then stop once none has anything left — nothing
	 * needs sweeping until the next notification arrives.
	 */
	sweep(now = Date.now()) {
		let live = false;

		for (const holder of this.holders()) {
			if (this.expire(holder, now)) {
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
