/**
 * VAPID application-server keys, as the Push API and the stored
 * subscriptions handle them. Vue-free (mocha: `test/helpers/pushKeys.ts`).
 *
 * A browser holds at most ONE push subscription per service-worker
 * registration, bound to the `applicationServerKey` it was created with;
 * `PushManager.subscribe()` with a different key is refused
 * (`InvalidStateError`, "unsubscribe then resubscribe"). The ircd announces
 * its key in `draft/webpush=vapid=<key>`, so a server-side rotation shows up
 * as a stored subscription that no connected server's key matches.
 */

/** URL-safe base64 (no padding), as `vapid=` carries it → the bytes
 * `PushManager.subscribe()` expects. */
export function decodeApplicationServerKey(b64: string): Uint8Array {
	const padding = "=".repeat((4 - (b64.length % 4)) % 4);
	const base64 = (b64 + padding).replace(/-/g, "+").replace(/_/g, "/");
	const raw = atob(base64);
	const out = new Uint8Array(raw.length);

	for (let i = 0; i < raw.length; i++) {
		out[i] = raw.charCodeAt(i);
	}

	return out;
}

/** Whether the key an existing browser subscription was created with
 * (`PushSubscription.options.applicationServerKey`) is `wanted`. */
export function sameApplicationServerKey(
	existing: ArrayBuffer | ArrayBufferView | null | undefined,
	wanted: Uint8Array
): boolean {
	if (!existing) {
		return false;
	}

	const bytes =
		existing instanceof ArrayBuffer
			? new Uint8Array(existing)
			: new Uint8Array(existing.buffer, existing.byteOffset, existing.byteLength);

	if (bytes.length !== wanted.length) {
		return false;
	}

	for (let i = 0; i < bytes.length; i++) {
		if (bytes[i] !== wanted[i]) {
			return false;
		}
	}

	return true;
}

/** The stored subscriptions no longer match any key a connected server
 * announces: the server rotated its VAPID key (or the stored subscription
 * belongs to a server that is not connected while others are). False while
 * nothing is stored, or while no connected server announces a key — then
 * there is nothing to compare against yet. */
export function subscriptionIsStale(
	storedKeys: Iterable<string>,
	announcedKeys: Iterable<string | undefined>
): boolean {
	const stored = new Set(storedKeys);

	if (stored.size === 0) {
		return false;
	}

	let announced = false;

	for (const key of announcedKeys) {
		if (key === undefined) {
			continue;
		}

		if (stored.has(key)) {
			return false;
		}

		announced = true;
	}

	return announced;
}
