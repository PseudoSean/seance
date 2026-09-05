import socket from "../socket";
import {store} from "../store";
import {switchToChannel} from "../router";
import {ClientChan} from "../types";
import {toClientChan} from "../chan";
import {ChanType} from "../../../shared/types/chan";
import {getPendingTarget, matchesPendingTarget, takePendingTarget} from "../helpers/pendingTarget";
import {matchesLanding, pendingLanding, takeLanding} from "../helpers/lastChannel";

socket.on("join", function (data) {
	const network = store.getters.findNetwork(data.network);

	if (!network) {
		return;
	}

	const clientChan: ClientChan = toClientChan(data.chan);
	network.channels.splice(data.index || -1, 0, clientChan);

	// A notification deep link is waiting for exactly this conversation.
	if (matchesPendingTarget(data.network, clientChan.name)) {
		takePendingTarget();
		switchToChannel(clientChan);
		return;
	}

	// The conversation the last page had open, arriving now: a query
	// reopened once registered, a channel a held session restores
	// (helpers/lastChannel.ts).
	if (matchesLanding(data.network, clientChan.name)) {
		takeLanding();
		switchToChannel(clientChan);
		return;
	}

	// The user asked for this window (/join, /query, whois): show it.
	if (data.shouldOpen) {
		switchToChannel(clientChan);
		return;
	}

	// Waiting for a conversation on this network: nothing else moves the
	// view meanwhile (the join burst would otherwise walk it through every
	// channel that arrives).
	if (getPendingTarget() !== null || pendingLanding(data.network) !== null) {
		return;
	}

	// An incoming private message opens its window quietly.
	if (data.chan.type === ChanType.QUERY) {
		return;
	}

	switchToChannel(clientChan);
});
