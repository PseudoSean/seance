// Application boot sequence.
//
// TheLounge drove this from a chain of server events (`auth:start` ->
// `auth:success` -> `configuration` -> `init`). With no server, boot is
// purely local: fetch the deployment branding (`config.json`), install the
// static configuration, apply stored settings, mark the app loaded, drop the
// loading splash and put the router on a sensible route (the connect form
// unless the URL says otherwise).

import configuration from "./configuration";
import {DEFAULT_UPLOAD_MAX_BYTES, loadBranding} from "./branding";
import {router, navigate} from "./router";
import type {LocationQueryRaw} from "vue-router";
import {store} from "./store";
import parseIrcUri from "./helpers/parseIrcUri";
import {loadMentions} from "./mentions";
import storage from "./localStorage";
import {installNativeHooks} from "./native";
import {installForegroundHooks} from "./foreground";
import {migrateGlobalNotify} from "./irc/saved-networks";
import {onLaunch} from "./pwa";
// Importing the manager registers the IRC layer's bus handlers (input, names,
// more, network:*).
import {autoconnectSavedNetworks} from "./irc/manager";

declare global {
	interface Window {
		g_TheLoungeRemoveLoading?: () => void;
	}
}

// The URL the page was opened with, before handleQueryParams() strips it: the
// Launch Handler API replays the initial launch too, and it must not be
// applied twice.
const initialHref = document.location.href;

export async function boot(): Promise<void> {
	// Branding first: it decides the default theme and the document title,
	// and the connect form reads its defaults from it.
	const branding = await loadBranding();
	store.commit("branding", branding);
	document.title = branding.appName;

	if (branding.theme && configuration.themes.some((t) => t.name === branding.theme)) {
		configuration.defaultTheme = branding.theme;
	}

	if (branding.themeColor) {
		setThemeColor(branding.themeColor);
	}

	// Uploads exist only when the deploy names an uploader endpoint.
	configuration.fileUpload = branding.uploads !== undefined;
	configuration.fileUploadMaxFileSize =
		branding.uploads?.maxSizeBytes ?? DEFAULT_UPLOAD_MAX_BYTES;

	store.commit("serverConfiguration", configuration);

	// Before the settings store's first write (which would drop the old key):
	// the removed global "Enable browser notifications" checkbox, when it was
	// off, stamps notifyEnabled: false onto every saved network.
	migrateGlobalNotify();

	// 'theme' setting depends on serverConfiguration.themes so
	// settings cannot be applied before this point
	void store.dispatch("settings/applyAll");

	// The branded default theme applies until the user picks one themselves.
	if (configuration.defaultTheme !== store.state.settings.theme && !hasStoredSetting("theme")) {
		void store.dispatch("settings/update", {
			name: "theme",
			value: configuration.defaultTheme,
		});
	}

	// If localStorage contains a theme that does not exist in this build, switch
	// back to the default theme.
	const currentTheme = configuration.themes.find((t) => t.name === store.state.settings.theme);

	if (currentTheme === undefined) {
		void store.dispatch("settings/update", {
			name: "theme",
			value: configuration.defaultTheme,
		});
	} else if (currentTheme.themeColor) {
		setThemeColor(currentTheme.themeColor);
	}

	loadMentions();
	installNativeHooks();
	installForegroundHooks();

	store.commit("appLoaded");

	try {
		await router.isReady();
	} catch (e: any) {
		// if the router throws an error, it means the route isn't matched,
		// so we can continue on.
	}

	if (window.g_TheLoungeRemoveLoading) {
		window.g_TheLoungeRemoveLoading();
	}

	// Installed app (manifest `launch_handler: focus-existing`): later
	// launches — web+irc:// links, ?uri= URLs — land here instead of reloading
	// the window, which would drop the IRC connection.
	onLaunch((url) => {
		if (url.href !== initialHref) {
			void handleQueryParams(url.search, false);
		}
	});

	// web+irc:// links or connect parameters in the URL put us on the connect
	// form with those values pre-filled. Otherwise, on an unknown route, open
	// the last known channel, or the connect form if there is none.
	if (!(await handleQueryParams()) && !router.currentRoute.value.name) {
		if (store.state.networks.length > 0) {
			await navigate("RoutedChat", {id: store.state.networks[0].channels[0].id});
		} else {
			await navigate("Connect");
		}
	}

	// The saved networks flagged autoconnect, whatever page the URL opened
	// on. The connect form used to dial them when it mounted, which left a
	// reload on settings or help with an empty sidebar until "Add network"
	// was pressed. Last, once the page has a route: a network's announce
	// moves the view off the connect form but leaves a page the user opened
	// alone (socket-events/network.ts), and it needs to know which it is on.
	autoconnectSavedNetworks();
}

/**
 * Open the connect form pre-filled from `?uri=web+irc://...` or plain `?host=...`
 * style parameters. Returns true when there was something to apply.
 *
 * @param search   the query string to read (defaults to the page URL's)
 * @param clean    strip the query from the address bar afterwards (only
 *                 meaningful for the page's own URL)
 */
async function handleQueryParams(
	search: string = document.location.search,
	clean: boolean = true
): Promise<boolean> {
	if (!("URLSearchParams" in window) || !search) {
		return false;
	}

	const params = new URLSearchParams(search);
	const queryParams: LocationQueryRaw = params.has("uri")
		? // Set default connection settings from IRC protocol links
		  (parseIrcUri(String(params.get("uri"))) as LocationQueryRaw)
		: // Set default connection settings from url params
		  Object.fromEntries(params.entries());

	if (clean) {
		removeQueryParams();
	}

	await router.push({name: "Connect", query: queryParams});
	return true;
}

function hasStoredSetting(name: string): boolean {
	try {
		const stored: unknown = JSON.parse(storage.get("settings") || "{}");
		return typeof stored === "object" && stored !== null && name in stored;
	} catch (e) {
		return false;
	}
}

function setThemeColor(color: string): void {
	const meta = document.querySelector('meta[name="theme-color"]');

	if (meta instanceof HTMLMetaElement) {
		meta.content = color;
	}
}

// Remove query parameters from url without reloading the page
function removeQueryParams(): void {
	const cleanUri = window.location.origin + window.location.pathname + window.location.hash;
	window.history.replaceState(null, "", cleanUri);
}
