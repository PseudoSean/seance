/**
 * `/topic [text]` (query or set) and `/cleartopic`.
 */

import {ChanType} from "../../../../shared/types/chan";
import {MessageType} from "../../../../shared/types/msg";
import {formatLine} from "../message";
import {trailingLine} from "../wire";
import type {Command} from "../types";

const topic: Command = {
	commands: ["topic", "cleartopic"],
	input({client, chan, cmd, args, rest}) {
		if (chan.type !== ChanType.CHANNEL) {
			client.pushMessage(chan, {
				type: MessageType.ERROR,
				text: `${cmd} command can only be used in channels.`,
			});
			return;
		}

		if (cmd === "cleartopic") {
			client.send(formatLine({command: "TOPIC", params: [chan.name, ""]}));
			return;
		}

		if (args.every((arg) => arg.trim() === "")) {
			client.send(formatLine({command: "TOPIC", params: [chan.name]}));
			return;
		}

		// Untrimmed on purpose: the user may have added whitespace deliberately.
		client.send(trailingLine("TOPIC", [chan.name, rest]));
	},
};

export default topic;
