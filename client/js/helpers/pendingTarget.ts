/**
 * A conversation the app should land on once it exists: the target of a
 * notification deep link (`#/net/<uuid>/<target>`) opened before the
 * network has joined its channels — or at all. Channel ids are session
 * local, so a notification that outlives the page can only name the
 * network (its saved uuid) and the target (channel or nick); the app keeps
 * that pair here until the `join` for it arrives, then switches to it.
 *
 * Vue-free so mocha covers it (test/helpers/pendingTarget.ts).
 */

export interface PendingTarget {
	network: string;
	target: string;
	/** When the deep link was followed (ms epoch). */
	at: number;
}

/** A pending target older than this is stale: the join never came. */
export const PENDING_TARGET_TTL_MS = 60_000;

let pending: PendingTarget | null = null;

/** Remember where to go once `target` on `network` exists. */
export function setPendingTarget(network: string, target: string, now = Date.now()): void {
	pending = {network, target, at: now};
}

/** The pending target, if any and not expired (an expired one is dropped). */
export function getPendingTarget(now = Date.now()): PendingTarget | null {
	if (pending && now - pending.at > PENDING_TARGET_TTL_MS) {
		pending = null;
	}

	return pending;
}

/** Whether a channel named `name` on `network` is what we are waiting for;
 * IRC names compare case-insensitively (a `#Chan` push, a `#chan` join). */
export function matchesPendingTarget(network: string, name: string, now = Date.now()): boolean {
	const p = getPendingTarget(now);

	return p !== null && p.network === network && p.target.toLowerCase() === name.toLowerCase();
}

/** Consume the pending target: returns it once and forgets it. */
export function takePendingTarget(now = Date.now()): PendingTarget | null {
	const p = getPendingTarget(now);

	pending = null;

	return p;
}

export function clearPendingTarget(): void {
	pending = null;
}

/** Channel targets start with a channel prefix; anything else is a nick. */
export function isChannelTarget(target: string): boolean {
	return /^[#&!+]/.test(target);
}
