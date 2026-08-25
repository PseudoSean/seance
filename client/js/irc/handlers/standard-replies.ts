/**
 * Standard replies (`standard-replies` cap): `FAIL|WARN|NOTE <command> <code> [context...] :<description>`.
 */

import {MessageType} from "../../../../shared/types/msg";
import {chatHistoryFailed} from "../history";
import type {Handler} from "../types";

function reply(kind: "FAIL" | "WARN" | "NOTE"): Handler {
	return (client, msg) => {
		const [command = "*", code = "", ...rest] = msg.params;

		if (kind === "FAIL" && command.toUpperCase() === "CHATHISTORY") {
			chatHistoryFailed(client, msg); // answers the pending `more`; still shown below
		}

		const description = rest.length > 0 ? rest[rest.length - 1] : "";
		const context = rest.slice(0, -1);
		const text = `${command === "*" ? "" : `${command}: `}${description}${
			context.length > 0 ? ` (${context.join(" ")})` : ""
		} [${kind} ${code}]`;

		client.pushMessage(
			client.lobby,
			{
				type: kind === "NOTE" ? undefined : MessageType.ERROR,
				time: client.timeOf(msg),
				text,
				showInActive: true,
			},
			true
		);
	};
}

export default {FAIL: reply("FAIL"), WARN: reply("WARN"), NOTE: reply("NOTE")};
