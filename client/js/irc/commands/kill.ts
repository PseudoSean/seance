/**
 * `/kill <nick> [reason]` (operators only; the server answers 481 otherwise).
 */

import {trailingLine} from "../wire";
import type {Command} from "../types";

const kill: Command = {
	commands: ["kill"],
	input({client, args}) {
		if (args.length === 0 || args[0].length === 0) {
			return;
		}

		client.send(trailingLine("KILL", [args[0], args.slice(1).join(" ")]));
	},
};

export default kill;
