// Application boot sequence.
//
// TheLounge drove this from a chain of server events (`auth:start` ->
// `auth:success` -> `configuration` -> `init`). With no server, boot is
// synchronous and purely local: install the static configuration, apply
// stored settings, mark the app loaded, drop the loading splash and put the
// router on a sensible route (the connect form unless the URL says otherwise).

import configuration from "./configuration";
import {router, navigate} from "./router";
import {store} from "./store";
import parseIrcUri from "./helpers/parseIrcUri";
import {loadMentions} from "./mentions";
// Registers the IRC layer's bus handlers (input, names, more, network:*).
import "./irc/manager";

declare global {
	interface Window {
		g_TheLoungeRemoveLoading?: () => void;
	}
}

export async function boot(): Promise<void> {
	store.commit("serverConfiguration", configuration);

	// 'theme' setting depends on serverConfiguration.themes so
	// settings cannot be applied before this point
	void store.dispatch("settings/applyAll");

	// If localStorage contains a theme that does not exist in this build, switch
	// back to the default theme.
	const currentTheme = configuration.themes.find((t) => t.name === store.state.settings.theme);

	if (currentTheme === undefined) {
		void store.dispatch("settings/update", {
			name: "theme",
			value: configuration.defaultTheme,
		});
	} else if (currentTheme.themeColor) {
		const meta = document.querySelector('meta[name="theme-color"]');

		if (meta instanceof HTMLMetaElement) {
			meta.content = currentTheme.themeColor;
		}
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

// Remove query parameters from url without reloading the page
function removeQueryParams(): void {
	const cleanUri = window.location.origin + window.location.pathname + window.location.hash;
	window.history.replaceState(null, "", cleanUri);
}
