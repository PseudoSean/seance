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
