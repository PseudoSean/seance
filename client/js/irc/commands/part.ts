/**
 * `/part [#chan] [reason]`, `/leave`, `/close`. Queries, parted channels and
 * anything while disconnected are removed locally; joined channels send PART
 * and wait for the server's echo.
 */

import {ChanState, ChanType} from "../../../../shared/types/chan";
import {MessageType} from "../../../../shared/types/msg";
import {trailingLine} from "../wire";
import type {Command} from "../types";

const part: Command = {
	commands: ["close", "leave", "part"],
	allowDisconnected: true,
	input({client, chan, args}) {
		let target = chan;

		if (args.length > 0) {
			const named = client.findChannel(args[0]);

			if (named) {
				target = named;
				args.shift();
			}
		}

		if (target.type === ChanType.LOBBY) {
			client.pushMessage(chan, {
				type: MessageType.ERROR,
				text: "You can not part from networks, use /quit instead.",
			});
			return;
		}

		if (
			target.type !== ChanType.CHANNEL ||
			target.state === ChanState.PARTED ||
			!client.isConnected
		) {
			target.autoJoin = false;
			client.removeChannel(target);
			return;
		}

		const reason = args.join(" ") || client.options.leaveMessage || "Seance";
		client.send(trailingLine("PART", [target.name, reason]));
	},
};

export default part;
