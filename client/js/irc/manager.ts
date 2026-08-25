/**
 * NetworkManager: the registry of live {@link IrcClient}s keyed by network
 * uuid. Imported once at boot for its side effect (registering the bus
 * handlers, see `bus.ts`); the connect form calls {@link createNetwork}.
 *
 * Several networks can be live at once: each has its own client, channel ids
 * are allocated from one shared counter so the bus can route `input` /
 * `open` / `names` / `more` by channel id, and every client's `init` carries
 * all networks (`networksForInit`) because the store's `init` listener
 * replaces the network list wholesale.
 *
 * Network configs are persisted in localStorage by `saved-networks.ts`; a
 * successful `createNetwork` saves/updates the entry and marks it last used.
 */

import socket from "../socket";
import {store} from "../store";
import {parseKeywordList} from "../highlight";
import {setMuteStatus} from "../mute";
import {registerBusHandlers} from "./bus";
import {IrcClient} from "./client";
import * as saved from "./saved-networks";
import type {SavedNetwork} from "./saved-networks";
import type {ConnectOptions} from "./types";

const clients = new Map<string, IrcClient>();

/**
 * What the connect form (or `network:new`) hands us: connection details plus
 * the optional saved-network extras. Without a `uuid` an existing entry for
 * the same host/port/nick is reused, else a fresh one is generated.
 */
export type CreateNetworkOptions = ConnectOptions &
	Partial<Pick<SavedNetwork, "uuid" | "name" | "autoconnect" | "rememberPassword" | "commands">>;

function highlightKeywords() {
	return {
		keywords: parseKeywordList(store.state.settings.highlights),
		exceptions: parseKeywordList(store.state.settings.highlightExceptions),
	};
}

/** `SharedNetwork` snapshots of every network, for `init`. */
function allNetworks() {
	return Array.from(clients.values()).map((client) => client.network);
}

/** Persist the entry for these options and return it (with the live password). */
function rememberNetwork(options: CreateNetworkOptions): SavedNetwork {
	const uuid =
		options.uuid ||
		saved.findMatching(options.host, options.port, options.nick)?.uuid ||
		saved.newUuid();
	const existing = saved.get(uuid);
	const merged: Record<string, unknown> = {...(existing ?? {}), uuid};

	for (const [key, value] of Object.entries(options)) {
		if (value !== undefined) {
			merged[key] = value;
		}
	}

	const entry = saved.normalize(merged);

	if (!entry) {
		throw new Error("createNetwork: missing uuid");
	}

	saved.save(entry);
	saved.touchLastUsed(uuid);
	return entry;
}

/** Create (or reuse) the client for these options, save the config and connect. */
export function createNetwork(options: CreateNetworkOptions): IrcClient {
	const entry = rememberNetwork(options);
	let client = clients.get(entry.uuid);

	if (!client) {
		client = new IrcClient({
			...saved.toConnectOptions(entry),
			uuid: entry.uuid,
			highlights: highlightKeywords,
			networksForInit: allNetworks,
			setMuteStatus,
		});
		clients.set(entry.uuid, client);

		if (entry.name) {
			client.setNetworkName(entry.name);
		}
	}

	client.connect();
	return client;
}

/**
 * Connect every saved network flagged `autoconnect`. Runs once per page load
 * (the connect screen calls it on mount); entries that need a SASL password
 * that was not remembered are skipped so the user can type it.
 */
let autoconnectDone = false;

export function autoconnectSavedNetworks(): IrcClient[] {
	if (autoconnectDone) {
		return [];
	}

	autoconnectDone = true;
	const started: IrcClient[] = [];

	for (const entry of saved.list()) {
		if (!entry.autoconnect || clients.has(entry.uuid)) {
			continue;
		}

		if (entry.sasl === "plain" && !entry.saslPassword) {
			continue;
		}

		started.push(createNetwork(entry));
	}

	return started;
}

export function clientForNetwork(uuid: string): IrcClient | undefined {
	return clients.get(uuid);
}

export function clientForChannel(chanId: number): IrcClient | undefined {
	for (const client of clients.values()) {
		if (client.channelById(chanId)) {
			return client;
		}
	}

	return undefined;
}

export function allClients(): IrcClient[] {
	return Array.from(clients.values());
}

registerBusHandlers(socket, {
	clientForChannel,
	clientForNetwork,
	allClients,
	createNetwork,
	remove: (uuid) => void clients.delete(uuid),
});

// Saved-network policies layered on top of the client's own events.

// A custom name from the edit form beats ISUPPORT NETWORK: when a client
// renames itself to something else, put the user's choice back (setNetworkName
// is a no-op when the name already matches, so this cannot loop).
socket.on("network:name", ({uuid, name}) => {
	const custom = saved.get(uuid)?.name;
	const client = clients.get(uuid);

	if (client && custom && custom !== name) {
		client.setNetworkName(custom);
	}
});

// Commands-on-connect: run the saved slash commands in the lobby after every
// registration, like the old server's `connection.ts` did.
socket.on("network:status", ({network, connected}) => {
	if (!connected) {
		return;
	}

	const client = clients.get(network);
	const commands = saved.get(network)?.commands ?? [];

	if (client && client.isConnected) {
		for (const command of commands) {
			client.input(client.lobby.id, command);
		}
	}
});
