/**
 * `/ignore <nick[!ident][@host]>` and `/unignore <mask>`: edit the
 * network's localStorage-backed ignore list (`client/js/ignore.ts`).
 * Messages from matching senders are dropped in `handlers/privmsg.ts`.
 */

import {MessageType} from "../../../../shared/types/msg";
import {ignoreListFor} from "../../ignore";
import {formatHostmask, parseHostmask} from "../hostmask";
import type {Command} from "../types";

const ignore: Command = {
	commands: ["ignore", "unignore"],
	allowDisconnected: true,
	input({client, chan, cmd, args}) {
		const target = (args[0] ?? "").trim();

		if (target.length === 0) {
			client.pushMessage(chan, {
				type: MessageType.ERROR,
				text: `Usage: /${cmd} <nick>[!ident][@host]`,
			});
			return;
		}

		const list = ignoreListFor(client.uuid);
		const hostmask = parseHostmask(target);
		// Bold + reset, as the old server formatted it.
		const pretty = `\u0002${formatHostmask(hostmask)}\u000f`;

		if (cmd === "ignore") {
			if (client.isSelf(hostmask.nick)) {
				client.pushMessage(chan, {
					type: MessageType.ERROR,
					text: "You can't ignore yourself",
				});
				return;
			}

			if (!list.add(target)) {
				client.pushMessage(chan, {
					type: MessageType.ERROR,
					text: "The specified user/hostmask is already ignored",
				});
				return;
			}

			// The old server reported success as an ERROR-type message too.
			client.pushMessage(chan, {
				type: MessageType.ERROR,
				text: `${pretty} added to ignorelist`,
			});
			return;
		}

		if (!list.remove(target)) {
			client.pushMessage(chan, {
				type: MessageType.ERROR,
				text: "The specified user/hostmask is not ignored",
			});
			return;
		}

		client.pushMessage(chan, {
			type: MessageType.ERROR,
			text: `Successfully removed ${pretty} from ignorelist`,
		});
	},
};

export default ignore;
