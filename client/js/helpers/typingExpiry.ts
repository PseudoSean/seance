// Expiry sweep for `ClientChan.typing` (docs/resources/bus-contract.md §1.5).
// Entries carry an `expiresAt`, but only the channel on screen has a mounted
// TypingIndicator, so a background channel whose typist vanished mid-sentence
// — no `done`, no message, no part — would keep its entry forever. One shared
// ticker sweeps every channel instead, which also lets the sidebar typing
// pulse be a plain reactive computed over the array rather than a per-row
// timer: entries only ever present are live ones.
//
// The ticker itself is helpers/expirySweep.ts, shared with the activity pulse.
import {ExpirySweep, SWEEP_INTERVAL} from "./expirySweep";
import {expireTyping, type TypingEntry} from "./typingState";

/** Anything holding typing entries; a `ClientChan` in practice. */
export type TypingHolder = {typing: TypingEntry[]};

/** Sweep period. The shortest TTL is 6 s, so 1 s granularity is ample. */
export const TYPING_SWEEP_INTERVAL = SWEEP_INTERVAL;

export class TypingExpiry extends ExpirySweep<TypingHolder> {
	constructor(holders: () => Iterable<TypingHolder>, interval = TYPING_SWEEP_INTERVAL) {
		super(
			holders,
			(holder, now) => {
				// `expireTyping` returns the array untouched when nothing
				// changed, so reactive watchers only fire on real removals.
				holder.typing = expireTyping(holder.typing, now);
				return holder.typing.length > 0;
			},
			interval
		);
	}
}
