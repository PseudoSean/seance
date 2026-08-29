/**
 * Discord-style Markdown for message text.
 *
 * `applyMarkdown` is the interface: it takes the fragments `parseStyle`
 * produced, drops the marker characters, sets the Markdown flags and reports
 * the verbatim spans. The scan itself (`scan`/`cutPieces`) is private — nothing
 * outside this file needs the marker offsets.
 *
 * Imports nothing from Vue, the store or the DOM, so mocha loads it directly
 * (`test/helpers/parseMarkdown.ts`).
 */

import {findLinks} from "../../../../shared/linkify";
import {ParsedStyle, STYLE_KEYS} from "./parseStyle";

export type Range = {start: number; end: number};

// What the markers made of a piece of text. `verbatim` means "nothing is
// interpreted here" — the finders skip it; inline code also sets `monospace`,
// a fenced block sets `codeBlock`.
export type PieceFlags = {
	bold?: true;
	italic?: true;
	underline?: true;
	strikethrough?: true;
	monospace?: true;
	codeBlock?: true;
	quote?: true;
	spoiler?: true;
	verbatim?: true;
	href?: string;
};

// What the Markdown stage makes of a message: the style fragments with the
// markers gone and the flags set, plus the spans nothing is interpreted inside
// (offsets into the marker-free text).
export type Markdown = {fragments: ParsedStyle[]; verbatim: Range[]};

// Characters a backslash can escape
const MARKER_CHARS = "*_~|`>[]()\\";

