/**
 * Push-only service-worker registrations: one per push-enabled network,
 * at `<app>/push/<uuid>/` (docs/projects/push-per-network.md). A browser
 * holds one push subscription per registration, so this is what gives each
 * network its own subscription — and its own VAPID key. Shared by the page
 * (webpush.ts builds the scope) and the worker (reads its network back;
 * reached as `self.seancePush.networkFromScope`). Vue-free, DOM-free:
 * `test/push/scope.ts`.
 */

const PREFIX = "push/";

/** The registration scope for a network, relative to the app base. */
export function pushScopePath(uuid: string): string {
	return `${PREFIX}${encodeURIComponent(uuid)}/`;
}

/** The network a push-only registration serves, from its absolute scope;
 * undefined for the root registration (or anything not shaped like one). */
export function networkFromScope(scope: string): string | undefined {
	const m = /\/push\/([^/]+)\/$/.exec(scope);

	if (!m) {
		return undefined;
	}

	try {
		return decodeURIComponent(m[1]);
	} catch {
		return undefined;
	}
}

/** Where the app lives, from a registration scope: a push-only scope minus
 * its `push/<uuid>/` tail, the root scope unchanged. Deep links and
 * `openWindow` must use this, never a push-only scope. */
export function appUrlFromScope(scope: string): string {
	return networkFromScope(scope) === undefined ? scope : scope.replace(/push\/[^/]+\/$/, "");
}
