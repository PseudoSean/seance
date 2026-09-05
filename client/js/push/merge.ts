/**
 * The notification's message list (`notification.data.messages`): how a
 * push joins it, how a multiline message is reassembled from one push per
 * line, and how the list renders as a body (docs/projects/
 * push-payload-multiline.md §5.1, §5.3). Pure data — no DOM, no store.
 */
import type {LineIndex} from "./line";

/** Messages retained in the notification's data. */
export const MERGE_KEEP = 4;
/** Total body characters before middle lines are dropped. */
export const BODY_BUDGET = 170;
/** Per-line middle-ellipsis split. */
export const LINE_HEAD = 48;
export const LINE_TAIL = 18;

export type MergedLine = {text: string; concat: boolean};

export type MergedMessage = {
	from: string;
	/** Raw text as pushed (joined for a batch); stripped only when rendered. */
	text: string;
	msgid?: string;
	/** Multiline: the batch reference (its `batch` tag, the base msgid) and its lines by 1-based index. */
	batch?: string;
	lines?: Record<string, MergedLine>;
	sent?: number;
	total?: number;
};

export type IncomingMessage = {
	from: string;
	text: string;
	/** Absent on the later lines of a multiline message. */
	msgid?: string;
	/** Multiline: the `batch` tag every line of the message carries. */
	batch?: string;
	line?: LineIndex;
	concat?: boolean;
};

/** A batch entry's lines joined: concat chunks glued on, `…` for a line not
 * yet received, a trailing `…` when the server capped the message. */
export function joinLines(entry: MergedMessage): string {
	if (!entry.lines || !entry.sent) {
		return entry.text;
	}

	let out = "";

	for (let i = 1; i <= entry.sent; i++) {
		const line = entry.lines[String(i)];

		if (!line) {
			out += (i === 1 ? "" : "\n") + "…";
			continue;
		}

		if (i > 1 && !line.concat) {
			out += "\n";
		}

		out += line.text;
	}

	if (entry.total !== undefined && entry.total > entry.sent) {
		out += "\n…";
	}

	return out;
}

/**
 * Add a pushed message, or one line of a batch, to the list. Returns the
 * new list (capped to `keep`, newest last) and whether a message was
 * created — a batch line joining an existing entry is not new, so the
 * unread count rises once per message. Inserting a line by index is
 * idempotent: duplicates and out-of-order delivery are harmless. A batch
 * line moves its entry to the end, so eviction takes older messages first;
 * a batch evicted anyway — more than `keep` newer messages between two of
 * its lines — starts over as a new entry. A plain message is idempotent by
 * msgid too: pushed again, it is neither added nor new.
 */
export function addMessage(
	entries: MergedMessage[],
	incoming: IncomingMessage,
	keep = MERGE_KEEP
): {entries: MergedMessage[]; isNew: boolean} {
	const list: MergedMessage[] = entries.map((entry) =>
		entry.lines ? {...entry, lines: {...entry.lines}} : {...entry}
	);

	if (incoming.batch && incoming.line) {
		const found = list.find((entry) => entry.batch === incoming.batch);
		const entry: MergedMessage = found ?? {
			from: incoming.from,
			text: "",
			msgid: incoming.msgid,
			batch: incoming.batch,
			lines: {},
		};

		// Only the first line carries the msgid; it may not be the first to arrive.
		entry.msgid = entry.msgid ?? incoming.msgid;
		entry.lines = entry.lines ?? {};
		entry.lines[String(incoming.line.index)] = {
			text: incoming.text,
			concat: incoming.concat === true,
		};
		entry.sent = Math.max(entry.sent ?? 0, incoming.line.sent);
		entry.total = Math.max(entry.total ?? 0, incoming.line.total);
		entry.text = joinLines(entry);

		if (found) {
			list.splice(list.indexOf(found), 1);
		}

		list.push(entry);

		return {entries: list.slice(-keep), isNew: !found};
	}

	// A push delivered twice (a push service promises at-least-once; the
	// server may retry) must not become a second message.
	if (incoming.msgid && list.some((entry) => entry.msgid === incoming.msgid)) {
		return {entries: list.slice(-keep), isNew: false};
	}

	list.push({from: incoming.from, text: incoming.text, msgid: incoming.msgid});

	return {entries: list.slice(-keep), isNew: true};
}

/** Middle ellipsis: keep how a long text starts and ends. */
export function midEllipsis(s: string, head = LINE_HEAD, tail = LINE_TAIL): string {
	if (s.length <= head + tail + 1) {
		return s;
	}

	return s.slice(0, head) + "…" + s.slice(s.length - tail);
}

/**
 * The merged body: one line per message (`from: text` in channels, bare
 * text in DMs), newest last, each through `render` (the stripper) first.
 * Over budget, the middle lines collapse into `… +N more` between the
 * oldest and the newest kept lines.
 */
export function renderMergedBody(
	entries: MergedMessage[],
	isChannel: boolean,
	render: (text: string) => string = (text) => text
): string {
	const lines = entries.map((message) => {
		const text = render(message.text);

		return isChannel && message.from ? `${message.from}: ${text}` : text;
	});
	const shown = lines.map((line) => midEllipsis(line));
	let dropped = 0;

	while (shown.length > 2 && shown.join("\n").length > BODY_BUDGET) {
		shown.splice(shown.length - 2, 1);
		dropped++;
	}

	if (dropped > 0) {
		shown.splice(shown.length - 1, 0, `… +${dropped} more`);
	}

	return shown.join("\n");
}
