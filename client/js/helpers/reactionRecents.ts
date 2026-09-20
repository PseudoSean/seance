/**
 * The reactions this browser has sent lately, newest first, kept in
 * localStorage so the picker opens on the ones you actually use.
 *
 * Entries are whole reaction strings rather than emoji, because a reaction is
 * free text: "👍", "🎉🎉🎉" and "lol" all belong in the list. Nothing here
 * touches the store or the DOM, and the backend is swappable, so mocha can
 * exercise it (`test/helpers/reactionRecents.ts`).
 */

import storage from "../localStorage";
import {isSingleEmoji, MAX_REACTION_LENGTH} from "./emoji";

export const STORAGE_KEY = "thelounge.reactions.recent";

/** How many are remembered. Four rows of the picker's grid, give or take. */
export const MAX_RECENT = 36;

/** What the recent row shows before there is any history to show. */
export const DEFAULT_REACTIONS = ["👍", "❤️", "😂", "🎉", "😮", "😢", "🔥", "👀"];

/** How many one-tap reactions the message toolbar carries. */
export const QUICK_REACTIONS = 3;

/** The subset of the localStorage wrapper this module needs. */
export interface StorageBackend {
	get(key: string): string | null;
	set(key: string, value: string): void;
	remove(key: string): void;
}

let backend: StorageBackend = storage;

type Listener = () => void;
const listeners = new Set<Listener>();

/**
 * Called after every {@link rememberReaction}. The toolbar of every message
 * on screen shows the quick reactions, and a pick in one has to show up in
 * all of them; localStorage has no change event within one page.
 */
export function onRecentsChange(fn: Listener): () => void {
	listeners.add(fn);

	return () => void listeners.delete(fn);
}

/** Swap the persistence backend (tests); `null` restores localStorage. */
export function useStorageBackend(next: StorageBackend | null): void {
	backend = next ?? storage;
}

/**
 * `text` in front of `list`, with any earlier use of it removed and the tail
 * trimmed to `limit`. Pure, so the ordering rule is testable on its own.
 */
export function mergeRecent(list: string[], text: string, limit = MAX_RECENT): string[] {
	return [text, ...list.filter((entry) => entry !== text)].slice(0, limit);
}

/** The stored list, newest first. Anything unreadable is treated as empty. */
export function recentReactions(): string[] {
	const raw = backend.get(STORAGE_KEY);

	if (!raw) {
		return [];
	}

	try {
		const parsed: unknown = JSON.parse(raw);

		if (!Array.isArray(parsed)) {
			throw new Error("not a list");
		}

		return parsed
			.filter(
				(entry): entry is string =>
					typeof entry === "string" &&
					entry.length > 0 &&
					Array.from(entry).length <= MAX_REACTION_LENGTH
			)
			.slice(0, MAX_RECENT);
	} catch {
		// A list we cannot read is one we will never write again: drop it
		// rather than hand the picker junk on every open.
		backend.remove(STORAGE_KEY);
		return [];
	}
}

/** Record `text` as the most recently used reaction. */
export function rememberReaction(text: string): void {
	if (!text) {
		return;
	}

	backend.set(STORAGE_KEY, JSON.stringify(mergeRecent(recentReactions(), text)));

	for (const fn of listeners) {
		fn();
	}
}

/**
 * The one-tap reactions for a message toolbar: the newest single-emoji
 * reactions used, topped up from {@link DEFAULT_REACTIONS} so there are
 * always {@link QUICK_REACTIONS} of them. Words and combinations stay in the
 * picker — they would not fit a button the width of a glyph.
 */
export function quickReactions(recent: string[] = recentReactions()): string[] {
	const out: string[] = [];

	for (const text of [...recent, ...DEFAULT_REACTIONS]) {
		if (out.length === QUICK_REACTIONS) {
			break;
		}

		if (isSingleEmoji(text) && !out.includes(text)) {
			out.push(text);
		}
	}

	return out;
}
