// Native-shell glue (shells/capacitor). The web build never bundles Capacitor:
// the shell's WebView injects `window.Capacitor` (its "native bridge") before
// our scripts run, so everything here is feature-detected and a no-op in a
// browser. Only the bridge's own `addListener` / `nativePromise` are used;
// `Capacitor.Plugins` stays empty unless `@capacitor/core` is bundled.

import {router} from "./router";
import {reconnectAll} from "./irc/manager";

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

	// iOS/Android drop the WebSocket while backgrounded: retry on foreground.
	cap.addListener("App", "appStateChange", ({isActive}: {isActive?: boolean}) => {
		if (isActive) {
			reconnectAll();
		}
	});

	// Android back button: router history, else minimize (overrides the default).
	cap.addListener("App", "backButton", ({canGoBack}: {canGoBack?: boolean}) => {
		canGoBack ? router.back() : void cap.nativePromise!("App", "minimizeApp", {});
	});
}
