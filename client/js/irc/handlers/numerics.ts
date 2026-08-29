/**
 * Registration and informational numerics (001-005, MOTD, LUSERS, 396) and
 * the generic 4xx/5xx error path (nick-in-use retry during registration,
 * ERROR messages routed to the channel they concern or the lobby with
 * `showInActive`, as attic/server/plugins/irc-events/error.ts did).
 */

import {MessageType, SharedMsg} from "../../../../shared/types/msg";
import type {IrcClient} from "../client";
import {errorSpec} from "../errors";
import {formatLine} from "../message";
import type {Handler} from "../types";

/** Params without our own leading nick, joined for display. */
function textOf(params: string[]): string {
	return params.slice(1).join(" ");
}

const welcome: Handler = (client, msg) => {
	const nick = msg.params[0];

	if (nick && nick !== "*") {
		client.setNick(nick);
	}

	client.pushMessage(client.lobby, {time: client.timeOf(msg), text: textOf(msg.params)}, true);
};

const infoLine: Handler = (client, msg) => {
	client.pushMessage(client.lobby, {time: client.timeOf(msg), text: textOf(msg.params)});
};

const ignore: Handler = () => undefined;

const isupport: Handler = (client, msg) => {
	client.isupport.apply(msg.params);
	client.dispatch("network:options", {network: client.uuid, serverOptions: client.serverOptions});

	const name = client.isupport.network;

	if (name) {
		client.setNetworkName(name);
	}
};

const motdStart: Handler = (client, msg) => {
	client.motdBuffer = [msg.params[msg.params.length - 1] ?? ""];
};

const motdLine: Handler = (client, msg) => {
	const line = msg.params[msg.params.length - 1] ?? "";

	if (client.motdBuffer) {
		client.motdBuffer.push(line);
	} else {
		client.pushMessage(client.lobby, {text: line});
	}
};

const motdEnd: Handler = (client, msg) => {
	if (client.motdBuffer && client.motdBuffer.length > 0) {
		// MONOSPACE_BLOCK renders verbatim (no Markdown) — MOTD banners are
		// ASCII art. See client/components/MessageTypes/monospace_block.vue.
		client.pushMessage(client.lobby, {
			type: MessageType.MONOSPACE_BLOCK,
			command: "motd",
			text: client.motdBuffer.join("\n"),
		});
	} else if (msg.command === "422") {
		client.pushMessage(client.lobby, {text: textOf(msg.params)});
	}

	client.motdBuffer = null;
	client.onRegistered();
};

// RPL_HOSTHIDDEN: <me> <host> :is now your hidden host
const hostHidden: Handler = (client, msg) => {
	const host = msg.params[1];

	if (host) {
		client.host = host;
	}

	client.pushMessage(client.lobby, {time: client.timeOf(msg), text: textOf(msg.params)});
};

function pushError(client: IrcClient, msg: SharedMsg | Partial<SharedMsg>, channelName?: string) {
	const chan = channelName ? client.findChannel(channelName) : undefined;
	client.pushMessage(chan ?? client.lobby, {...msg, showInActive: !chan}, true);
}

/** Pick a fallback nick that still fits NICKLEN. */
function fallbackNick(client: IrcClient, wanted: string): string {
	const maxLen = client.isupport.nicklen ?? 30;
	const candidate = `${wanted}_`;

	if (candidate.length <= maxLen) {
		return candidate;
	}

	return `${wanted.slice(0, Math.max(1, maxLen - 1))}_`;
}

// ERR_NICKNAMEINUSE / ERR_ERRONEUSNICKNAME: <me> <nick> :<reason>
const badNick: Handler = (client, msg) => {
	const [, nick = client.nick, reason = ""] = msg.params;
	const inUse = msg.command === "433";
	const text = `${nick}: ${
		reason || (inUse ? "Nickname is already in use." : "Nickname is invalid.")
	}`;

	client.pushMessage(
		client.lobby,
		{type: MessageType.ERROR, time: client.timeOf(msg), text, showInActive: true},
		true
	);

	if (!client.isConnected) {
		// Still registering: the server will not proceed until we pick another.
		const next = inUse
			? fallbackNick(client, nick)
			: `seance${Math.floor(1000 + Math.random() * 9000)}`;
		client.send(formatLine({command: "NICK", params: [next]}));
		client.setNick(next);
		return;
	}

	client.dispatch("nick", {network: client.uuid, nick: client.nick});
};

/** Any other 4xx/5xx: an ERROR message with the code error.vue understands. */
export const numericError: Handler = (client, msg) => {
	const spec = errorSpec(msg.command);

	if (!spec) {
		return;
	}

	const params = msg.params.slice(1); // drop our nick
	const reason = params.length > 0 ? params[params.length - 1] : "";
	const error: Partial<SharedMsg> = {
		type: MessageType.ERROR,
		time: client.timeOf(msg),
		error: spec.code,
		reason,
	};

	if (spec.channel !== undefined && params[spec.channel]) {
		error.channel = params[spec.channel];
	}

	if (spec.nick !== undefined && params[spec.nick]) {
		error.nick = params[spec.nick];
	}

	if (spec.command !== undefined && params[spec.command]) {
		error.command = params[spec.command];
	}

	pushError(client, error, error.channel);
};

export default {
	"001": welcome,
	"002": infoLine,
	"003": infoLine,
	"004": ignore,
	"005": isupport,
	"250": infoLine,
	"251": infoLine,
	"252": infoLine,
	"253": infoLine,
	"254": infoLine,
	"255": infoLine,
	"265": infoLine,
	"266": infoLine,
	"375": motdStart,
	"372": motdLine,
	"376": motdEnd,
	"422": motdEnd,
	"396": hostHidden,
	"432": badNick,
	"433": badNick,
};
