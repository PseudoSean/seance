/**
 * `/react <text> [msgid]` and `/unreact <text> [msgid]`: a `+draft/react` /
 * `+draft/unreact` TAGMSG on a message in the current channel or query.
 * `text` is one word (an emoji, usually); the msgid defaults to the newest
 * message here that has one.
 */

import {ChanType} from "../../../../shared/types/chan";
import {MessageType} from "../../../../shared/types/msg";
import type {Command} from "../types";

const react: Command = {
	commands: ["react", "unreact"],
	input({client, chan, cmd, args}) {
		if (chan.type !== ChanType.CHANNEL && chan.type !== ChanType.QUERY) {
			client.pushMessage(chan, {
				type: MessageType.ERROR,
				text: `${cmd} command can only be used in channels and queries.`,
			});
			return;
		}

		const [text = "", explicit] = args.filter((arg) => arg.length > 0);

		if (text.length === 0) {
			client.pushMessage(chan, {
				type: MessageType.ERROR,
				text: `Usage: /${cmd} <text> [msgid]`,
			});
			return;
		}

		const msgid = explicit ?? chan.newestMsgid();

		if (!msgid) {
			client.pushMessage(chan, {
				type: MessageType.ERROR,
				text: "No message to react to: none here carries a msgid.",
			});
			return;
		}

		client.react(chan, msgid, text, cmd === "unreact");
	},
};

export default react;
