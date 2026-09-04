// Browser build: come back the moment the page does.
//
// Mobile browsers drop the WebSocket as soon as the app goes to the
// background — or the OS kills it without a close event — and while the page
// is hidden its reconnect timer is throttled. So when the page becomes
// visible again, the network comes back or the page is restored from the
// back/forward cache, every connection is poked (`reconnectAll`): the ones
// waiting to reconnect dial now, open ones probe their socket and treat
// silence as a dead connection. The Capacitor shells do the same from
// `appStateChange` (native.ts); reconnectAll de-bounces the overlap.

import {reconnectAll} from "./irc/manager";

export function installForegroundHooks(): void {
	if (typeof document === "undefined" || typeof window === "undefined") {
		return;
	}

	document.addEventListener("visibilitychange", () => {
		if (document.visibilityState === "visible") {
			reconnectAll();
		}
	});

	// Page Lifecycle: a frozen tab thaws (Chrome, Android especially) —
	// the socket almost certainly died while it was frozen.
	document.addEventListener("resume", () => reconnectAll());

	window.addEventListener("online", () => reconnectAll());
	window.addEventListener("focus", () => reconnectAll());

	window.addEventListener("pageshow", (ev: PageTransitionEvent) => {
		if (ev.persisted) {
			reconnectAll();
		}
	});
}
