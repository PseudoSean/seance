/**
 * JOIN (with `extended-join`: `JOIN #chan account :realname`).
 * Ported from attic/server/plugins/irc-events/join.ts.
 */

import {ChanState, ChanType} from "../../../../shared/types/chan";
import {MessageType, SharedMsg} from "../../../../shared/types/msg";
import {newUser} from "../channel";
import {IrcMessage} from "../message";
import type {Handler} from "../types";

/** `{msgid}` when the line carries one (history dedupe / catch-up reference). */
function msgidOf(msg: IrcMessage): {msgid?: string} {
	const msgid = msg.tags.get("msgid");
	return msgid ? {msgid} : {};
}

const join: Handler = (client, msg) => {
	const [name, account, gecos] = msg.params;
	const nick = msg.source?.name ?? "";

	if (!name || !nick) {
		return;
	}

	const self = client.isSelf(nick);
	let chan = client.findChannel(name);

	if (client.replaying) {
		// History (draft/event-playback): a message only, no state changes.
		chan = chan ?? client.replayTarget;

		if (chan) {
			client.pushMessage(chan, {
				type: MessageType.JOIN,
				time: client.timeOf(msg),
				from: chan.userRef(nick),
				hostmask: `${msg.source?.user ?? ""}@${msg.source?.host ?? ""}`,
				self,
				...msgidOf(msg),
			});
		}

		return;
	}

	if (!chan) {
		if (!self) {
			return; // a JOIN for a channel we are not in: nothing to attach it to
		}

		chan = client.announceChannel(name, ChanType.CHANNEL, {state: ChanState.JOINED});
	} else if (self && chan.state !== ChanState.JOINED) {
		chan.state = ChanState.JOINED;
		chan.users.clear();
		client.dispatch("channel:state", {chan: chan.id, state: chan.state});
	}

	// Re-joining after a drop, or the server restoring a held session
	// (draft/persistence): membership is state, not something that happened.
	const quiet = self && (chan.rejoining || client.restoring);

	if (self) {
		chan.autoJoin = true;
		// The channel modes are asked for lazily, the first time the channel
		// is opened (IrcClient.open): one MODE per autojoined channel at
		// connect time is part of the burst that trips the server's flood
		// penalty (see catchup.ts).
		chan.modesKnown = false;
	}

	const message: Partial<SharedMsg> = {
		type: MessageType.JOIN,
		time: client.timeOf(msg),
		from: chan.userRef(nick),
		hostmask: `${msg.source?.user ?? ""}@${msg.source?.host ?? ""}`,
		self,
		...msgidOf(msg),
	};

	if (account && account !== "*") {
		// The shared type says boolean but join.vue prints it as text.
		(message as {account?: string}).account = account;
	}

	if (gecos) {
		message.gecos = gecos;
	}

	if (!quiet) {
		client.pushMessage(chan, message);
	}

	if (!chan.findUser(nick)) {
		chan.setUser(newUser(nick));
	}

	client.usersChanged(chan);
};

export default {JOIN: join};
