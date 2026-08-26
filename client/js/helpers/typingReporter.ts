// Bookkeeping for the client→server `typing` bus event
// (docs/resources/bus-contract.md §1.5): turns the raw stream of input
// changes from ChatInput.vue into `active` / `paused` / `done` reports for one
// target at a time. Unthrottled by design — the IRC layer applies the spec's
// 3 s rule — so this only tracks *whether* something was announced and the
// idle timer. No store/DOM imports; timers are the globals so tests can fake
// them with sinon.
import type {TypingState} from "../../../shared/types/msg";

export type TypingEmit = (target: number, state: TypingState) => void;

/** Idle time without input, with text still in the box, before `paused`. */
export const TYPING_PAUSE_AFTER = 5000;

export class TypingReporter {
	/** Target the last `active`/`paused` was announced for, or null. */
	private target: number | null = null;
	private timer: ReturnType<typeof setTimeout> | null = null;
	private readonly emit: TypingEmit;
	private readonly pauseAfter: number;

	constructor(emit: TypingEmit, pauseAfter = TYPING_PAUSE_AFTER) {
		this.emit = emit;
		this.pauseAfter = pauseAfter;
	}

	/** Whether an `active`/`paused` is outstanding for `target` (or any target). */
	announced(target?: number): boolean {
		return target === undefined ? this.target !== null : this.target === target;
	}

	/**
	 * The input for `target` now reads `text`. Non-empty plain text announces
	 * `active` and (re)arms the idle timer; empty text or a slash command ends
	 * a previous announcement with `done`.
	 */
	input(target: number, text: string) {
		if (text.length > 0 && text[0] !== "/") {
			// Text in another channel's box while switching: finish that one first.
			if (this.target !== null && this.target !== target) {
				this.finish("paused");
			}

			this.target = target;
			this.emit(target, "active");
			this.arm();
			return;
		}

		if (this.target === target) {
			this.finish("done");
		}
	}

	/**
	 * The text was sent as a message. The IRC layer resets its typing state
	 * when it sends the PRIVMSG (the message itself ends typing on the
	 * receiver), so nothing is emitted here; just forget the announcement.
	 */
	sent(target: number) {
		if (this.target === target) {
			this.clearTimer();
			this.target = null;
		}
	}

	/**
	 * The input now shows another channel. A draft left behind in the old
	 * channel is reported as `paused` there; the new channel announces nothing
	 * until the user types again.
	 */
	switchTarget() {
		if (this.target !== null) {
			this.finish("paused");
		}
	}

	/** Drop timers without emitting (component unmount). */
	dispose() {
		this.clearTimer();
		this.target = null;
	}

	private finish(state: TypingState) {
		const target = this.target as number;
		this.clearTimer();
		this.target = null;
		this.emit(target, state);
	}

	private arm() {
		this.clearTimer();
		this.timer = setTimeout(() => {
			this.timer = null;

			if (this.target !== null) {
				// Keep `target` so the eventual clear still sends `done`.
				this.emit(this.target, "paused");
			}
		}, this.pauseAfter);
	}

	private clearTimer() {
		if (this.timer !== null) {
			clearTimeout(this.timer);
			this.timer = null;
		}
	}
}
