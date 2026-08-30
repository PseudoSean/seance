/**
 * `/notice <target> <text>`. Without `echo-message` the client feeds the
 * notice back through the inbound handlers (see `IrcClient.sendMessage`).
 */

import type {Command} from "../types";
import {splitTarget} from "./target";

const notice: Command = {
	commands: ["notice"],
	input({client, rest}) {
		// The target ends at the first space or line feed, so a multi-line
		// notice keeps its line breaks in the body and out of the target.
		const {target, body} = splitTarget(rest);

		if (!target || body.length === 0) {
			return;
		}

		client.sendMessage(target, body, {notice: true});
	},
};

export default notice;
