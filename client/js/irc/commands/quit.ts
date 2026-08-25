/**
 * `/quit [reason]`: removes the network from the UI and closes the connection.
 */

import type {Command} from "../types";

const quit: Command = {
	commands: ["quit"],
	allowDisconnected: true,
	input({client, args}) {
		const reason = args.join(" ");
		client.quit(reason.length > 0 ? reason : undefined);
	},
};

export default quit;
