// Native-shell glue (shells/capacitor). The web build never bundles Capacitor:
// the shell's WebView injects `window.Capacitor` (its "native bridge") before
// our scripts run, so everything here is feature-detected and a no-op in a
// browser. Only the bridge's own `addListener` / `nativePromise` are used;
// `Capacitor.Plugins` stays empty unless `@capacitor/core` is bundled.

import {leavePage, onStandalonePage} from "./router";
import {closeOpenImage} from "./helpers/imageViewer";
import {reconnectAll} from "./irc/manager";
import {checkForUpdate} from "./pwa";

interface CapacitorBridge {
	isNativePlatform?: () => boolean;
	addListener?: (plugin: string, event: string, cb: (data: any) => void) => unknown;
	nativePromise?: (plugin: string, method: string, options?: unknown) => Promise<unknown>;
}

declare global {
	interface Window {
		Capacitor?: CapacitorBridge;
	}
}

export function installNativeHooks(): void {
	const cap = window.Capacitor;

	if (!cap?.isNativePlatform?.() || !cap.addListener || !cap.nativePromise) {
		return;
	}

	// iOS/Android drop the WebSocket while backgrounded: retry on foreground,
	// and look for a newer build while at it.
	cap.addListener("App", "appStateChange", ({isActive}: {isActive?: boolean}) => {
		if (isActive) {
			reconnectAll();
			checkForUpdate();
		}
	});

	// Android back button: close an open image, else leave a standalone page
	// for the conversation it came from, else minimize (overrides the
	// default). Not `router.back()`: the history is kept one deep (router.ts).
	cap.addListener("App", "backButton", () => {
		if (closeOpenImage()) {
			return;
		}

		if (onStandalonePage() && leavePage()) {
			return;
		}

		void cap.nativePromise!("App", "minimizeApp", {});
	});
}
