/**
 * Standard replies (`standard-replies` cap): `FAIL|WARN|NOTE <command> <code> [context...] :<description>`.
 *
 * `FAIL REDACT <code> [<target> [<msgid>]] :text` gets a friendly message in
 * the channel the context names (or the active window) and aborts an edit
 * waiting on that msgid (bus-contract §1.4). Everything else is shown raw.
 */

import {MessageType} from "../../../../shared/types/msg";
import {chatHistoryFailed} from "../history";
import type {Handler} from "../types";
import type {IrcClient} from "../client";
import type {IrcMessage} from "../message";

/** nefarious2 `m_redact.c` codes → what to tell the user. */
const REDACT_ERRORS: Record<string, string> = {
	DISABLED: "Deleting messages is disabled on this server.",
	INVALID_TARGET: "Messages can only be deleted in channels.",
	REDACT_FORBIDDEN: "You are not allowed to delete that message.",
	UNKNOWN_MSGID: "The server no longer has that message.",
	REDACT_WINDOW_EXPIRED: "That message is too old to delete.",
};

function redactFailed(client: IrcClient, msg: IrcMessage): void {
	const [, code = "", ...rest] = msg.params;
	const description = rest.length > 0 ? rest[rest.length - 1] : "";
	const [target, msgid] = rest.slice(0, -1);
	const why = REDACT_ERRORS[code.toUpperCase()] ?? description ?? code;
	const edit = msgid ? client.rejectEdit(msgid) : undefined;
	const chan = edit ?? (target ? client.findChannel(target) : undefined) ?? client.lobby;

	client.pushMessage(
		chan,
		{
			type: MessageType.ERROR,
			time: client.timeOf(msg),
			text: `${edit ? "Edit not sent" : "Could not delete message"}: ${why}`,
			showInActive: chan === client.lobby,
		},
		true
	);
}

function reply(kind: "FAIL" | "WARN" | "NOTE"): Handler {
	return (client, msg) => {
		const [command = "*", code = "", ...rest] = msg.params;

		if (kind === "FAIL" && command.toUpperCase() === "CHATHISTORY") {
			chatHistoryFailed(client, msg); // answers the pending `more`; still shown below
		}

		if (kind === "FAIL" && command.toUpperCase() === "REDACT") {
			redactFailed(client, msg);
			return;
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
