// Deterministic span protection (spec § prompt.ts): everything the client
// itself treats as syntax rather than prose — URLs, code, emoji shortcodes,
// IRC formatting codes, Markdown markers, a line's leading syntax and the
// channel's nicknames — is swapped for numbered placeholders before any
// engine sees the text and put back afterwards. Fidelity is the code's job,
// not the model's: the model only ever sees a placeholder where the syntax
// was, so `*German*` can never come back as `German`.
//
// Three kinds of span, three restore policies (`restoreAll`):
//
//   verbatim  put back where it is found, appended at the end when lost
//   marker    one half of a pair; lose either half and neither goes back,
//             so a stray `*` is never left behind
//   prefix    a line's leading syntax; lost ⇒ re-prepended to its line
//
// Vue-free and DOM-free, so mocha loads it (`test/translate/spans.ts`).

export const PLACEHOLDER_OPEN = "⟦"; // ⟦
export const PLACEHOLDER_CLOSE = "⟧"; // ⟧

export type SpanMeta =
	| {kind: "verbatim"}
	/** 1-based index of the other half of the pair. */
	| {kind: "marker"; partner: number}
	/** 0-based line of the protected text the prefix opened. */
	| {kind: "prefix"; line: number};

export interface Protected {
	text: string;
	spans: string[];
	meta: SpanMeta[];
}

export interface ProtectOptions {
	/** The channel's user list: a name is data, never something to translate. */
	nicks?: string[];
}

