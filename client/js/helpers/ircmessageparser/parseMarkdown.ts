import {findLinks} from "../../../../shared/linkify";

export type Range = {start: number; end: number};

export type MarkdownFlag =
	| "bold"
	| "italic"
	| "underline"
	| "strikethrough"
	| "monospace"
	| "code"
	| "codeBlock"
	| "quote"
	| "spoiler";

export type MarkdownRange = (Range & {flag: MarkdownFlag}) | (Range & {flag: "href"; href: string});

export type MarkdownTokens = {
	// Marker characters to drop from the text
	removals: Range[];
	// Styled spans; may cover removed characters, which is harmless
	ranges: MarkdownRange[];
};

// Characters a backslash can escape
const MARKER_CHARS = "*_~|`>[]()\\";

const FENCE = "```";
// Optional language tag is only a tag when it ends the fence line
const fenceOpenRx = /^```(?:[\w+-]*\n)?/;
const linkRx = /^\[([^\]\n]+)\]\(((?:https?:\/\/|web\+irc:)[^\s)]+)\)/;

type EmphasisToken = {len: number; flag: MarkdownFlag};

// Emphasis delimiters, longest token first
const EMPHASIS: Record<string, EmphasisToken[]> = {
	"*": [
		{len: 2, flag: "bold"},
		{len: 1, flag: "italic"},
	],
	_: [
		{len: 2, flag: "underline"},
		{len: 1, flag: "italic"},
	],
	"~": [{len: 2, flag: "strikethrough"}],
	"|": [{len: 2, flag: "spoiler"}],
};

type OpenDelimiter = {char: string; len: number; flag: MarkdownFlag; pos: number};

const isWordChar = (c: string | undefined) => c !== undefined && /[\p{L}\p{N}_]/u.test(c);
const isSpace = (c: string | undefined) => c === undefined || /\s/.test(c);

// Scans `text` for Discord-style Markdown. Offsets in the result are into
// `text`. Ranges listed in `opaque` (URLs by default) are never interpreted.
export function tokenize(text: string, opaque?: Range[]): MarkdownTokens {
	const removals: Range[] = [];
	const ranges: MarkdownRange[] = [];
	// findLinks() can greedily swallow trailing emphasis markers into the
	// URL (e.g. "**https://x**" matches "https://x**"); trim those back off
	// so the markers stay available to the tokenizer. Explicitly passed
	// opaque ranges are trusted as-is.
	const skips: Range[] = (opaque ?? findLinks(text)).map((r) =>
		opaque ? {start: r.start, end: r.end} : trimTrailingMarkers(text, r)
	);
	const stack: OpenDelimiter[] = [];
	let i = 0;

	while (i < text.length) {
		const skip = skips.find((r) => r.start <= i && i < r.end);

		if (skip) {
			i = skip.end;
			continue;
		}

		const c = text[i];

		if (c === "\\" && MARKER_CHARS.includes(text[i + 1] ?? "")) {
			removals.push({start: i, end: i + 1});
			i += 2;
			continue;
		}

		if (text.startsWith(FENCE, i)) {
			const after = codeBlock(text, i, removals, ranges);

			if (after !== -1) {
				i = after;
				continue;
			}

			i += FENCE.length;
			continue;
		}

		if (c === "`") {
			const close = text.indexOf("`", i + 1);

			if (close > i + 1) {
				removals.push({start: i, end: i + 1}, {start: close, end: close + 1});
				ranges.push({start: i + 1, end: close, flag: "monospace"});
				ranges.push({start: i + 1, end: close, flag: "code"});
				i = close + 1;
				continue;
			}

			i += 1;
			continue;
		}

		if (c === ">" && text[i + 1] === " " && (i === 0 || text[i - 1] === "\n")) {
			quote(text, i, removals, ranges);
			i += 2;
			continue;
		}

		if (c === "[") {
			const match = linkRx.exec(text.slice(i));

			if (match) {
				const textStart = i + 1;
				const textEnd = textStart + match[1].length;
				const end = i + match[0].length;
				removals.push({start: i, end: textStart}, {start: textEnd, end});
				ranges.push({start: textStart, end: textEnd, flag: "href", href: match[2]});
				// The link text is scanned normally; the "](url)" tail is not
				skips.push({start: textEnd, end});
				i = textStart;
				continue;
			}

			i += 1;
			continue;
		}

		if (c in EMPHASIS) {
			i = emphasis(text, i, stack, removals, ranges);
			continue;
		}

		i += 1;
	}

	return {removals, ranges};
}

