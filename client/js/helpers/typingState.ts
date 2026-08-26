// Pure store mutations for the server→client `typing` bus event
// (docs/resources/bus-contract.md §1.5). Kept free of store/DOM imports so
// they can be unit-tested under mocha; the consumer in socket-events/typing.ts
// only looks the channel up and assigns the returned array to
// `ClientChan.typing`. Every helper returns the input array untouched when
// nothing changes, so reactive watchers only fire on real updates.
import type {TypingState} from "../../../shared/types/msg";

export type TypingEntry = {
	nick: string;
	state: TypingState;
	/** Epoch ms after which the entry is stale and must be dropped. */
	expiresAt: number;
};

/** How long an `active` notification stays valid without a refresh. */
export const TYPING_ACTIVE_TTL = 6000;
/** How long a `paused` notification stays valid. */
export const TYPING_PAUSED_TTL = 30000;

function indexOfNick(entries: TypingEntry[], nick: string): number {
	const lower = nick.toLowerCase();
	return entries.findIndex((e) => e.nick.toLowerCase() === lower);
}

/**
 * Upsert `nick` (case-insensitive) with the new state, or remove it on `done`.
 * Entries keep first-seen order so the summary text does not shuffle while
 * people keep typing.
 */
export function applyTyping(
	entries: TypingEntry[],
	nick: string,
	state: TypingState,
	now: number
): TypingEntry[] {
	const index = indexOfNick(entries, nick);

	if (state === "done") {
		return index === -1 ? entries : entries.filter((_, i) => i !== index);
	}

	const entry: TypingEntry = {
		nick,
		state,
		expiresAt: now + (state === "active" ? TYPING_ACTIVE_TTL : TYPING_PAUSED_TTL),
	};

	if (index === -1) {
		return entries.concat([entry]);
	}

	const next = entries.slice();
	next[index] = entry;
	return next;
}

/** Drop `nick` (case-insensitive), e.g. when their message arrives or they leave. */
export function removeTyping(entries: TypingEntry[], nick: string): TypingEntry[] {
	const index = indexOfNick(entries, nick);
	return index === -1 ? entries : entries.filter((_, i) => i !== index);
}

/** Follow a nick change; the entry keeps its state and expiry. */
export function renameTyping(entries: TypingEntry[], from: string, to: string): TypingEntry[] {
	const index = indexOfNick(entries, from);

	if (index === -1) {
		return entries;
	}

	const next = entries.slice();
	next[index] = {...entries[index], nick: to};
	return next;
}

/** Remove every entry whose `expiresAt` has passed. */
export function expireTyping(entries: TypingEntry[], now: number): TypingEntry[] {
	if (!entries.some((e) => e.expiresAt <= now)) {
		return entries;
	}

	return entries.filter((e) => e.expiresAt > now);
}

/**
 * "alice is typing…", "alice and bob are typing…",
 * "alice, bob and 2 others are typing…"; empty string when nobody is.
 */
export function typingSummary(entries: TypingEntry[]): string {
	const nicks = entries.map((e) => e.nick);

	switch (nicks.length) {
		case 0:
			return "";
		case 1:
			return `${nicks[0]} is typing…`;
		case 2:
			return `${nicks[0]} and ${nicks[1]} are typing…`;
		case 3:
			return `${nicks[0]}, ${nicks[1]} and ${nicks[2]} are typing…`;
		default:
			return `${nicks[0]}, ${nicks[1]} and ${nicks.length - 2} others are typing…`;
	}
}
