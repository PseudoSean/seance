/**
 * `/ban <mask>`, `/unban <mask>`, `/kickban <nick> [reason]`, `/banlist`.
 * Ported from attic/server/plugins/inputs/ban.ts. The 367/368 replies to
 * `/banlist` are handled in `handlers/lists.ts`.
 */

import {ChanType} from "../../../../shared/types/chan";
import {MessageType} from "../../../../shared/types/msg";
import {formatLine} from "../message";
import {trailingLine} from "../wire";
import type {Command} from "../types";

const ban: Command = {
	commands: ["ban", "unban", "banlist", "kickban"],
	input({client, chan, cmd, args}) {
		if (chan.type !== ChanType.CHANNEL) {
			client.pushMessage(chan, {
				type: MessageType.ERROR,
				text: `${cmd} command can only be used in channels.`,
			});
			return;
		}

		if (cmd !== "banlist" && (args.length === 0 || args[0].length === 0)) {
			client.pushMessage(chan, {
				type: MessageType.ERROR,
				text: `Usage: /${cmd} <nick>`,
			});
			return;
		}

		switch (cmd) {
			case "kickban": {
				const reason = args.slice(1).join(" ");
				client.send(
					reason
						? trailingLine("KICK", [chan.name, args[0], reason])
						: formatLine({command: "KICK", params: [chan.name, args[0]]})
				);
				client.send(formatLine({command: "MODE", params: [chan.name, "+b", args[0]]}));
				break;
			}

			case "ban":
				client.send(formatLine({command: "MODE", params: [chan.name, "+b", args[0]]}));
				break;

			case "unban":
				client.send(formatLine({command: "MODE", params: [chan.name, "-b", args[0]]}));
				break;

			case "banlist":
				client.send(formatLine({command: "MODE", params: [chan.name, "b"]}));
				break;
		}
	},
};

export default ban;
