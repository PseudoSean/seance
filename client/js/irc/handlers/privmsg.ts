/**
 * PRIVMSG / NOTICE, including CTCP (ACTION, requests and replies).
 * Ported from attic/server/plugins/irc-events/message.ts and ctcp.ts.
 */

import {ChanType} from "../../../../shared/types/chan";
import {MessageType, SharedMsg} from "../../../../shared/types/msg";
import type {IrcClient} from "../client";
import type {Channel} from "../channel";
import type {IrcMessage} from "../message";
import {trailingLine} from "../wire";
import type {Handler} from "../types";
import {ignoreListFor} from "../../ignore";

const nickRegExp = /(?:\x03[0-9]{1,2}(?:,[0-9]{1,2})?)?([\w[\]\\`^{|}-]+)/g;

const ctcpResponses: Record<string, (arg: string) => string> = {
	CLIENTINFO: () => "CLIENTINFO PING VERSION",
	PING: (arg) => arg,
	VERSION: () => "Seance",
};

interface Ctcp {
	command: string;
	arg: string;
	body: string;
}

/** `\x01CMD arg\x01` → parts, or undefined if `text` is not a CTCP. */
function parseCtcp(text: string): Ctcp | undefined {
	if (!text.startsWith("\x01")) {
		return undefined;
	}

	const body = text.slice(1, text.endsWith("\x01") && text.length > 1 ? -1 : undefined);
	const space = body.indexOf(" ");
	const command = (space === -1 ? body : body.slice(0, space)).toUpperCase();
	const arg = space === -1 ? "" : body.slice(space + 1);
	return {command, arg, body};
}

/** Split a STATUSMSG target (`@#chan`) into the channel and its status prefix. */
function splitStatusTarget(client: IrcClient, target: string): {target: string; group?: string} {
	if (
		target.length > 1 &&
		!client.isChannelName(target) &&
		client.isupport.statusmsg.includes(target[0]) &&
		client.isChannelName(target.slice(1))
	) {
		return {target: target.slice(1), group: target[0]};
	}

	return {target};
}

function handleMessage(client: IrcClient, msg: IrcMessage, baseType: MessageType): void {
	const source = msg.source;
	let nick = source?.name ?? "";
	const fromServer = !source || source.user === undefined;
	const self = nick.length > 0 && client.isSelf(nick);
	const {target: rawTarget, group} = splitStatusTarget(client, msg.params[0] ?? "");
	let target = rawTarget;
	let text = msg.params[1] ?? "";
	let type = baseType;
	const time = client.timeOf(msg);
	const ctcp = parseCtcp(text);

	// --- ignore list (client/js/ignore.ts): drop anything from a matching user
	if (
		!fromServer &&
		!self &&
		ignoreListFor(client.uuid).matches(nick, source.user, source.host)
	) {
		return;
	}
	// --- end ignore list

	if (ctcp) {
		if (ctcp.command === "ACTION" && baseType === MessageType.MESSAGE) {
			type = MessageType.ACTION;
			text = ctcp.arg;
		} else if (baseType === MessageType.NOTICE) {
			handleCtcpResponse(client, nick, ctcp, time);
			return;
		} else {
			handleCtcpRequest(client, msg, nick, self, ctcp, time);
			return;
		}
	}

	let chan: Channel | undefined;
	let showInActive = false;

	if (fromServer) {
		nick = nick || client.options.host;
		chan = client.findChannel(target);

		if (!chan || chan.type !== ChanType.CHANNEL) {
			chan = client.lobby;
		}
	} else {
		// A message addressed to us belongs in the sender's query window.
		if (client.isSelf(target)) {
			target = nick;
		}

		chan = client.findChannel(target);

		if (!chan) {
			if (type === MessageType.NOTICE) {
				showInActive = true;
				chan = client.lobby;
			} else {
				chan = client.announceChannel(target, ChanType.QUERY);
			}
		}
	}

	let highlight = false;

	if (chan.type === ChanType.QUERY) {
		highlight = !self;
	} else if (chan.type === ChanType.CHANNEL) {
		const user = chan.findUser(nick);

		if (user) {
			user.lastMessage = time.getTime();
		}
	}

	if (!highlight && !self) {
		highlight = client.isHighlight(text);
	}

	const users: string[] = [];
	let match: RegExpExecArray | null;
	nickRegExp.lastIndex = 0;

	while ((match = nickRegExp.exec(text))) {
		if (chan.findUser(match[1])) {
			users.push(match[1]);
		}
	}

	const message: Partial<SharedMsg> = {
		type,
		time,
		text,
		self,
		from: chan.userRef(nick),
		highlight,
		users,
	};
	const msgid = msg.tags.get("msgid");

	if (msgid) {
		message.msgid = msgid;
	}

	if (showInActive) {
		message.showInActive = true;
	}

	if (group) {
		message.statusmsgGroup = group;
	}

	client.pushMessage(chan, message, !self);
}

function handleCtcpResponse(client: IrcClient, nick: string, ctcp: Ctcp, time: Date): void {
	const chan = client.findChannel(nick) ?? client.lobby;

	client.pushMessage(
		chan,
		{
			type: MessageType.CTCP,
			time,
			from: chan.userRef(nick),
			ctcpMessage: ctcp.body,
			showInActive: chan === client.lobby,
		},
		true
	);
}

function handleCtcpRequest(
	client: IrcClient,
	msg: IrcMessage,
	nick: string,
	self: boolean,
	ctcp: Ctcp,
	time: Date
): void {
	// Our own request echoed back (echo-message) is not for us.
	if (self && !client.isSelf(msg.params[0] ?? "")) {
		return;
	}

	const respond = ctcpResponses[ctcp.command];

	if (respond && nick) {
		const reply = `\x01${ctcp.command}${respond(ctcp.arg) ? ` ${respond(ctcp.arg)}` : ""}\x01`;
		client.send(trailingLine("NOTICE", [nick, reply]));
	}

	client.pushMessage(
		client.lobby,
		{
			type: MessageType.CTCP_REQUEST,
			time,
			from: {nick, mode: ""},
			hostmask: `${msg.source?.user ?? ""}@${msg.source?.host ?? ""}`,
			ctcpMessage: ctcp.body,
			showInActive: true,
		},
		true
	);
}

const privmsg: Handler = (client, msg) => handleMessage(client, msg, MessageType.MESSAGE);
const notice: Handler = (client, msg) => handleMessage(client, msg, MessageType.NOTICE);

const wallops: Handler = (client, msg) => {
	client.pushMessage(
		client.lobby,
		{
			type: MessageType.WALLOPS,
			time: client.timeOf(msg),
			from: {nick: msg.source?.name ?? client.options.host, mode: ""},
			text: msg.params[0] ?? "",
			showInActive: true,
		},
		true
	);
};

// TAGMSG carries only tags (typing notifications etc.): nothing to show yet.
const tagmsg: Handler = () => undefined;

export default {PRIVMSG: privmsg, NOTICE: notice, WALLOPS: wallops, TAGMSG: tagmsg};
