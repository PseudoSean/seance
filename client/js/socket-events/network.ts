import socket from "../socket";
import {getPendingTarget, isChannelTarget, takePendingTarget} from "../helpers/pendingTarget";
import {beginLanding, pendingLanding, takeLanding} from "../helpers/lastChannel";
import {store} from "../store";
import {findChannelByName, switchToChannel} from "../router";
import {toClientChan} from "../chan";
import {ClientNetwork} from "../types";
import {ChanState} from "../../../shared/types/chan";
import {applyStoredChannelOrder, applyStoredNetworkOrder} from "../sort";
import {applyStoredMuteStatus} from "../mute";

socket.on("network", function (data) {
	const network: ClientNetwork = {
		...data.network,
		channels: data.network.channels.map(toClientChan),
		isJoinChannelShown: false,
		isCollapsed: false,
	};

	applyStoredChannelOrder(network);
	applyStoredMuteStatus(network);
	store.commit("networks", [...store.state.networks, network]);
	applyStoredNetworkOrder();

	openOnAnnounce(network);
});

/**
 * Where the view goes while the network connects. In order: the conversation
 * a notification deep link is waiting for on it, the one the last page had
 * open on it (helpers/lastChannel.ts), else — as always — the last channel
 * of the join list. The autojoin channels are already here as placeholders,
 * so a deep link or a remembered channel that is one of them is shown at
 * once. One that is not (a private conversation, a channel a held session
 * will restore) is waited for in the lobby: the `network:status` handler
 * below reopens a query once registered, and socket-events/join.ts lands on
 * the join when it comes. Waiting in the lobby rather than on a placeholder
 * matters — what is shown is what gets remembered, and an automatic stop
 * must not overwrite the memory.
 */
function openOnAnnounce(network: ClientNetwork): void {
	const pending = getPendingTarget();
	const fromDeepLink = pending !== null && pending.network === network.uuid;
	const waitingFor = fromDeepLink ? pending : beginLanding(network.uuid);

	if (!waitingFor) {
		switchToChannel(network.channels[network.channels.length - 1]);
		return;
	}

	const hit = findChannelByName(network.uuid, waitingFor.target);

	if (!hit) {
		switchToChannel(network.channels[0]);
		return;
	}

	if (fromDeepLink) {
		takePendingTarget();
	} else {
		takeLanding();
	}

	switchToChannel(hit);
}

socket.on("network:options", function (data) {
	const network = store.getters.findNetwork(data.network);

	if (network) {
		network.serverOptions = data.serverOptions;
	}
});

socket.on("network:status", function (data) {
	const network = store.getters.findNetwork(data.network);

	if (!network) {
		return;
	}

	network.status.connected = data.connected;
	network.status.connecting = data.connecting;
	network.status.secure = data.secure;

	// A private conversation to reopen now that we are registered: the one
	// a notification deep link names, or the one the last page had open.
	// Channels arrive with the join burst, a query window only when opened —
	// do that now (the resulting `join` lands on it).
	const pending = getPendingTarget();
	const waitingFor =
		pending !== null && pending.network === data.network
			? pending
			: pendingLanding(data.network);

	if (
		data.connected &&
		waitingFor &&
		!isChannelTarget(waitingFor.target) &&
		network.channels.length > 0
	) {
		socket.emit("input", {
			target: network.channels[0].id,
			text: `/query ${waitingFor.target}`,
		});
	}

	if (!data.connected) {
		network.channels.forEach((channel) => {
			channel.users = []; // TODO: untangle this
			channel.state = ChanState.PARTED;
		});
	}
});

socket.on("channel:state", function (data) {
	const channel = store.getters.findChannel(data.chan);

	if (channel) {
		channel.channel.state = data.state;
	}
});

socket.on("network:info", function (data) {
	const network = store.getters.findNetwork(data.uuid);

	if (!network) {
		return;
	}

	for (const key in data) {
		network[key] = data[key];
	}
});

socket.on("network:name", function (data) {
	const network = store.getters.findNetwork(data.uuid);

	if (network) {
		network.name = network.channels[0].name = data.name;
	}
});
