/**
 * AWAY (`away-notify`, and the server's echo of our own). Channel users get
 * `away` set silently; query windows show a message; our own goes to the lobby.
 */

import {ChanType} from "../../../../shared/types/chan";
import {MessageType} from "../../../../shared/types/msg";
import type {Handler} from "../types";

const away: Handler = (client, msg) => {
	const nick = msg.source?.name ?? "";
	const text = msg.params[0] ?? "";
	const type = text ? MessageType.AWAY : MessageType.BACK;
	const time = client.timeOf(msg);

	if (!nick) {
		return;
	}

	if (client.isSelf(nick)) {
		client.pushMessage(client.lobby, {type, time, text, self: true}, true);
		return;
	}

	for (const chan of client.channels) {
		if (chan.type === ChanType.QUERY) {
			if (!client.namesEqual(chan.name, nick) || chan.userAway === text) {
				continue;
			}

			chan.userAway = text;
			client.pushMessage(chan, {type, time, text, from: chan.userRef(nick)});
		} else if (chan.type === ChanType.CHANNEL) {
			const user = chan.findUser(nick);

			if (user) {
				user.away = text;
			}
		}
	}
};

export default {AWAY: away};
