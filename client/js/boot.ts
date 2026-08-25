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
import {store} from "./store";
import parseIrcUri from "./helpers/parseIrcUri";
import {loadMentions} from "./mentions";
import storage from "./localStorage";
// Registers the IRC layer's bus handlers (input, names, more, network:*).
import "./irc/manager";

declare global {
	interface Window {
		g_TheLoungeRemoveLoading?: () => void;
	}
}

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

	if (await handleQueryParams()) {
		// irc:// links or connect parameters in the URL already put us on
		// the connect form with those values pre-filled.
		return;
	}

	// If we are on an unknown route, open the last known channel, or the
	// connect form if there is none.
	if (!router.currentRoute.value.name) {
		if (store.state.networks.length > 0) {
			await navigate("RoutedChat", {id: store.state.networks[0].channels[0].id});
		} else {
			await navigate("Connect");
		}
	}
}

async function handleQueryParams(): Promise<boolean> {
	if (!("URLSearchParams" in window)) {
		return false;
	}

	const params = new URLSearchParams(document.location.search);

	if (params.has("uri")) {
		// Set default connection settings from IRC protocol links
		const uri = params.get("uri");
		const queryParams = parseIrcUri(String(uri));
		removeQueryParams();
		await router.push({name: "Connect", query: queryParams});
		return true;
	}

	if (document.location.search) {
		// Set default connection settings from url params
		const queryParams = Object.fromEntries(params.entries());
		removeQueryParams();
		await router.push({name: "Connect", query: queryParams});
		return true;
	}

	return false;
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
