/**
 * Inbound handler registry: command / numeric → {@link Handler}.
 *
 * To handle a new command, add a file exporting `{COMMAND: handler, ...}`
 * and list it in `modules` below. Numerics not registered here fall through
 * to {@link unhandled}, which shows them raw in the lobby (or in the channel
 * their first parameter names), like the old server's unhandled.ts. 4xx/5xx
 * numerics without a specific handler become ERROR messages instead.
 */

import {MessageType} from "../../../../shared/types/msg";
import type {Handler} from "../types";
import account from "./account";
import away from "./away";
import batch from "./batch";
import cap from "./cap";
import chghost from "./chghost";
import error from "./error";
import invite from "./invite";
import join from "./join";
import kick from "./kick";
import lists from "./lists";
import mode from "./mode";
import names from "./names";
import nick from "./nick";
import numerics, {numericError} from "./numerics";
import part from "./part";
import privmsg from "./privmsg";
import quit from "./quit";
import standardReplies from "./standard-replies";
import topic from "./topic";

const modules: Record<string, Handler>[] = [
	account,
	away,
	batch,
	cap,
	chghost,
	error,
	invite,
	join,
	kick,
	lists,
	mode,
	names,
	nick,
	numerics,
	part,
	privmsg,
	quit,
	standardReplies,
	topic,
];

export const handlers = new Map<string, Handler>();

for (const mod of modules) {
	for (const [command, handler] of Object.entries(mod)) {
		handlers.set(command.toUpperCase(), handler);
	}
}

/** Fallback for anything without a handler. */
export const unhandled: Handler = (client, msg) => {
	if (/^[45]\d\d$/.test(msg.command)) {
		numericError(client, msg);
		return;
	}

	const params = [...msg.params];

	// Do not display our own name (numerics start with it).
	if (params.length > 0 && client.isSelf(params[0])) {
		params.shift();
	}

	const chan = (params.length > 0 && client.findChannel(params[0])) || client.lobby;

	client.pushMessage(
		chan,
		{
			type: MessageType.UNHANDLED,
			time: client.timeOf(msg),
			command: msg.command,
			params,
			text: `${msg.command} ${params.join(" ")}`,
		},
		true
	);
};
