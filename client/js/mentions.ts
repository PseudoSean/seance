// Recent mentions, kept in the Vuex store and persisted in localStorage.
//
// TheLounge kept this list on the server (`mentions:get` / `mentions:dismiss`
// / `mentions:dismiss_all` / `mentions:list`). It is now purely local: the
// message handler records highlights as they arrive, and the store is
// mirrored to localStorage whenever it changes.

import storage from "./localStorage";
import {store} from "./store";
import {ClientMention} from "./types";

const KEY = "thelounge.mentions";
const MAX_MENTIONS = 100;

let watching = false;

function persist(): void {
	storage.set(KEY, JSON.stringify(store.state.mentions));
}

/** Load stored mentions into the store and start mirroring changes back. */
export function loadMentions(): void {
	let stored: ClientMention[] = [];

	try {
		stored = JSON.parse(storage.get(KEY) || "[]") as ClientMention[];
	} catch (e) {
		storage.remove(KEY);
	}

	if (!Array.isArray(stored)) {
		stored = [];
	}

	store.commit("mentions", stored);

	if (!watching) {
		watching = true;
		store.watch((state) => state.mentions, persist, {deep: true});
	}
}

export function addMention(mention: ClientMention): void {
	const mentions = store.state.mentions.filter((m) => m.msgId !== mention.msgId);
	mentions.push(mention);

	if (mentions.length > MAX_MENTIONS) {
		mentions.splice(0, mentions.length - MAX_MENTIONS);
	}

	store.commit("mentions", mentions);
}

export function dismissMention(msgId: number): void {
	store.commit(
		"mentions",
		store.state.mentions.filter((m) => m.msgId !== msgId)
	);
}

export function dismissAllMentions(): void {
	store.commit("mentions", []);
}
