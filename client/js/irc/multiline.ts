/**
 * `draft/multiline` (https://ircv3.net/specs/extensions/multiline).
 *
 * A multi-line message travels as a `BATCH … draft/multiline <target>` whose
 * lines are ordinary `PRIVMSG`/`NOTICE`s: they are joined with `\n`, except
 * where a line carries {@link CONCAT_TAG}, which glues it to the previous one
 * with no separator (that is how a paragraph longer than the line budget is
 * split). One batch is one message: one msgid, one timeline entry.
 *
 * This module is store- and DOM-free (it runs under mocha).
 */

import type {IrcClient} from "./client";
import {BatchHandler, OpenBatch, openBatchesOf} from "./handlers/batch";
import type {IrcMessage, IrcSource} from "./message";

/** The capability name, whose CAP 302 value carries the limits. */
export const MULTILINE_CAP = "draft/multiline";
/** Tag on a line that continues the previous one without a line feed. */
export const CONCAT_TAG = "draft/multiline-concat";

/** What one batch may carry, from the cap's 302 value. */
export type MultilineLimits = {
	/** Maximum total byte length of the joined message. */
	maxBytes: number;
	/** Maximum number of `PRIVMSG`/`NOTICE` lines in one batch. */
	maxLines: number;
};

/** A positive integer token value, or undefined for anything else. */
function positiveInt(value: string | undefined): number | undefined {
	if (value === undefined || !/^\d+$/.test(value)) {
		return undefined;
	}

	const n = Number(value);
	return n > 0 ? n : undefined;
}

/**
 * `"max-bytes=16384,max-lines=100"` → the limits. The spec requires the
 * value, so anything without both usable numbers means the server cannot
 * tell us what it accepts and the cap is treated as absent (unknown tokens
 * are ignored, as future ones must be).
 */
export function parseMultilineValue(value: string | undefined): MultilineLimits | undefined {
	if (!value) {
		return undefined;
	}

	const tokens = new Map<string, string>();

	for (const token of value.split(",")) {
		const eq = token.indexOf("=");

		if (eq !== -1) {
			tokens.set(token.slice(0, eq), token.slice(eq + 1));
		}
	}

	const maxBytes = positiveInt(tokens.get("max-bytes"));
	const maxLines = positiveInt(tokens.get("max-lines"));

	if (maxBytes === undefined || maxLines === undefined) {
		return undefined;
	}

	return {maxBytes, maxLines};
}

/** `nick!user@host`, as much of it as the line carried. */
function sourceString(source: IrcSource | undefined): string {
	if (!source) {
		return "";
	}

	return `${source.name}${source.user ? `!${source.user}` : ""}${
		source.host ? `@${source.host}` : ""
	}`;
}

const ACTION_PREFIX = "\x01ACTION ";

/** `\x01ACTION x\x01` framing, stripped from one line of an action batch. */
function unwrapAction(text: string): string {
	let body = text;

	if (body.startsWith(ACTION_PREFIX)) {
		body = body.slice(ACTION_PREFIX.length);
	} else if (body === "\x01ACTION") {
		body = "";
	}

	return body.endsWith("\x01") ? body.slice(0, -1) : body;
}

/** What one multiline batch says, as a single `PRIVMSG`/`NOTICE` would say it. */
export interface JoinedMultiline {
	command: "PRIVMSG" | "NOTICE";
	target: string;
	text: string;
	/** `nick!user@host` of the first line. */
	source: string;
}

/**
 * Join a multiline batch's buffered lines, or undefined when the batch is
 * malformed and its lines have to be shown one by one: the spec allows only
 * `PRIVMSG` lines or only `NOTICE` lines, all to the batch's target.
 *
 * An action is framed per line on the wire (`\x01ACTION …\x01`); joining
 * the raw parameters would leave `\x01`s in the middle of the text, so the
 * framing is stripped from every line and put back around the joined text.
 * That also accepts a sender that framed only the first and last line.
 */
export function joinMultiline(lines: IrcMessage[]): JoinedMultiline | undefined {
	const first = lines[0];

	if (!first || (first.command !== "PRIVMSG" && first.command !== "NOTICE")) {
		return undefined;
	}

	const command = first.command;
	const target = first.params[0] ?? "";
	const action = (first.params[1] ?? "").startsWith(ACTION_PREFIX);
	let text = "";

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];

		if (line.command !== command || (line.params[0] ?? "") !== target) {
			return undefined;
		}

		const body = line.params[1] ?? "";

		if (i > 0 && !line.tags.has(CONCAT_TAG)) {
			text += "\n";
		}

		text += action ? unwrapAction(body) : body;
	}

	return {
		command,
		target,
		text: action ? `${ACTION_PREFIX}${text}\x01` : text,
		source: sourceString(first.source),
	};
}

/** Hand `lines` on: into the enclosing batch while it is open, else live. */
function passOn(client: IrcClient, batch: OpenBatch, lines: IrcMessage[]): void {
	if (batch.parent && openBatchesOf(client).get(batch.parent.ref) === batch.parent) {
		// Keep the batch's position in the parent (a chathistory page, a
		// labeled response, the bouncer's replay); it is unwrapped there.
		batch.parent.messages.push(...lines);
		return;
	}

	for (const line of lines) {
		// The batch is closed, so the line is not intercepted again.
		client.handleMessage(line);
	}
}

/**
 * A closed `draft/multiline` batch: one synthetic `PRIVMSG`/`NOTICE` with the
 * joined text, carrying the opener's tags (msgid, time, `+draft/reply`,
 * `+seance/edit`, …) and the first line's source, run through the ordinary
 * handlers so CTCP, highlights, replies and edits all see the whole message.
 * A malformed batch falls back to its lines, one by one, as an unhandled
 * batch type would. The handler is registered whether or not the cap was
 * negotiated: what the server sends, the server sends.
 */
export const multilineBatch: BatchHandler = (client, batch) => {
	const joined = joinMultiline(batch.messages);
	const target = batch.params[0] ?? "";

	// The lines must address the batch's target. An opener without one is
	// malformed too, but the lines still agree on a target: take theirs.
	if (!joined || (target !== "" && client.casefold(target) !== client.casefold(joined.target))) {
		passOn(client, batch, batch.messages);
		return;
	}

	const tags = new Map(batch.tags);
	// `batch` names the parent, which the synthetic message is not part of.
	tags.delete("batch");

	const prefix = joined.source ? `:${joined.source} ` : "";

	passOn(client, batch, [
		{
			tags,
			source: batch.messages[0].source,
			command: joined.command,
			params: [joined.target, joined.text],
			// Not a line that could have been received (the text has newlines
			// in it); it exists for diagnostics.
			raw: `${prefix}${joined.command} ${joined.target} :${joined.text}`,
		},
	]);
};
