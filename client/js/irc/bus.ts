/**
 * Services the client→server side of the event bus (`socket.emit(...)`) by
 * routing each emit to the {@link IrcClient} that owns the channel. Kept free
 * of store imports so it can run under mocha; `manager.ts` wires it up with
 * the real registry.
 */

import type {EventBus} from "../socket";
import type {IrcClient} from "./client";
import {requestMore} from "./history";
import * as saved from "./saved-networks";
import type {ConnectOptions} from "./types";

export interface ClientRegistry {
	clientForChannel(chanId: number): IrcClient | undefined;
	clientForNetwork(uuid: string): IrcClient | undefined;
	allClients(): IrcClient[];
	createNetwork(options: ConnectOptions): IrcClient;
	remove(uuid: string): void;
}

/**
 * What `network:info` carries: the saved entry (what the next connect will
 * use) merged over the live client's view, with the live nick and connection
 * state on top. `undefined` when the uuid is unknown on both sides.
 */
export function networkInfo(
	registry: ClientRegistry,
	uuid: string
): (Record<string, unknown> & {uuid: string}) | undefined {
	const client = registry.clientForNetwork(uuid);
	const stored = saved.get(uuid);

	if (!client && !stored) {
		return undefined;
	}

	return {
		...(client?.editableInfo ?? {}),
		...(stored ?? {}),
		uuid,
		name: stored?.name || client?.name || "",
		nick: client?.nick ?? stored?.nick ?? "",
		connected: client?.isConnected ?? false,
	};
}

export function registerBusHandlers(bus: EventBus, registry: ClientRegistry): void {
	bus.handle("input", ({target, text, reply, edit}) => {
		const client = registry.clientForChannel(target);

		if (client) {
			client.input(target, text, {reply, edit});
		} else {
			// eslint-disable-next-line no-console
			console.warn("[irc] input for unknown channel", target, text);
		}
	});

	bus.handle("msg:react", ({target, msgid, text, remove}) => {
		const client = registry.clientForChannel(target);
		const chan = client?.channelById(target);

		if (client && chan) {
			client.react(chan, msgid, text, remove ?? false);
		}
	});

	bus.handle("msg:redact", ({target, msgid, reason}) => {
		const client = registry.clientForChannel(target);
		const chan = client?.channelById(target);

		if (client && chan) {
			client.redact(chan, msgid, reason);
		}
	});

	bus.handle("open", (id) => {
		for (const client of registry.allClients()) {
			client.open(client.channelById(id) ? id : 0);
		}
	});

	bus.handle("names", ({target}) => {
		const client = registry.clientForChannel(target);
		const chan = client?.channelById(target);

		if (client && chan) {
			bus.dispatch("names", {
				id: target,
				users: chan.sortedUsers((symbol) => client.prefixRank(symbol)),
			});
		}
	});

	bus.handle("more", ({target, lastId}) => {
		const client = registry.clientForChannel(target);
		const chan = client?.channelById(target);

		// With draft/chathistory the reply follows when the batch closes (or
		// on FAIL / timeout, history.ts). Otherwise answer now, or the channel
		// stays in `historyLoading`.
		if (client && chan && requestMore(client, chan, lastId)) {
			return;
		}

		bus.dispatch("more", {
			chan: target,
			messages: [],
			totalMessages: chan?.shared.totalMessages ?? 0,
		});
	});

	bus.handle("network:get", (uuid) => {
		const info = networkInfo(registry, uuid);

		if (info) {
			bus.dispatch("network:info", info);
		}
	});

	bus.handle("network:edit", (data) => {
		const uuid = String(data.uuid ?? "");
		const client = registry.clientForNetwork(uuid);
		const existing = saved.get(uuid);

		if (!uuid || (!client && !existing)) {
			return;
		}

		// Unsaved live network (e.g. `/connect host`): seed from its options.
		const base = existing ?? saved.normalize({...(client?.editableInfo ?? {}), uuid});
		const next = saved.fromForm(data, base);
		saved.save(next);

		if (client) {
			// Host, port, TLS, channels and SASL: applied on the next connect,
			// or right away when the client is idle / waiting to reconnect.
			client.applySettings(saved.toConnectOptions(next));

			// Live-applicable fields: the nick (NICK when connected, local
			// otherwise — `/nick` does both) and the display name.
			if (next.nick && next.nick !== client.nick) {
				client.input(client.lobby.id, `/nick ${next.nick}`);
			}

			if (next.name && next.name !== client.name) {
				client.setNetworkName(next.name);
			}
		}

		const info = networkInfo(registry, uuid);

		if (info) {
			bus.dispatch("network:info", info);
		}
	});

	bus.handle("network:new", (data) => {
		registry.createNetwork(data as ConnectOptions);
	});

	bus.on("quit", ({network}) => {
		registry.remove(network);
	});
}
