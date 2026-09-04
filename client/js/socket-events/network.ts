import socket from "../socket";
import {getPendingTarget, isChannelTarget} from "../helpers/pendingTarget";
import {store} from "../store";
import {switchToChannel} from "../router";
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

	// Open last channel specified in `join`
	switchToChannel(network.channels[network.channels.length - 1]);
});

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

	// A notification deep link to a private conversation: channels arrive
	// with the join burst, a query window only when opened — do that now
	// (the resulting `join` lands on it).
	const pending = getPendingTarget();

	if (
		data.connected &&
		pending &&
		pending.network === data.network &&
		!isChannelTarget(pending.target) &&
		network.channels.length > 0
	) {
		socket.emit("input", {target: network.channels[0].id, text: `/query ${pending.target}`});
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
