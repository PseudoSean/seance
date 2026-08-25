/**
 * LIST replies (321/322/323) → the "Channel List" special window, as
 * attic/server/plugins/irc-events/list.ts did: a status line while loading,
 * then the channels sorted by user count (capped at {@link MAX_CHANS}).
 *
 * Also home to {@link showSpecial}, the create-or-update helper every
 * `ChanType.SPECIAL` window (channel list, ignore list) goes through.
 */

import {ChanType, SpecialChanType} from "../../../../shared/types/chan";
import type {Channel} from "../channel";
import type {IrcClient} from "../client";
import type {Handler} from "../types";

export const CHANNEL_LIST_CHAN = "Channel List";
export const MAX_CHANS = 500;

export interface ChannelListEntry {
	channel: string;
	num_users: number;
	topic: string;
}

/** What `Special/ListChannels.vue` renders: a status line or the rows. */
export type ChannelListData = {text: string} | ChannelListEntry[];

/** Payload shape of `msg:special` / `SharedChan.data`. */
export type SpecialData = Record<string, any>;

const caches = new WeakMap<IrcClient, ChannelListEntry[]>();

function cacheFor(client: IrcClient): ChannelListEntry[] {
	let cache = caches.get(client);

	if (!cache) {
		cache = [];
		caches.set(client, cache);
	}

	return cache;
}

/** Forget any partially received list (called by `/list`). */
export function resetChannelList(client: IrcClient): void {
	caches.delete(client);
}

/**
 * Create the special window `name` (announcing it with `join`, not opened)
 * or, when it already exists, replace its data and dispatch `msg:special`
 * (which the UI answers by navigating to it).
 */
export function showSpecial(
	client: IrcClient,
	name: string,
	special: SpecialChanType,
	data: SpecialData
): Channel {
	const existing = client.findChannel(name);

	if (existing) {
		existing.shared.data = data;
		client.dispatch("msg:special", {chan: existing.id, data});
		return existing;
	}

	const {channel, index} = client.createChannel(name, ChanType.SPECIAL);
	channel.shared.special = special;
	channel.shared.data = data;
	client.dispatch("join", {
		network: client.uuid,
		chan: channel.snapshot(),
		index,
		shouldOpen: false,
	});
	return channel;
}

function updateListStatus(client: IrcClient, data: ChannelListData): void {
	showSpecial(client, CHANNEL_LIST_CHAN, SpecialChanType.CHANNELLIST, data);
}

// RPL_LISTSTART: <me> Channel :Users  Name
const listStart: Handler = (client) => {
	resetChannelList(client);
	updateListStatus(client, {text: "Loading channel list, this can take a moment..."});
};

// RPL_LIST: <me> <channel> <# visible> :<topic>
const listEntry: Handler = (client, msg) => {
	const [, channel, count, topic = ""] = msg.params;

	if (!channel) {
		return;
	}

	const cache = cacheFor(client);
	cache.push({channel, num_users: parseInt(count ?? "0", 10) || 0, topic});
	updateListStatus(client, {text: `Loaded ${cache.length} channels...`});
};

// RPL_LISTEND: <me> :End of /LIST
const listEnd: Handler = (client) => {
	const channels = cacheFor(client)
		.sort((a, b) => b.num_users - a.num_users)
		.slice(0, MAX_CHANS);
	resetChannelList(client);
	updateListStatus(client, channels);
};

export default {"321": listStart, "322": listEntry, "323": listEnd};
