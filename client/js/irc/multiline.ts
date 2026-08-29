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
import {formatLine, IrcMessage, IrcSource, MAX_LINE_BYTES, utf8ByteLength} from "./message";
import {ClientTags, trailingLine} from "./wire";

/** The capability name, whose CAP 302 value carries the limits. */
export const MULTILINE_CAP = "draft/multiline";
/** Tag on a line that continues the previous one without a line feed. */
export const CONCAT_TAG = "draft/multiline-concat";

/**
 * Bytes the tags of a line inside a batch take: `batch` plus, at worst,
 * {@link CONCAT_TAG}. The reference is budgeted at ten characters, well past
 * what {@link IrcClient.nextBatchRef} needs. Inside a batch that is *all* the
 * tags there may be — the draft puts the message's own tags on the opener.
 */
export const CONCAT_LINE_TAG_BYTES = `@batch=0123456789;${CONCAT_TAG} `.length;

/** What one batch may carry, from the cap's 302 value. */
export type MultilineLimits = {
	/** Maximum total byte length of the joined message. */
	maxBytes: number;
	/**
	 * Maximum number of `PRIVMSG`/`NOTICE` lines in one batch, or `Infinity`
	 * when the server named none: the draft makes `max-lines` RECOMMENDED,
	 * not REQUIRED, so only `max-bytes` bounds such a batch.
	 */
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
 * `"max-bytes=16384,max-lines=100"` → the limits. `max-bytes` is REQUIRED by
 * the draft: without a usable one the server cannot tell us what it accepts
 * and the cap is treated as absent. `max-lines` is only RECOMMENDED, so a
 * missing (or unusable) one means "no line limit". Unknown tokens are
 * ignored, as future ones must be.
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

	if (maxBytes === undefined) {
		return undefined;
	}

	return {maxBytes, maxLines: positiveInt(tokens.get("max-lines")) ?? Infinity};
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
 *
 * `casefold` compares the lines' targets the way the network does (the
 * batch handler passes the client's); the default compares them literally.
 */
export function joinMultiline(
	lines: IrcMessage[],
	casefold: (s: string) => string = (s) => s
): JoinedMultiline | undefined {
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

		if (line.command !== command || casefold(line.params[0] ?? "") !== casefold(target)) {
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
	const joined = joinMultiline(batch.messages, (s) => client.casefold(s));
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

	// The draft puts the message's own tags on the opener, but a server that
	// tags the first line instead (the shape of its non-multiline fallback)
	// must not leave the message without a msgid, a time or an account.
	for (const key of ["msgid", "time", "account"]) {
		const value = batch.messages[0].tags.get(key);

		if (value !== undefined && !tags.has(key)) {
			tags.set(key, value);
		}
	}

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

/** One `PRIVMSG`/`NOTICE` inside a batch: `concat` continues the line before it. */
export type MultilineLine = {text: string; concat: boolean};

/** A planned multi-line message: one inner array per batch, one batch per message. */
export type MultilinePlan = MultilineLine[][];

/**
 * Split one paragraph into chunks of at most `budget` bytes, leaving the
 * space a break lands on at the **end** of the chunk. That is the draft's
 * recommended method ("leave the space character at the end of the line"),
 * and the only one under which concatenating the chunks reproduces the
 * paragraph byte for byte — `splitMessage` drops the whitespace run around
 * the break instead, which is right for separate lines and wrong here.
 */
function splitConcat(text: string, budget: number): string[] {
	const chunks: string[] = [];
	let start = 0;

	while (start < text.length) {
		let pos = start;
		let bytes = 0;
		// Index just past the last space that still fits.
		let afterSpace = -1;

		while (pos < text.length) {
			const cp = text.codePointAt(pos) as number;
			const units = cp > 0xffff ? 2 : 1;
			const size = utf8ByteLength(text.slice(pos, pos + units));

			if (bytes + size > budget) {
				break;
			}

			bytes += size;
			pos += units;

			if (cp === 0x20 || cp === 0x09) {
				afterSpace = pos;
			}
		}

		if (pos >= text.length) {
			chunks.push(text.slice(start));
			break;
		}

		if (pos === start) {
			// One character does not fit the budget; emit it rather than spin.
			pos = start + ((text.codePointAt(start) as number) > 0xffff ? 2 : 1);
		}

		const end = afterSpace > start ? afterSpace : pos;
		chunks.push(text.slice(start, end));
		start = end;
	}

	return chunks;
}

/**
 * Plan `text` as `draft/multiline` batches.
 *
 * Every line feed starts a new line; a paragraph longer than the line budget
 * (`MAX_LINE_BYTES - prefixBytes`) is split into {@link CONCAT_TAG} chunks.
 * The lines are then packed into batches under the server's `max-lines` and
 * `max-bytes` — which count the message bodies (`bodyOverhead` is what each
 * body carries beyond its text, i.e. the `\x01ACTION …\x01` framing) plus one
 * byte per joining line feed. Each batch is one message, so a text too big
 * for one batch arrives as consecutive messages.
 *
 * Trailing blank lines are dropped: they are invisible, and the draft forbids
 * a message that is nothing but blank lines (which then plans as no batch at
 * all). Blank lines inside the message are kept — those are content.
 * `\r` and NUL cannot go on the wire and become spaces.
 *
 * Throws `RangeError` when the prefix leaves no room for text at all.
 */
export function planMultiline(
	text: string,
	prefixBytes: number,
	limits: MultilineLimits,
	bodyOverhead = 0
): MultilinePlan {
	const budget = MAX_LINE_BYTES - prefixBytes;

	if (budget <= 0) {
		throw new RangeError(
			`No room for message text: prefix is ${prefixBytes} of ${MAX_LINE_BYTES} bytes`
		);
	}

	const paragraphs = text
		.replace(/\r\n/g, "\n")
		.replace(/[\r\0]/g, " ")
		.split("\n");

	while (paragraphs.length > 0 && paragraphs[paragraphs.length - 1] === "") {
		paragraphs.pop();
	}

	const lines: MultilineLine[] = [];

	for (const paragraph of paragraphs) {
		if (utf8ByteLength(paragraph) <= budget) {
			lines.push({text: paragraph, concat: false});
			continue;
		}

		for (const [i, chunk] of splitConcat(paragraph, budget).entries()) {
			lines.push({text: chunk, concat: i > 0});
		}
	}

	const plan: MultilinePlan = [];
	let batch: MultilineLine[] = [];
	let bytes = 0;

	for (const line of lines) {
		const size = utf8ByteLength(line.text) + bodyOverhead;
		const feed = batch.length > 0 && !line.concat ? 1 : 0;

		if (
			batch.length > 0 &&
			(batch.length >= limits.maxLines || bytes + feed + size > limits.maxBytes)
		) {
			plan.push(batch);
			batch = [];
			bytes = 0;
		}

		if (batch.length === 0) {
			// The first line of a batch starts a message: it continues nothing.
			// (A single line over `max-bytes` goes out anyway — the server's
			// FAIL is a better answer than dropping the message here.)
			batch.push({text: line.text, concat: false});
			bytes = size;
		} else {
			batch.push(line);
			bytes += feed + size;
		}
	}

	if (batch.length > 0) {
		plan.push(batch);
	}

	return plan;
}

/** The text one planned batch stands for, joined as a receiver joins it. */
function joinPlan(batch: MultilineLine[]): string {
	return batch.map((line, i) => (i > 0 && !line.concat ? `\n${line.text}` : line.text)).join("");
}

/**
 * Put `plan` on the wire: one `BATCH +<ref> draft/multiline <target>` per
 * inner array, its lines tagged `batch` (and {@link CONCAT_TAG}), then
 * `BATCH -<ref>`. `openerTags` are the message's client-only tags (reply,
 * edit): the draft requires them on the opener and forbids any tag but
 * `batch`/`concat` on the lines. An action is framed per line, which is what
 * nefarious2 relays verbatim and what a client without the cap sees as one
 * action per line.
 *
 * Batches go out one whole batch at a time, so a plan of several never
 * interleaves. Without `echo-message` each batch is fed back through the
 * handlers as one joined message, as the single-line path does.
 */
export function sendMultiline(
	client: IrcClient,
	target: string,
	command: "PRIVMSG" | "NOTICE",
	plan: MultilinePlan,
	openerTags: ClientTags,
	action: boolean
): void {
	const echo = client.caps.hasCapability("echo-message");

	for (const batch of plan) {
		const ref = client.nextBatchRef();
		const opener = formatLine({
			tags: openerTags,
			command: "BATCH",
			params: [`+${ref}`, MULTILINE_CAP, target],
		});

		if (!client.send(opener)) {
			return;
		}

		for (const line of batch) {
			const tags: ClientTags = {batch: ref};

			if (line.concat) {
				tags[CONCAT_TAG] = "";
			}

			const body = action ? `${ACTION_PREFIX}${line.text}\x01` : line.text;

			if (!client.send(trailingLine(command, [target, body], tags))) {
				return;
			}
		}

		if (!client.send(formatLine({command: "BATCH", params: [`-${ref}`]}))) {
			return;
		}

		if (!echo) {
			const text = joinPlan(batch);
			const body = action ? `${ACTION_PREFIX}${text}\x01` : text;

			client.handleMessage({
				tags: new Map(Object.entries(openerTags)),
				source: {name: client.nick, user: client.ident, host: client.host || "localhost"},
				command,
				params: [target, body],
				// Not a line that could have been received (the text has line
				// feeds in it); it exists for diagnostics.
				raw: `${command} ${target} :${body}`,
			});
		}
	}
}
