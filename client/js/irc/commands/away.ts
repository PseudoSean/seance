/**
 * `/away [reason]` and `/back`. An `/away` without a reason still sets away
 * (with a single space, as the old server did).
 */

import {formatLine} from "../message";
import {trailingLine} from "../wire";
import type {Command} from "../types";

const away: Command = {
	commands: ["away", "back"],
	input({client, cmd, args}) {
		if (cmd === "away") {
			client.send(trailingLine("AWAY", [args.join(" ") || " "]));
			return;
		}

		client.send(formatLine({command: "AWAY", params: []}));
	},
};

export default away;
