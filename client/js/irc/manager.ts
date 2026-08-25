/**
 * NetworkManager: the registry of live {@link IrcClient}s keyed by network
 * uuid. Imported once at boot for its side effect (registering the bus
 * handlers, see `bus.ts`); the connect form calls {@link createNetwork}.
 *
 * Nothing is persisted yet (phase D).
 */

import socket from "../socket";
import {store} from "../store";
import {parseKeywordList} from "../highlight";
import {registerBusHandlers} from "./bus";
import {deriveUuid, IrcClient} from "./client";
import type {ConnectOptions} from "./types";

const clients = new Map<string, IrcClient>();

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

/** Create (or reuse) the client for these options and connect it. */
export function createNetwork(options: ConnectOptions): IrcClient {
	const uuid = deriveUuid(options.host, options.port, options.nick);
	let client = clients.get(uuid);

	if (!client) {
		client = new IrcClient({
			...options,
			uuid,
			highlights: highlightKeywords,
			networksForInit: allNetworks,
		});
		clients.set(uuid, client);
	}

	client.connect();
	return client;
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
