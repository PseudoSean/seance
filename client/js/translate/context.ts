// The PromptContext for one message (spec § prompt.ts, the context levers):
// the last CONTEXT_LINES chat lines before it with the translations we
// already have, the reply target (the parent by msgid, else the last line
// of the nick the text addresses), the topic, the names the model must not
// translate (capped: the nicks in the context and the ones the text
// mentions, never the whole NAMES list), the channel's term memory, and the
// detector's source hint. Vue-free: it reads plain channel-shaped objects.

import {ContextLine, PromptContext} from "./engine";
import {Formality} from "./channelStore";

export const CONTEXT_LINES = 10;
export const NAMES_CAP = 20;

const CHAT_TYPES = new Set(["message", "action", "notice"]);

export interface ContextMessage {
	id: number;
	type?: string;
	text?: string;
	from?: {nick?: string};
	msgid?: string;
	replyTo?: string;
	supersededBy?: number;
}

export interface ContextChannel {
	messages: ContextMessage[];
	users: {nick?: string}[];
	topic: string;
}

export interface ContextOptions {
	translated: (id: number) => string | undefined;
	terms: [string, string][];
	formality: Formality;
	variant: string;
	sourceHint: string | null;
}

function nickMatching(word: string, nicks: string[]): string | null {
	const lower = word.toLowerCase();

	return nicks.find((nick) => nick.toLowerCase() === lower) ?? null;
}

/** `nick:` or `nick,` at the start of the line: IRC's way of addressing someone. */
export function addressedNick(text: string, nicks: string[]): string | null {
	const match = /^\s*([^\s:,]+)[:,]\s/.exec(text);

	return match ? nickMatching(match[1], nicks) : null;
}

export function mentionedNicks(text: string, nicks: string[]): string[] {
	const found: string[] = [];

	for (const word of text.split(/[^\p{L}\p{N}_\-[\]{}\\^`|]+/u)) {
		const nick = word ? nickMatching(word, nicks) : null;

		if (nick && !found.includes(nick)) {
			found.push(nick);
		}
	}

	return found;
}

function isChat(message: ContextMessage): boolean {
	return (
		message.type !== undefined &&
		CHAT_TYPES.has(message.type) &&
		message.supersededBy === undefined &&
		typeof message.text === "string" &&
		message.from !== undefined &&
		typeof message.from.nick === "string"
	);
}

function lineOf(message: ContextMessage, translated?: string): ContextLine {
	const line: ContextLine = {nick: message.from?.nick ?? "", text: message.text ?? ""};

	if (translated) {
		line.translated = translated;
	}

	return line;
}

export function buildContext(
	channel: ContextChannel,
	message: ContextMessage,
	opts: ContextOptions
): PromptContext {
	const index = channel.messages.findIndex((m) => m.id === message.id);
	const before = index >= 0 ? channel.messages.slice(0, index) : channel.messages;
	const recentMessages = before.filter(isChat).slice(-CONTEXT_LINES);
	const recent = recentMessages.map((m) => lineOf(m, opts.translated(m.id)));
	const nicks = channel.users
		.map((u) => u.nick)
		.filter((n): n is string => typeof n === "string");
	const text = message.text ?? "";

	let replyTo: ContextLine | undefined;

	if (message.replyTo) {
		const parent = before.find((m) => m.msgid === message.replyTo && isChat(m));

		if (parent) {
			replyTo = lineOf(parent, opts.translated(parent.id));
		}
	}

	if (!replyTo) {
		const addressed = addressedNick(text, nicks);

		if (addressed) {
			const parent = [...before]
				.reverse()
				.find((m) => isChat(m) && m.from?.nick === addressed);

			if (parent) {
				replyTo = lineOf(parent, opts.translated(parent.id));
			}
		}
	}

	const names: string[] = [];

	for (const nick of [
		...recentMessages.map((m) => m.from?.nick ?? ""),
		...mentionedNicks(text, nicks),
	]) {
		if (nick && !names.includes(nick)) {
			names.push(nick);
		}
	}

	const context: PromptContext = {
		recent,
		names: names.slice(0, NAMES_CAP),
		terms: opts.terms,
		voice: [],
		formality: opts.formality,
	};

	if (replyTo) {
		context.replyTo = replyTo;
	}

	if (channel.topic) {
		context.topic = channel.topic;
	}

	if (opts.sourceHint) {
		context.sourceHint = opts.sourceHint;
	}

	if (opts.variant) {
		context.variant = opts.variant;
	}

	return context;
}
