/**
 * `/raw`, `/quote`, `/send`: the rest of the line goes to the server verbatim.
 */

import type {Command} from "../types";

const raw: Command = {
	commands: ["raw", "send", "quote"],
	input({client, rest}) {
		if (rest.trim().length > 0) {
			client.send(rest);
		}
	},
};

export default raw;
