import constants from "./constants";

import {createRouter, createWebHashHistory} from "vue-router";
import Connect from "../components/Windows/Connect.vue";
import Settings from "../components/Windows/Settings.vue";
import Help from "../components/Windows/Help.vue";
import Changelog from "../components/Windows/Changelog.vue";
import NetworkEdit from "../components/Windows/NetworkEdit.vue";
import SearchResults from "../components/Windows/SearchResults.vue";
import RoutedChat from "../components/RoutedChat.vue";
import {store} from "./store";

import AppearanceSettings from "../components/Settings/Appearance.vue";
import GeneralSettings from "../components/Settings/General.vue";
import AccountSettings from "../components/Settings/Account.vue";
import NotificationSettings from "../components/Settings/Notifications.vue";
import {ClientChan} from "./types";
import {shouldShowGeneralSettings} from "./helpers/settingsTabs";
import {clearPendingTarget, setPendingTarget} from "./helpers/pendingTarget";

const router = createRouter({
	history: createWebHashHistory(),
	routes: [
		{
			// Kept so old bookmarks don't 404; there is no sign-in step any more
			path: "/sign-in",
			redirect: {name: "Connect"},
		},
		{
			name: "Connect",
			path: "/connect",
			component: Connect,
			props: (route) => ({queryParams: route.query}),
		},
		{
			path: "/settings",
			component: Settings,
			children: [
				{
					name: "General",
					path: "",
					component: GeneralSettings,
					beforeEnter(to, from, next) {
						if (!shouldShowGeneralSettings()) {
							next({name: "Appearance"});
							return;
						}

						next();
					},
				},
				{
					name: "Appearance",
					path: "appearance",
					component: AppearanceSettings,
				},
				{
					name: "Account",
					path: "account",
					component: AccountSettings,
					props: true,
				},
				{
					name: "Notifications",
					path: "notifications",
					component: NotificationSettings,
				},
			],
		},
		{
			name: "Help",
			path: "/help",
			component: Help,
		},
		{
			name: "Changelog",
			path: "/changelog",
			component: Changelog,
		},
		{
			name: "NetworkEdit",
			path: "/edit-network/:uuid",
			component: NetworkEdit,
		},
		{
			name: "RoutedChat",
			path: "/chan-:id",
			component: RoutedChat,
		},
		{
			name: "SearchResults",
			path: "/chan-:id/search",
			component: SearchResults,
		},
		{
			// A conversation by network uuid + channel/nick: the deep link a
			// notification can still follow after the page — and its
			// session-local channel ids — is gone. Resolves to the channel
			// when it exists; otherwise remembers the target and lands on the
			// network (or the connect form, whose autoconnect brings the
			// network up) until the join for it arrives (socket-events/join.ts).
			name: "NetworkTarget",
			path: "/net/:uuid/:target",
			component: RoutedChat,
			beforeEnter(to) {
				const uuid = String(to.params.uuid);
				const target = String(to.params.target);
				const hit = findChannelByName(uuid, target);

				if (hit) {
					return {name: "RoutedChat", params: {id: hit.id}, replace: true};
				}

				setPendingTarget(uuid, target);
				const network = store.getters.findNetwork(uuid);

				if (network && network.channels.length > 0) {
					return {
						name: "RoutedChat",
						params: {id: network.channels[0].id},
						replace: true,
					};
				}

				return {name: "Connect", replace: true};
			},
		},
	],
});

/** A channel on `uuid` by name, case-insensitively (IRC names). */
function findChannelByName(uuid: string, name: string): ClientChan | undefined {
	const network = store.getters.findNetwork(uuid);
	const lower = name.toLowerCase();

	return network?.channels.find((c) => c.name.toLowerCase() === lower);
}

/** Show the conversation a notification names (network uuid + target),
 * or remember it until its join arrives. */
function openTarget(uuid: string, target: string): void {
	const hit = findChannelByName(uuid, target);

	if (hit) {
		clearPendingTarget();
		switchToChannel(hit);
		return;
	}

	setPendingTarget(uuid, target);
}

router.beforeEach((to, from, next) => {
	// Wait for boot to finish before allowing any navigation
	if (!store.state.appLoaded) {
		store.watch(
			(state) => state.appLoaded,
			() => next()
		);

		return;
	}

	next();
});

router.beforeEach((to, from) => {
	// Disallow navigating to non-existing routes
	if (!to.matched.length) {
		return false;
	}

	// Disallow navigating to invalid channels
	if (to.name === "RoutedChat" && !store.getters.findChannel(Number(to.params.id))) {
		return false;
	}

	// Disallow navigating to invalid networks
	if (to.name === "NetworkEdit" && !store.getters.findNetwork(String(to.params.uuid))) {
		return false;
	}

	return true;
});

router.afterEach((to) => {
	if (store.state.appLoaded) {
		if (window.innerWidth <= constants.mobileViewportPixels) {
			store.commit("sidebarOpen", false);
		}
	}

	if (store.state.activeChannel) {
		const channel = store.state.activeChannel.channel;

		if (to.name !== "RoutedChat") {
			store.commit("activeChannel", undefined);
		}

		// When switching out of a channel, mark everything as read
		if (channel.messages?.length > 0) {
			channel.firstUnread = channel.messages[channel.messages.length - 1].id;
		}

		if (channel.messages?.length > 100) {
			channel.messages.splice(0, channel.messages.length - 100);
			channel.moreHistoryAvailable = true;
		}
	}
});

async function navigate(routeName: string, params: any = {}) {
	if (router.currentRoute.value.name) {
		await router.push({name: routeName, params});
	} else {
		// If current route is null, replace the history entry
		// This prevents invalid entries from lingering in history,
		// and then the route guard preventing proper navigation
		await router.replace({name: routeName, params}).catch(() => {});
	}
}

function switchToChannel(channel: ClientChan) {
	void navigate("RoutedChat", {id: channel.id});
}

if ("serviceWorker" in navigator) {
	navigator.serviceWorker.addEventListener("message", (event) => {
		if (!event.data || event.data.type !== "open") {
			return;
		}

		// A notification click: by network + target when the worker knows
		// them (they outlive this page's channel ids), else by `chan-<id>`.
		if (typeof event.data.network === "string" && typeof event.data.target === "string") {
			openTarget(event.data.network, event.data.target);
			return;
		}

		if (typeof event.data.channel === "string" && event.data.channel.startsWith("chan-")) {
			const id = parseInt(event.data.channel.substring(5), 10); // remove "chan-" prefix
			const channelTarget = store.getters.findChannel(id);

			if (channelTarget) {
				switchToChannel(channelTarget.channel);
			}
		}
	});
}

export {router, navigate, switchToChannel, openTarget, findChannelByName};