// Order matters: a code span swallows the URL inside it, a URL swallows the
// shortcode-looking `:80:` inside it. Placeholders never match a later
// pattern (no letters, no colons, no control characters).
// A shortcode body must contain at least one letter, but :+1: and :-1: are
// special cases.
const PATTERNS: RegExp[] = [
	/`[^`\n]+`/g,
	/\bhttps?:\/\/[^\s<>()]+/gi,
	/\bwww\.[^\s<>()]+/gi,
	/:(?:[+-]1|(?=[a-z0-9_+-]*[a-z])[a-z0-9_+-]{2,}):/gi,
	/\x03(?:\d{1,2}(?:,\d{1,2})?)?|[\x02\x0f\x11\x16\x1d\x1e\x1f]/g,
];

/** A placeholder as the engines see it; the spaces a model may insert are tolerated. */
const PLACEHOLDER_RX = /⟦\s*(\d+)\s*⟧/g;

// The client's own emphasis markers (parseMarkdown.ts `EMPHASIS`), longest
// first so `**bold**` is one pair and not two nested italics. Each is a full
// pass over the previous pass's output, so `**bold *italic* bold**` still
// finds the inner pair.
const EMPHASIS_MARKERS = ["**", "__", "~~", "||", "*", "_"];

// A line's leading syntax: quote markers (nested), then one of a header, a
// bullet or an ordered item. `parseMarkdown.ts` renders a narrower set (`- `
// and `1. ` only), and protecting a little more than it renders is safe —
// a prefix span is put back byte for byte.
const PREFIX_RX = /^((?:> )*(?:#{1,6} |[-*+] |\d+[.)] )?)(.*)$/;

// A Markdown link's target: the placeholder a URL already became (the URL
// stage runs first), or a scheme the client itself linkifies.
const LINK_RX = /\[([^\]\n]+)\]\((⟦\s*\d+\s*⟧|(?:https?:\/\/|web\+irc:)[^\s)]*)\)/g;

const isWordChar = (c: string | undefined) => c !== undefined && /[\p{L}\p{N}_]/u.test(c);

export function placeholder(n: number): string {
	return `${PLACEHOLDER_OPEN}${n}${PLACEHOLDER_CLOSE}`;
}

/** The placeholder numbers `text` carries, in order, without duplicates. */
export function placeholdersIn(text: string): number[] {
	const found: number[] = [];

	for (const match of text.matchAll(PLACEHOLDER_RX)) {
		const index = Number(match[1]);

		if (!found.includes(index)) {
			found.push(index);
		}
	}

	return found;
}

/** Collects the spans as the stages find them, keeping numbering global. */
class Spans {
	readonly spans: string[] = [];
	readonly meta: SpanMeta[] = [];

	push(text: string, meta: SpanMeta): string {
		this.spans.push(text);
		this.meta.push(meta);

		return placeholder(this.spans.length);
	}

	/** Two halves that stand or fall together. */
	pair(open: string, close: string): [string, string] {
		const first = this.spans.length + 1;
		const second = first + 1;

		this.spans.push(open, close);
		this.meta.push({kind: "marker", partner: second}, {kind: "marker", partner: first});

		return [placeholder(first), placeholder(second)];
	}
}

// A fenced block is one span, fences and inner newlines included, so the
// block's content is never split across the requests a multi-line message
// is translated by. The closing fence stands on a line of its own and is at
// least as long as the opening one.
function protectFences(text: string, spans: Spans): string {
	const lines = text.split("\n");
	const out: string[] = [];
	let i = 0;

	while (i < lines.length) {
		const open = /^(`{3,})/.exec(lines[i]);
		let close = -1;

		if (open) {
			for (let k = i + 1; k < lines.length; k++) {
				const end = /^(`{3,})\s*$/.exec(lines[k]);

				if (end && end[1].length >= open[1].length) {
					close = k;
					break;
				}
			}
		}

		if (close === -1) {
			out.push(lines[i]);
			i += 1;
			continue;
		}

		out.push(spans.push(lines.slice(i, close + 1).join("\n"), {kind: "verbatim"}));
		i = close + 1;
	}

	return out.join("\n");
}

// `[text](target)`: the brackets are a marker pair and the link text is
// translated between them.
function protectLinks(text: string, spans: Spans): string {
	return text.replace(LINK_RX, (_match, label: string, target: string) => {
		const [open, close] = spans.pair("[", `](${target})`);

		return `${open}${label}${close}`;
	});
}

// The usual emphasis rule, conservatively: an opener has a non-word
// character (or nothing) before it and a word character after it, a closer
// the other way round. So `*German*` is emphasis and `2*3*4` is not.
function canOpen(text: string, at: number, len: number): boolean {
	return !isWordChar(text[at - 1]) && isWordChar(text[at + len]);
}

function canClose(text: string, at: number, len: number): boolean {
	return isWordChar(text[at - 1]) && !isWordChar(text[at + len]);
}

/** The first closer for `marker` after `from`, on the same line; -1 when there is none. */
function findCloser(text: string, from: number, marker: string): number {
	for (let i = from; i < text.length; i++) {
		if (text[i] === "\n") {
			return -1;
		}

		if (i > from && text.startsWith(marker, i) && canClose(text, i, marker.length)) {
			return i;
		}
	}

	return -1;
}

function protectMarker(text: string, marker: string, spans: Spans): string {
	const len = marker.length;
	let out = "";
	let i = 0;

	while (i < text.length) {
		if (!text.startsWith(marker, i) || !canOpen(text, i, len)) {
			out += text[i];
			i += 1;
			continue;
		}

		const close = findCloser(text, i + len, marker);

		if (close === -1) {
			out += text[i];
			i += 1;
			continue;
		}

		const [open, closer] = spans.pair(marker, marker);

		out += `${open}${text.slice(i + len, close)}${closer}`;
		i = close + len;
	}

	return out;
}

function protectEmphasis(text: string, spans: Spans): string {
	let out = text;

	for (const marker of EMPHASIS_MARKERS) {
		out = protectMarker(out, marker, spans);
	}

	return out;
}

function protectPrefixes(text: string, spans: Spans): string {
	return text
		.split("\n")
		.map((line, index) => {
			const match = PREFIX_RX.exec(line);

			// Nothing after the marker is not a header or a list item, and not
			// a licence to protect the whole line either.
			if (!match || match[1] === "" || match[2].trim() === "") {
				return line;
			}

			return `${spans.push(match[1], {kind: "prefix", line: index})}${match[2]}`;
		})
		.join("\n");
}

// The channel's names, whole-word, longest first, never inside a
// placeholder an earlier stage left. The prompt still lists the names as
// data, so the model sees both the placeholder and the name it stands for.
function protectNicks(text: string, nicks: string[], spans: Spans): string {
	const candidates = [...new Set(nicks)]
		.filter((nick) => nick.length >= 2)
		.sort((a, b) => b.length - a.length);

	if (candidates.length === 0) {
		return text;
	}

	const lower = text.toLowerCase();
	let out = "";
	let i = 0;

	while (i < text.length) {
		if (text[i] === PLACEHOLDER_OPEN) {
			const end = text.indexOf(PLACEHOLDER_CLOSE, i);

			if (end !== -1) {
				out += text.slice(i, end + 1);
				i = end + 1;
				continue;
			}
		}

		const nick = candidates.find(
			(candidate) =>
				lower.startsWith(candidate.toLowerCase(), i) &&
				!isWordChar(text[i - 1]) &&
				!isWordChar(text[i + candidate.length])
		);

		if (nick) {
			out += spans.push(text.slice(i, i + nick.length), {kind: "verbatim"});
			i += nick.length;
			continue;
		}

		out += text[i];
		i += 1;
	}

	return out;
}

/**
 * Protect, stage by stage: each stage runs on the previous one's output, so
 * a placeholder never matches a later pattern. Fenced blocks, then the
 * opaque spans (code, URLs, shortcodes, formatting codes), then links,
 * emphasis pairs, line prefixes and finally the nicknames.
 */
export function protect(text: string, options: ProtectOptions = {}): Protected {
	const spans = new Spans();
	let out = protectFences(text, spans);

	for (const pattern of PATTERNS) {
		out = out.replace(pattern, (match: string) => spans.push(match, {kind: "verbatim"}));
	}

	out = protectLinks(out, spans);
	out = protectEmphasis(out, spans);
	out = protectPrefixes(out, spans);
	out = protectNicks(out, options.nicks ?? [], spans);

	return {text: out, spans: spans.spans, meta: spans.meta};
}

/**
 * A span's own text, with any placeholder inside it resolved as well: a
 * link's `](target)` half carries the placeholder the URL stage already
 * made of its target, and a span put back by a plain `replace` would
 * otherwise leave that number showing. `seen` collects what came back that
 * way, so a nested span is never also reported lost.
 */
function expandSpan(spans: string[], index: number, seen: Set<number>, depth = 0): string {
	const raw = spans[index - 1];

	if (depth >= 4 || !raw.includes(PLACEHOLDER_OPEN)) {
		return raw;
	}

	return raw.replace(PLACEHOLDER_RX, (match, n: string) => {
		const nested = Number(n);

		if (nested < 1 || nested > spans.length || nested === index) {
			return match;
		}

		seen.add(nested);

		return expandSpan(spans, nested, seen, depth + 1);
	});
}

export function restore(text: string, spans: string[]): {text: string; missing: number[]} {
	const seen = new Set<number>();
	const out = text.replace(PLACEHOLDER_RX, (match, n: string) => {
		const index = Number(n);

		if (index >= 1 && index <= spans.length) {
			seen.add(index);
			return expandSpan(spans, index, seen);
		}

		return match;
	});
	const missing = spans.map((_, i) => i + 1).filter((i) => !seen.has(i));

	return {text: out, missing};
}

/** The lost spans, in order, after the text: better shown late than lost. */
export function appendMissing(text: string, spans: string[], missing: number[]): string {
	if (missing.length === 0) {
		return text;
	}

	return `${text} ${missing.map((i) => spans[i - 1]).join(" ")}`;
}

/**
 * The full restore: placeholders put back where the engine left them, each
 * kind of lost span handled by its own policy, and a placeholder number the
 * engine invented dropped rather than shown.
 *
 * `expected` is the spans that were in *this* request's input — the lines of
 * one message are translated separately but share one numbering, so a line's
 * restore must not go looking for another line's spans. Given it, a lost
 * prefix goes to the front of the output; without it (a whole text restored
 * in one go) it goes back to its own line, as long as the line count held.
 */
export function restoreAll(text: string, info: Protected, expected?: number[]): string {
	// What the engine was given, not every span there is: a span nested
	// inside another (a link's target) travels with its parent.
	const want = expected ?? placeholdersIn(info.text);
	const found = new Set(placeholdersIn(text).filter((i) => i >= 1 && i <= info.spans.length));
	// Half a pair is no use: put back neither, rather than a stray `*`.
	const orphaned = new Set(
		[...found].filter((i) => {
			const meta = info.meta[i - 1];

			return meta.kind === "marker" && !found.has(meta.partner);
		})
	);

	let out = text.replace(PLACEHOLDER_RX, (_match, n: string) => {
		const index = Number(n);

		if (index < 1 || index > info.spans.length || orphaned.has(index)) {
			return "";
		}

		return expandSpan(info.spans, index, found);
	});

	const missing = want.filter((i) => !found.has(i) || orphaned.has(i));
	const prefixes = missing.filter((i) => info.meta[i - 1]?.kind === "prefix");

	if (prefixes.length > 0) {
		const lines = out.split("\n");
		const perLine = expected === undefined && lines.length === info.text.split("\n").length;

		for (const index of prefixes) {
			const meta = info.meta[index - 1];
			const line = perLine && meta.kind === "prefix" ? meta.line : 0;

			lines[line] = `${info.spans[index - 1]}${lines[line]}`;
		}

		out = lines.join("\n");
	}

	// A lost marker takes its partner with it and neither is appended; a
	// lost prefix is back on its line. What is left is verbatim: better
	// shown late than lost.
	const lost = missing.filter((i) => info.meta[i - 1]?.kind === "verbatim");

	return lost.length === 0
		? out
		: `${out} ${lost.map((i) => expandSpan(info.spans, i, new Set())).join(" ")}`;
}
