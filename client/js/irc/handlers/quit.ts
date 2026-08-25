/**
 * QUIT: one message in every channel the user shared with us.
 */

import {MessageType} from "../../../../shared/types/msg";
import type {Handler} from "../types";

const quit: Handler = (client, msg) => {
	const nick = msg.source?.name ?? "";
	const reason = msg.params[0] ?? "";

	if (!nick) {
		return;
	}

	const time = client.timeOf(msg);

	if (client.replaying) {
		// History (draft/event-playback): the batch's channel, no user-list change.
		const chan = client.replayTarget;

		if (chan) {
			client.pushMessage(chan, {
				type: MessageType.QUIT,
				time,
				from: chan.userRef(nick),
				hostmask: `${msg.source?.user ?? ""}@${msg.source?.host ?? ""}`,
				text: reason,
			});
		}

		return;
	}

	for (const chan of client.channels) {
		if (!chan.findUser(nick)) {
			continue;
		}

		client.pushMessage(chan, {
			type: MessageType.QUIT,
			time,
			from: chan.userRef(nick),
			hostmask: `${msg.source?.user ?? ""}@${msg.source?.host ?? ""}`,
			text: reason,
		});
		chan.removeUser(nick);
	}
};

export default {QUIT: quit};
