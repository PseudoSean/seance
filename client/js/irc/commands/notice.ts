/**
 * `/notice <target> <text>`. Without `echo-message` the client feeds the
 * notice back through the inbound handlers (see `IrcClient.sendMessage`).
 */

import type {Command} from "../types";

const notice: Command = {
	commands: ["notice"],
	input({client, args}) {
		if (!args[0] || !args[1]) {
			return;
		}

		client.sendMessage(args[0], args.slice(1).join(" "), {notice: true});
	},
};

export default notice;