// Handles a run of identical emphasis characters starting at `i`; returns the
// index after the run.
function emphasis(
	text: string,
	i: number,
	stack: OpenDelimiter[],
	removals: Range[],
	ranges: MarkdownRange[]
): number {
	const c = text[i];
	let n = 1;

	while (text[i + n] === c) {
		n += 1;
	}

	const prev = text[i - 1];
	const next = text[i + n];
	let canOpen = !isSpace(next);
	let canClose = !isSpace(prev);

	if (c === "_") {
		canOpen = canOpen && !isWordChar(prev);
		canClose = canClose && !isWordChar(next);
	}

	let pos = i;
	let remaining = n;

	if (canClose) {
		while (remaining > 0) {
			const idx = findLastIndex(stack, (o) => o.char === c && o.len <= remaining);

			if (idx === -1) {
				break;
			}

			const open = stack[idx];
			// Anything opened after this delimiter stays literal
			stack.length = idx;
			ranges.push({start: open.pos + open.len, end: pos, flag: open.flag});
			removals.push({start: open.pos, end: open.pos + open.len});
			removals.push({start: pos, end: pos + open.len});
			pos += open.len;
			remaining -= open.len;
		}
	}

	if (remaining > 0 && canOpen) {
		for (const token of EMPHASIS[c]) {
			while (remaining >= token.len) {
				stack.push({char: c, len: token.len, flag: token.flag, pos});
				pos += token.len;
				remaining -= token.len;
			}
		}
	}

	return i + n;
}

// A fenced code block starting at `i`. Returns the index after the block, or
// -1 when the fence is not closed or empty.
function codeBlock(text: string, i: number, removals: Range[], ranges: MarkdownRange[]): number {
	const close = text.indexOf(FENCE, i + FENCE.length);

	if (close === -1) {
		return -1;
	}

	const open = fenceOpenRx.exec(text.slice(i))?.[0].length ?? FENCE.length;
	let contentStart = i + open;
	let contentEnd = close;

	if (text[contentEnd - 1] === "\n" && contentEnd - 1 >= contentStart) {
		contentEnd -= 1;
	}

	if (contentStart > close) {
		// The "language tag" was the whole content
		contentStart = i + FENCE.length;
		contentEnd = close;
	}

	if (contentEnd <= contentStart) {
		return -1;
	}

	// Block-level: swallow the newline before the opening and after the closing fence
	const removeStart = text[i - 1] === "\n" ? i - 1 : i;
	let removeEnd = close + FENCE.length;

	if (text[removeEnd] === "\n") {
		removeEnd += 1;
	}

	removals.push({start: removeStart, end: contentStart}, {start: contentEnd, end: removeEnd});
	ranges.push({start: contentStart, end: contentEnd, flag: "codeBlock"});
	ranges.push({start: contentStart, end: contentEnd, flag: "code"});

	return removeEnd;
}

// A "> " quote line starting at `i`. Consecutive quote lines share one range.
function quote(text: string, i: number, removals: Range[], ranges: MarkdownRange[]) {
	let lineEnd = text.indexOf("\n", i);

	if (lineEnd === -1) {
		lineEnd = text.length;
	}

	removals.push({start: i, end: i + 2});

	const last = ranges[ranges.length - 1];

	if (last && last.flag === "quote" && last.end === i - 1) {
		last.end = lineEnd;
	} else {
		ranges.push({start: i + 2, end: lineEnd, flag: "quote"});
	}

	const nextIsQuote = text.startsWith("> ", lineEnd + 1);

	if (text[lineEnd] === "\n" && !nextIsQuote) {
		removals.push({start: lineEnd, end: lineEnd + 1});
	}
}

// Trims a trailing run of emphasis marker characters off an opaque range's
// end, so they remain available to the tokenizer.
function trimTrailingMarkers(text: string, r: Range): Range {
	let end = r.end;

	while (end > r.start && text[end - 1] in EMPHASIS) {
		end -= 1;
	}

	return {start: r.start, end};
}

function findLastIndex<T>(list: T[], pred: (item: T) => boolean): number {
	for (let k = list.length - 1; k >= 0; k--) {
		if (pred(list[k])) {
			return k;
		}
	}

	return -1;
}
