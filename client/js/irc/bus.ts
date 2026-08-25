/**
 * Services the client→server side of the event bus (`socket.emit(...)`) by
 * routing each emit to the {@link IrcClient} that owns the channel. Kept free
 * of store imports so it can run under mocha; `manager.ts` wires it up with
 * the real registry.
 */

import type {EventBus} from "../socket";
import type {IrcClient} from "./client";
import type {ConnectOptions} from "./types";

export interface ClientRegistry {
	clientForChannel(chanId: number): IrcClient | undefined;
	clientForNetwork(uuid: string): IrcClient | undefined;
	allClients(): IrcClient[];
	createNetwork(options: ConnectOptions): IrcClient;
	remove(uuid: string): void;
}

export function registerBusHandlers(bus: EventBus, registry: ClientRegistry): void {
	bus.handle("input", ({target, text}) => {
		const client = registry.clientForChannel(target);

		if (client) {
			client.input(target, text);
		} else {
			// eslint-disable-next-line no-console
			console.warn("[irc] input for unknown channel", target, text);
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

	bus.handle("more", ({target}) => {
		// No history yet: always answer, or the channel stays in `historyLoading`.
		const chan = registry.clientForChannel(target)?.channelById(target);
		bus.dispatch("more", {
			chan: target,
			messages: [],
			totalMessages: chan?.shared.totalMessages ?? 0,
		});
	});

	bus.handle("network:get", (uuid) => {
		const client = registry.clientForNetwork(uuid);

		if (client) {
			bus.dispatch("network:info", {...client.editableInfo, uuid});
		}
	});

	bus.handle("network:edit", (data) => {
		const client = registry.clientForNetwork(String(data.uuid));

		if (!client) {
			return;
		}

		if (typeof data.nick === "string" && data.nick.length > 0 && data.nick !== client.nick) {
			client.input(client.lobby.id, `/nick ${data.nick}`);
		}

		if (typeof data.name === "string" && data.name.length > 0) {
			client.setNetworkName(data.name);
		}

		// eslint-disable-next-line no-console
		console.warn("[irc] network:edit: only nick and name are applied live for now");
	});

	bus.handle("network:new", (data) => {
		registry.createNetwork(data as ConnectOptions);
	});

	bus.on("quit", ({network}) => {
		registry.remove(network);
	});
}
