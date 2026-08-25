/**
 * `/ctcp <nick> <type> [args]`: send a CTCP request and note it locally.
 */

import {MessageType} from "../../../../shared/types/msg";
import {trailingLine} from "../wire";
import type {Command} from "../types";

const ctcp: Command = {
	commands: ["ctcp"],
	input({client, chan, args}) {
		const params = args.filter((arg) => arg.length > 0);

		if (params.length < 2) {
			client.pushMessage(chan, {
				type: MessageType.ERROR,
				text: "Usage: /ctcp <nick> <ctcp_type>",
			});
			return;
		}

		const [target, rawType, ...rest] = params;
		const type = rawType.toUpperCase();

		client.pushMessage(chan, {
			type: MessageType.CTCP_REQUEST,
			ctcpMessage: `"${type}" to ${target}`,
			from: chan.userRef(client.nick),
		});

		client.send(trailingLine("PRIVMSG", [target, `\x01${[type, ...rest].join(" ")}\x01`]));
	},
};

export default ctcp;
