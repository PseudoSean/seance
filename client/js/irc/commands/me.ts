/**
 * `/me <text>` and `/slap <nick>`: CTCP ACTION to the current channel or query.
 */

import {ChanType} from "../../../../shared/types/chan";
import {MessageType} from "../../../../shared/types/msg";
import type {Command} from "../types";

const me: Command = {
	commands: ["slap", "me"],
	input({client, chan, cmd, args}) {
		if (chan.type !== ChanType.CHANNEL && chan.type !== ChanType.QUERY) {
			client.pushMessage(chan, {
				type: MessageType.ERROR,
				text: `${cmd} command can only be used in channels and queries.`,
			});
			return;
		}

		if (args.length === 0) {
			return;
		}

		const text =
			cmd === "slap" ? `slaps ${args[0]} around a bit with a large trout` : args.join(" ");

		if (text.length > 0) {
			client.sendMessage(chan.name, text, {action: true});
		}
	},
};

export default me;
