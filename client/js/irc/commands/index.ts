/**
 * Outbound command registry and the `input` dispatcher.
 *
 * Mirrors attic/server/client.ts `inputLine` + attic/server/plugins/inputs/index.ts:
 * every line of input is one message; text not starting with `/` (or
 * starting with `//`) is said to the current channel; `/cmd args` runs the
 * registered {@link Command}; unknown commands go to the server raw.
 *
 * To add a command, create a file exporting a {@link Command} and list it in
 * `modules`. UI-only commands (`/collapse`, `/expand`, `/search`, and `/join`
 * for channels already in the list) are intercepted in `client/js/commands/`
 * before the bus ever sees them.
 */

import {ChanType} from "../../../../shared/types/chan";
import {MessageType} from "../../../../shared/types/msg";
import type {Channel} from "../channel";
import type {IrcClient} from "../client";
import type {Command, InputOptions} from "../types";
import away from "./away";
import ban from "./ban";
import connect from "./connect";
import ctcp from "./ctcp";
import disconnect from "./disconnect";
import ignore from "./ignore";
import ignorelist from "./ignorelist";
import invite from "./invite";
import join from "./join";
import kick from "./kick";
import kill from "./kill";
import list from "./list";
import me from "./me";
import mode from "./mode";
import msg from "./msg";
import mute from "./mute";
import nick from "./nick";
import notice from "./notice";
import part from "./part";
import quit from "./quit";
import raw from "./raw";
import react from "./react";
import redact from "./redact";
import rejoin from "./rejoin";
import topic from "./topic";
import whois from "./whois";

const modules: Command[] = [
	away,
	ban,
	connect,
	ctcp,
	disconnect,
	ignore,
	ignorelist,
	invite,
	join,
	kick,
	kill,
	list,
	me,
	mode,
	msg,
	mute,
	nick,
	notice,
	part,
	quit,
	raw,
	react,
	redact,
	rejoin,
	topic,
	whois,
];

export const commands = new Map<string, Command>();

for (const command of modules) {
	for (const name of command.commands) {
		commands.set(name, command);
	}
}

/** Handled in `client/js/commands/` before reaching the bus. */
const clientSideCommands = ["/collapse", "/expand", "/search"];

/** Sent raw; listed so autocompletion knows them. */
const passThroughCommands = ["/as", "/bs", "/cs", "/ho", "/hs", "/ms", "/ns", "/os", "/rs"];

/** `/name` list for the `commands` event (autocompletion). */
export function commandNames(): string[] {
	return Array.from(commands.keys())
		.map((name) => `/${name}`)
		.concat(clientSideCommands, passThroughCommands)
		.sort();
}

export const NOT_CONNECTED =
	"You are not connected to the IRC network, unable to send your command.";

/**
 * Handle everything the user typed into `chan` (may span several lines).
 *
 * `opts.reply` applies to every line. `opts.edit` replaces one message, so
 * the whole text is one logical message: it is always said (never parsed
 * as a command — it is the replacement body of a message, and the message
 * being edited is plain text by construction), line breaks become spaces,
 * and `sendMessage` may still chunk it, putting the edit tag on the first
 * chunk only and the reply tag on all of them.
 */
export function dispatchInput(
	client: IrcClient,
	chan: Channel,
	text: string,
	opts: InputOptions = {}
): void {
	if (opts.edit) {
		inputLine(client, chan, text.replace(/\r?\n/g, " ").trim(), opts, true);
		return;
	}

	for (const line of text.split("\n")) {
		inputLine(client, chan, line.replace(/\r$/, ""), opts);
	}
}

function inputLine(
	client: IrcClient,
	chan: Channel,
	line: string,
	opts: InputOptions,
	forceSay = false
): void {
	if (line.length === 0) {
		return;
	}

	let cmd: string;
	let rest: string;

	if (forceSay || line.charAt(0) !== "/" || line.charAt(1) === "/") {
		if (chan.type === ChanType.LOBBY) {
			client.pushMessage(chan, {
				type: MessageType.ERROR,
				text: "Messages can not be sent to lobbies.",
			});
			return;
		}

		cmd = "say";
		rest = forceSay ? line : line.replace(/^\//, "");
	} else {
		const body = line.slice(1);
		const space = body.indexOf(" ");
		cmd = (space === -1 ? body : body.slice(0, space)).toLowerCase();
		rest = space === -1 ? "" : body.slice(space + 1);
	}

	const args = rest.length > 0 ? rest.split(" ") : [];
	const command = commands.get(cmd);

	if (command) {
		if (!client.isConnected && !command.allowDisconnected) {
			client.pushMessage(chan, {type: MessageType.ERROR, text: NOT_CONNECTED});
			return;
		}

		command.input({client, chan, cmd, args, rest, opts});
		return;
	}

	if (!client.isConnected) {
		client.pushMessage(chan, {type: MessageType.ERROR, text: NOT_CONNECTED});
		return;
	}

	client.send(line.slice(1));
}
