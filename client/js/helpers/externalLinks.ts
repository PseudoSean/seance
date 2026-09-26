// Links out of an installed app open in the browser, in a window of its own.
//
// In a browser tab a link with `target="_blank"` opens a new tab, which is
// what it should do, and nothing here changes that. In an installed app —
// the home-screen app on a phone, the app window on a desktop — the same
// link opens *inside* the app: Chrome on Android lays a Custom Tab over the
// app (the chat is gone until Back), iOS a Safari sheet, desktop Chrome a
// tab somewhere in another window. So an installed app hands the link to a
// real browser window instead:
//
//  - Android: an `intent:` URL for the link's own https URL, which Android
//    resolves to the default browser (a window of its own, the app stays as
//    it is). No `window.open` can do that from an installed app.
//  - iOS 17 and later: the `x-safari-https:` scheme, which opens Safari.
//    Older iOS has neither, and keeps its in-app sheet.
//  - Desktop: `window.open` with window features, which is a new browser
//    window rather than a tab.
//
// The native shells route links themselves (shells/electron `openExternal`,
// Capacitor's WebView hands them to the system) and report the `browser`
// display mode, so this never runs there. The decisions are Vue- and
// DOM-free for mocha (`test/helpers/externalLinks.ts`); `installExternalLinks`
// is the DOM glue, called from boot.ts.

export type LinkPlatform = "android" | "ios" | "desktop";

/** Display modes an installed app runs in (the manifest asks for `standalone`). */
const APP_DISPLAY_MODES = ["standalone", "fullscreen", "minimal-ui", "window-controls-overlay"];

/** Which way out a link takes, by user agent (and touch points: iPadOS says "Macintosh"). */
export function linkPlatform(userAgent: string, maxTouchPoints = 0): LinkPlatform {
	if (/Android/i.test(userAgent)) {
		return "android";
	}

	if (/iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1)) {
		return "ios";
	}

	return "desktop";
}

/** The iOS major version in a user agent (`OS 17_4` / `Version/17.4`), or 0 when there is none. */
export function iosVersion(userAgent: string): number {
	const match = /\bOS (\d+)_/.exec(userAgent) ?? /\bVersion\/(\d+)\./.exec(userAgent);
	return match ? Number(match[1]) : 0;
}

/** Whether `href` is a web link this module takes out of the app. */
export function isWebLink(href: string): boolean {
	return /^https?:\/\//i.test(href);
}

/**
 * The `intent:` URL that asks Android to view `href` in the default
 * browser: `intent://<host><path>?<query>#<fragment>#Intent;scheme=…;end`.
 * Android parses from the last `#Intent;`, so the link's own fragment
 * survives, and `scheme` puts `http`/`https` back.
 */
export function androidIntentUrl(href: string): string {
	const url = new URL(href);
	const rest = href.slice(url.protocol.length + 2); // after "https://"
	const scheme = url.protocol.slice(0, -1);
	return (
		`intent://${rest}#Intent;scheme=${scheme};action=android.intent.action.VIEW;` +
		"category=android.intent.category.BROWSABLE;end"
	);
}

/** `x-safari-https://…`: opens `href` in Safari from an iOS 17+ home-screen app. */
export function safariUrl(href: string): string {
	return `x-safari-${href}`;
}

/** `window.open` features for a browser window of its own, sized to most of the screen. */
export function windowFeatures(availWidth: number, availHeight: number): string {
	const width = Math.max(480, Math.round(availWidth * 0.8));
	const height = Math.max(480, Math.round(availHeight * 0.85));
	return `popup,noopener,noreferrer,width=${width},height=${height}`;
}

/** How to leave the app for `href`: a URL to navigate to, or window features to open it with. */
export type WayOut = {navigate: string} | {open: string; features: string} | null;

/**
 * The way out of the app for `href` on `platform`; null leaves the link
 * to the browser (not a web link, or an iOS without `x-safari-`).
 */
export function wayOut(
	href: string,
	platform: LinkPlatform,
	env: {iosVersion?: number; availWidth?: number; availHeight?: number} = {}
): WayOut {
	if (!isWebLink(href)) {
		return null;
	}

	switch (platform) {
		case "android":
			return {navigate: androidIntentUrl(href)};
		case "ios":
			return (env.iosVersion ?? 0) >= 17 ? {navigate: safariUrl(href)} : null;
		default:
			return {
				open: href,
				features: windowFeatures(env.availWidth ?? 1280, env.availHeight ?? 800),
			};
	}
}

/** Running as an installed app (any of the app display modes, or iOS's home-screen flag). */
export function isInstalledApp(): boolean {
	if (typeof window === "undefined") {
		return false;
	}

	if ((window.navigator as {standalone?: boolean}).standalone === true) {
		return true;
	}

	return (
		typeof window.matchMedia === "function" &&
		APP_DISPLAY_MODES.some((mode) => window.matchMedia(`(display-mode: ${mode})`).matches)
	);
}

/**
 * Send web links that would open a new tab (`target="_blank"`) out of the
 * app when it runs installed. A plain left click only — a middle click, a
 * modified click or a long press is the user choosing — and only when
 * nothing else took the click first (a preview thumbnail opens the image
 * viewer and calls `preventDefault`): the listener sits at the document,
 * after every component's own.
 */
export function installExternalLinks(): void {
	if (typeof document === "undefined") {
		return;
	}

	document.addEventListener("click", (event: MouseEvent) => {
		if (
			event.defaultPrevented ||
			event.button !== 0 ||
			event.ctrlKey ||
			event.metaKey ||
			event.shiftKey ||
			event.altKey ||
			!isInstalledApp()
		) {
			return;
		}

		const link = (event.target as Element | null)?.closest?.("a[href]");

		if (!(link instanceof HTMLAnchorElement) || link.target !== "_blank") {
			return;
		}

		const ua = navigator.userAgent;
		const way = wayOut(link.href, linkPlatform(ua, navigator.maxTouchPoints), {
			iosVersion: iosVersion(ua),
			availWidth: window.screen?.availWidth,
			availHeight: window.screen?.availHeight,
		});

		if (!way) {
			return;
		}

		event.preventDefault();

		if ("navigate" in way) {
			// A scheme another app answers: the page is not unloaded.
			window.location.href = way.navigate;
		} else {
			window.open(way.open, "_blank", way.features);
		}
	});
}
