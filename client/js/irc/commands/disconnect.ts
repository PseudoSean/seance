/**
 * `/disconnect [reason]`: QUIT and close without reconnecting; the network
 * stays in the sidebar (`/connect` brings it back).
 */

import type {Command} from "../types";

const disconnect: Command = {
	commands: ["disconnect"],
	allowDisconnected: true,
	input({client, args}) {
		const reason = args.join(" ");
		client.disconnect(reason.length > 0 ? reason : undefined);
	},
};

export default disconnect;