const FENCE = "```";
// Optional language tag is only a tag when it ends the fence line
const fenceOpenRx = /^```(?:[\w+-]*\n)?/;
// The URL part allows one level of balanced parentheses, so Wikipedia-style
// links survive; the scheme is matched case-insensitively.
const linkRx = /^\[([^\]\n]+)\]\(((?:https?:\/\/|web\+irc:)(?:[^\s()]|\([^\s()]*\))+)\)/i;

type ScanFlag = keyof Omit<PieceFlags, "href">;

type ScanRange = (Range & {flag: ScanFlag}) | (Range & {flag: "href"; href: string});

type Scan = {
	// Marker characters to drop from the text
	removals: Range[];
	// Flagged spans; may cover removed characters, which is harmless
	ranges: ScanRange[];
};

type EmphasisToken = {len: number; flag: ScanFlag};

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

type OpenDelimiter = {char: string; len: number; flag: ScanFlag; pos: number};

const isWordChar = (c: string | undefined) => c !== undefined && /[\p{L}\p{N}_]/u.test(c);
const isSpace = (c: string | undefined) => c === undefined || /\s/.test(c);

const sameStyle = (a: ParsedStyle, b: ParsedStyle) => STYLE_KEYS.every((key) => a[key] === b[key]);

const covers = (range: Range, start: number, end: number) =>
	range.start <= start && end <= range.end;

// Applies Markdown to the fragments produced by parseStyle: marker characters
// are dropped, flags are set, offsets are renumbered and equal neighbours
// merged. Returns the input untouched when the message holds no Markdown.
export function applyMarkdown(fragments: ParsedStyle[]): Markdown {
	if (fragments.length === 0) {
		return {fragments, verbatim: []};
	}

	const text = fragments.map((fragment) => fragment.text).join("");
	const scanned = scan(text);

	if (scanned.removals.length === 0 && scanned.ranges.length === 0) {
		return {fragments, verbatim: []};
	}

	// Fragment boundaries are cut points too: a piece must never straddle two
	// styles, or it would lose one of them
	const boundaries = fragments.flatMap((fragment) => [fragment.start, fragment.end]);
	const result: ParsedStyle[] = [];
	const verbatim: Range[] = [];
	let offset = 0;

	for (const cut of cutPieces(text, scanned, boundaries)) {
		const source = fragments.find((fragment) => covers(fragment, cut.start, cut.end));

		if (!source) {
			continue;
		}

		const {verbatim: isVerbatim, ...flags} = cut.flags;
		const fragment: ParsedStyle = {
			...source,
			...flags,
			text: cut.text,
			start: offset,
			end: offset + cut.text.length,
		};

		if (isVerbatim) {
			const span = verbatim[verbatim.length - 1];

			if (span && span.end === fragment.start) {
				span.end = fragment.end;
			} else {
				verbatim.push({start: fragment.start, end: fragment.end});
			}
		}

		offset = fragment.end;
		const last = result[result.length - 1];

		if (last && sameStyle(last, fragment)) {
			last.text += fragment.text;
			last.end = fragment.end;
		} else {
			result.push(fragment);
		}
	}

	return {fragments: result, verbatim};
}

type Cut = Range & {text: string; flags: PieceFlags};

// Cuts `text` at every marker and flagged-span boundary (plus `extraCuts`),
// drops the marker characters and hands back the surviving segments with the
// flags covering them. Offsets are into `text`, markers included.
function cutPieces(text: string, {removals, ranges}: Scan, extraCuts: number[]): Cut[] {
	const points = new Set<number>([0, text.length, ...extraCuts]);

	for (const item of [...removals, ...ranges]) {
		points.add(item.start);
		points.add(item.end);
	}

	const sorted = [...points].sort((a, b) => a - b);
	const cuts: Cut[] = [];

	for (let k = 0; k < sorted.length - 1; k++) {
		const start = sorted[k];
		const end = sorted[k + 1];

		if (removals.some((removal) => covers(removal, start, end))) {
			continue;
		}

		const flags: PieceFlags = {};

		for (const range of ranges) {
			if (!covers(range, start, end)) {
				continue;
			}

			if (range.flag === "href") {
				flags.href = range.href;
			} else {
				flags[range.flag] = true;
			}
		}

		cuts.push({start, end, text: text.slice(start, end), flags});
	}

	return cuts;
}

// Scans `text` for Discord-style Markdown. Offsets in the result are into
// `text`; opaque spans (URLs) are never interpreted.
function scan(text: string): Scan {
	const removals: Range[] = [];
	const ranges: ScanRange[] = [];
	const skips = opaqueSpans(text);
	const stack: OpenDelimiter[] = [];
	let i = 0;

	while (i < text.length) {
		const skip = skips.find((r) => r.start <= i && i < r.end);

		if (skip) {
			i = skip.end;
			continue;
		}

		const c = text[i];
		const escaped = text[i + 1];

		// Not `MARKER_CHARS.includes(escaped ?? "")`: every string contains the
		// empty string, so a backslash ending the text would swallow itself.
		if (c === "\\" && escaped !== undefined && MARKER_CHARS.includes(escaped)) {
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
				ranges.push({start: i + 1, end: close, flag: "verbatim"});
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

// The stretches the scanner never looks inside: URLs, so that
// "https://x/a_b_c" or "https://x/**" survive intact.
function opaqueSpans(text: string): Range[] {
	return findLinks(text).map((link) => trimTrailingEmphasis(text, link));
}

// linkify-it greedily swallows a trailing run of emphasis characters into the
// URL ("**https://x**" matches "https://x**"), which would leave the opening
// marker unclosed. Peel them back off so the tokenizer still sees them.
function trimTrailingEmphasis(text: string, span: Range): Range {
	let end = span.end;

	while (end > span.start && text[end - 1] in EMPHASIS) {
		end -= 1;
	}

	return {start: span.start, end};
}

// Handles a run of identical emphasis characters starting at `i`; returns the
// index after the run.
function emphasis(
	text: string,
	i: number,
	stack: OpenDelimiter[],
	removals: Range[],
	ranges: ScanRange[]
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
function codeBlock(text: string, i: number, removals: Range[], ranges: ScanRange[]): number {
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
	ranges.push({start: contentStart, end: contentEnd, flag: "verbatim"});

	return removeEnd;
}

// A "> " quote line starting at `i`. Consecutive quote lines share one range.
function quote(text: string, i: number, removals: Range[], ranges: ScanRange[]) {
	let lineEnd = text.indexOf("\n", i);

	if (lineEnd === -1) {
		lineEnd = text.length;
	}

	removals.push({start: i, end: i + 2});

	// Not just the last range: inline markup on the previous quote line pushes
	// its own ranges after that line's quote range, so search backwards for the
	// quote block that ends on the newline right before this line.
	const idx = findLastIndex(ranges, (r) => r.flag === "quote" && r.end === i - 1);
	const last = idx === -1 ? undefined : ranges[idx];

	if (last) {
		last.end = lineEnd;
	} else {
		ranges.push({start: i + 2, end: lineEnd, flag: "quote"});
	}

	const nextIsQuote = text.startsWith("> ", lineEnd + 1);

	if (text[lineEnd] === "\n" && !nextIsQuote) {
		removals.push({start: lineEnd, end: lineEnd + 1});
	}
}

function findLastIndex<T>(list: T[], pred: (item: T) => boolean): number {
	for (let k = list.length - 1; k >= 0; k--) {
		if (pred(list[k])) {
			return k;
		}
	}

	return -1;
}
