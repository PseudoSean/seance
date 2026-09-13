// Fabricate a connected network in the running app, without an ircd: the
// snippet dispatches the same `init` bus event a registration dispatches
// (client/js/irc/client.ts onRegistered → bus.dispatch("init")), so the
// store, sidebar and chat window render exactly what a real connection
// would show. Rendering-only scenarios (i18n direction checks) use this to
// get sidebar rows, a channel window with messages and the composer without
// dialling anything.
//
// window.socket is dev-build-only (client/js/socket.ts), so scenarios that
// use this must run against a development build; the snippet reports false
// when the exposure is missing so the scenario can say so instead of
// failing cryptically.
//
// The network is memory-only: it lives until the next navigation.

const NOW = "Date.now()";

/**
 * JS source that evaluates to true when the dispatch ran, false when
 * `window.socket` is absent (production build).
 *
 * One network ("TestNet") with a lobby, `#seance` (the active channel,
 * carrying a few messages) and a query row in the sidebar.
 */
export const FAKE_NETWORK_SNIPPET = `(() => {
	if (typeof window.socket === "undefined") {
		return false;
	}

	const now = ${NOW};
	const base = {mode: "", modes: [], away: "", lastMessage: now};
	const message = (id, from, text, minutesAgo) => ({
		id,
		type: "message",
		from: {...base, nick: from},
		text,
		self: from === "seanobot",
		time: new Date(now - minutesAgo * 60000),
		users: [],
	});
	const lobby = {
		id: 1,
		name: "TestNet",
		key: "",
		topic: "",
		firstUnread: 0,
		unread: 0,
		highlight: 0,
		muted: false,
		type: "lobby",
		state: 1,
		messages: [],
		totalMessages: 0,
	};
	const channel = {
		id: 2,
		name: "#seance",
		key: "",
		topic: "A room with mirrors on every wall",
		firstUnread: 0,
		unread: 0,
		highlight: 0,
		muted: false,
		type: "channel",
		state: 1,
		messages: [
			message(3, "moria", "the new channel theme renders mirrored under the pseudo locale", 24),
			message(4, "seanobot", "short one", 21),
			message(
				5,
				"moria",
				"a much longer line that has to wrap somewhere: the gutter keeps its columns while the text takes what width remains, exactly what the direction check wants to measure",
				18
			),
		],
		totalMessages: 3,
	};
	const query = {
		id: 3,
		name: "moria",
		key: "",
		topic: "",
		firstUnread: 0,
		unread: 0,
		highlight: 0,
		muted: false,
		type: "query",
		state: 1,
		messages: [],
		totalMessages: 0,
	};
	const network = {
		uuid: "fake-0000-0000",
		name: "TestNet",
		nick: "seanobot",
		serverOptions: {
			CHANTYPES: ["#"],
			PREFIX: {prefix: [{symbol: "@", mode: "o"}], modeToSymbol: {o: "@"}, symbols: ["@"]},
			NETWORK: "TestNet",
		},
		status: {connected: true, connecting: false, secure: false},
		channels: [lobby, channel, query],
	};
	window.socket.dispatch("init", {active: channel.id, networks: [network]});
	return true;
})()`;
