/**
 * The conversation the user last had open, remembered across page loads so
 * that a reconnect lands where they left off. Channel ids are session-local,
 * so — like helpers/pendingTarget.ts, which does the same for a notification
 * deep link — it is named by network uuid + target (channel name or nick)
 * and persisted in localStorage under `thelounge.state.lastChannel`.
 *
 * Restoring is a *landing*. When a network on which a conversation is
 * remembered is announced, the landing for it is begun
 * (socket-events/network.ts): the autojoin channels are already in the
 * store as placeholders, so a remembered channel among them is shown at
 * once; a private conversation, or a channel a held session will restore,
 * is waited for in the lobby and landed on by the `join` that brings it
 * (socket-events/join.ts, after `network:status` reopens a query). The user
 * opening any other conversation first calls the landing off — they have
 * moved on. While a landing is pending on a network, joins nobody asked for
 * do not move the view.
 *
 * Vue-free so mocha covers it (test/helpers/lastChannel.ts); tests swap the
 * storage backend with {@link useStorageBackend}.
 */

import {ChanType} from "../../../shared/types/chan";
import storage from "../localStorage";

export const STORAGE_KEY = "thelounge.state.lastChannel";

export interface LastChannel {
	/** Saved network uuid. */
	network: string;
	/** Channel name or nick. */
	target: string;
}

/** The subset of the localStorage wrapper this module needs. */
export interface StorageBackend {
	get(key: string): string | null;
	set(key: string, value: string): void;
	remove(key: string): void;
}

let backend: StorageBackend = storage;

/** Swap the persistence backend (tests); `null` restores localStorage. */
export function useStorageBackend(next: StorageBackend | null): void {
	backend = next ?? storage;
}

// ---------------------------------------------------------------- memory

/** The remembered conversation, or null when there is none (or it is unreadable). */
export function getLastChannel(): LastChannel | null {
	let parsed: unknown;

	try {
		const raw = backend.get(STORAGE_KEY);
		parsed = raw ? JSON.parse(raw) : null;
	} catch {
		return null;
	}

	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		return null;
	}

	const {network, target} = parsed as {network?: unknown; target?: unknown};

	if (typeof network !== "string" || !network || typeof target !== "string" || !target) {
		return null;
	}

	return {network, target};
}

export function rememberLastChannel(network: string, target: string): void {
	if (!network || !target) {
		return;
	}

	backend.set(STORAGE_KEY, JSON.stringify({network, target}));
}

export function forgetLastChannel(): void {
	backend.remove(STORAGE_KEY);
}

// --------------------------------------------------------------- landing

let landing: LastChannel | null = null;

/**
 * A network is being announced: when the remembered conversation is on it,
 * make that the pending landing and return it; otherwise null.
 */
export function beginLanding(network: string): LastChannel | null {
	const last = getLastChannel();

	if (!last || last.network !== network) {
		return null;
	}

	landing = last;
	return last;
}

/** The pending landing — on `network` when given — or null. */
export function pendingLanding(network?: string): LastChannel | null {
	if (landing && network !== undefined && landing.network !== network) {
		return null;
	}

	return landing;
}

/** Whether a conversation named `name` on `network` is what is being waited
 * for; IRC names compare case-insensitively. Does not consume it. */
export function matchesLanding(network: string, name: string): boolean {
	return (
		landing !== null &&
		landing.network === network &&
		landing.target.toLowerCase() === name.toLowerCase()
	);
}

/** Consume the pending landing: returns it once and forgets it. */
export function takeLanding(): LastChannel | null {
	const current = landing;
	landing = null;
	return current;
}

export function cancelLanding(): void {
	landing = null;
}

/**
 * The UI is showing a conversation (Chat.vue, alongside the `open` emit).
 * Channels and queries are remembered; the lobby is where the automatic
 * switch at connect time puts the view, and a special window (`/list`,
 * `/ignorelist`) cannot be reopened by name, so neither counts as going
 * somewhere. Going somewhere calls off a pending landing — the user moved
 * on before the remembered conversation arrived. Landing on it is a no-op
 * here: the landing was taken first, and the memory stays what it was.
 */
export function channelOpened(network: string, name: string, type: ChanType): void {
	if (type !== ChanType.CHANNEL && type !== ChanType.QUERY) {
		return;
	}

	rememberLastChannel(network, name);
	cancelLanding();
}
