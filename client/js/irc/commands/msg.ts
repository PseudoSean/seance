/**
 * `/msg <target> <text>`, `/query <nick> [text]`, `/say <text>` (and plain text).
 * Ported from attic/server/plugins/inputs/msg.ts.
 */

import {ChanType} from "../../../../shared/types/chan";
import {MessageType} from "../../../../shared/types/msg";
import type {Command, CommandContext} from "../types";

function openQuery({client, chan}: CommandContext, targetName: string): boolean {
	if (client.findChannel(targetName)) {
		return true;
	}

	if (client.isChannelName(targetName)) {
		client.pushMessage(chan, {
			type: MessageType.ERROR,
			text: "You can not open query windows for channels, use /join instead.",
		});
		return false;
	}

	if (client.isupport.prefix.symbols.includes(targetName[0])) {
		client.pushMessage(chan, {
			type: MessageType.ERROR,
			text: "You can not open query windows for names starting with a user prefix.",
		});
		return false;
	}

	client.announceChannel(targetName, ChanType.QUERY, {shouldOpen: true});
	return true;
}

const msg: Command = {
	commands: ["query", "msg", "say"],
	input(ctx) {
		const {client, chan, cmd, args} = ctx;
		const targetName = cmd === "say" ? chan.name : args.shift();

		if (cmd === "query") {
			if (!targetName) {
				client.pushMessage(chan, {
					type: MessageType.ERROR,
					text: "You cannot open a query window without an argument.",
				});
				return;
			}

			if (!openQuery(ctx, targetName)) {
				return;
			}
		}

		if (!targetName || args.length === 0) {
			return;
		}

		const text = args.join(" ");

		if (text.length === 0) {
			return;
		}

		client.sendMessage(targetName, text);
	},
};

export default msg;
