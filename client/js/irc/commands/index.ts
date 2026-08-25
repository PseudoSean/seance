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
import type {Command} from "../types";
import join from "./join";
import me from "./me";
import msg from "./msg";
import nick from "./nick";
import part from "./part";
import quit from "./quit";
import raw from "./raw";
import topic from "./topic";

const modules: Command[] = [join, me, msg, nick, part, quit, raw, topic];

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

/** Handle everything the user typed into `chan` (may span several lines). */
export function dispatchInput(client: IrcClient, chan: Channel, text: string): void {
	for (const line of text.split("\n")) {
		inputLine(client, chan, line.replace(/\r$/, ""));
	}
}

function inputLine(client: IrcClient, chan: Channel, line: string): void {
	if (line.length === 0) {
		return;
	}

	let cmd: string;
	let rest: string;

	if (line.charAt(0) !== "/" || line.charAt(1) === "/") {
		if (chan.type === ChanType.LOBBY) {
			client.pushMessage(chan, {
				type: MessageType.ERROR,
				text: "Messages can not be sent to lobbies.",
			});
			return;
		}

		cmd = "say";
		rest = line.replace(/^\//, "");
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

		command.input({client, chan, cmd, args, rest});
		return;
	}

	if (!client.isConnected) {
		client.pushMessage(chan, {type: MessageType.ERROR, text: NOT_CONNECTED});
		return;
	}

	client.send(line.slice(1));
}
