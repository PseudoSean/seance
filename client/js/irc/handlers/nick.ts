/**
 * NICK: rename across every channel; update our own nick when it is us.
 */

import {MessageType} from "../../../../shared/types/msg";
import type {Handler} from "../types";

const nick: Handler = (client, msg) => {
	const oldNick = msg.source?.name ?? "";
	const newNick = msg.params[0] ?? "";

	if (!oldNick || !newNick) {
		return;
	}

	if (client.isSelf(oldNick)) {
		client.setNick(newNick);
		client.pushMessage(client.lobby, {text: `You're now known as ${newNick}`}, true);
	}

	const time = client.timeOf(msg);

	for (const chan of client.channels) {
		const user = chan.findUser(oldNick);

		if (!user) {
			continue;
		}

		client.pushMessage(chan, {
			type: MessageType.NICK,
			time,
			from: {nick: oldNick, mode: user.mode},
			new_nick: newNick,
		});
		chan.renameUser(oldNick, newNick);
		client.usersChanged(chan);
	}
};

export default {NICK: nick};
