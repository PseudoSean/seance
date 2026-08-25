// Network / channel ordering, persisted in localStorage.
//
// TheLounge sent `sort:networks` / `sort:channels` to the server which saved
// the order and echoed it back as `sync_sort:*`. Here the client is the only
// party, so the order is applied to the store directly and remembered locally
// so it can be re-applied when networks are (re)created.

import storage from "./localStorage";
import {store} from "./store";
import {ClientNetwork} from "./types";
import {ChanType} from "../../shared/types/chan";

const NETWORKS_KEY = "thelounge.sort.networks";
const CHANNELS_KEY = "thelounge.sort.channels";

type StoredChannelOrder = Record<string, string[]>;

function readJson<T>(key: string, fallback: T): T {
	try {
		const raw = storage.get(key);
		return raw ? (JSON.parse(raw) as T) : fallback;
	} catch (e) {
		storage.remove(key);
		return fallback;
	}
}

export function sortNetworks(order: string[]): void {
	store.commit("sortNetworks", (a, b) => order.indexOf(a.uuid) - order.indexOf(b.uuid));
	storage.set(NETWORKS_KEY, JSON.stringify(store.state.networks.map((n) => n.uuid)));
}

export function sortChannels(networkUuid: string, order: number[]): void {
	const network = store.getters.findNetwork(networkUuid);

	if (!network) {
		return;
	}

	network.channels.sort((a, b) => {
		// Always sort lobby to the top regardless of what the caller sent
		// because a lot of code presumes channels[0] is the lobby
		if (a.type === ChanType.LOBBY) {
			return -1;
		} else if (b.type === ChanType.LOBBY) {
			return 1;
		}

		return order.indexOf(a.id) - order.indexOf(b.id);
	});

	// Channel ids are per-session, so remember channel *names* instead
	const stored = readJson<StoredChannelOrder>(CHANNELS_KEY, {});
	stored[networkUuid] = network.channels.map((c) => c.name);
	storage.set(CHANNELS_KEY, JSON.stringify(stored));
}

/** Re-apply a previously stored ordering to the networks currently in the store. */
export function applyStoredNetworkOrder(): void {
	const order = readJson<string[]>(NETWORKS_KEY, []);

	if (order.length === 0) {
		return;
	}

	store.commit("sortNetworks", (a, b) => {
		const ia = order.indexOf(a.uuid);
		const ib = order.indexOf(b.uuid);

		// Unknown networks keep their relative position after known ones
		if (ia === -1 && ib === -1) {
			return 0;
		} else if (ia === -1) {
			return 1;
		} else if (ib === -1) {
			return -1;
		}

		return ia - ib;
	});
}

/** Re-apply a previously stored channel ordering to a network. */
export function applyStoredChannelOrder(network: ClientNetwork): void {
	const stored = readJson<StoredChannelOrder>(CHANNELS_KEY, {});
	const order = stored[network.uuid];

	if (!order || order.length === 0) {
		return;
	}

	network.channels.sort((a, b) => {
		if (a.type === ChanType.LOBBY) {
			return -1;
		} else if (b.type === ChanType.LOBBY) {
			return 1;
		}

		const ia = order.indexOf(a.name);
		const ib = order.indexOf(b.name);

		if (ia === -1 && ib === -1) {
			return 0;
		} else if (ia === -1) {
			return 1;
		} else if (ib === -1) {
			return -1;
		}

		return ia - ib;
	});
}
