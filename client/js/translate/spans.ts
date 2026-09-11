// Deterministic span protection (spec § prompt.ts): URLs, code spans, emoji
// shortcodes and IRC formatting codes never need translating, so they are
// swapped for numbered placeholders before any engine sees the text and put
// back afterwards. A result that lost a placeholder is reported through
// `missing` so the caller can retry once and then append the lost spans.

export const PLACEHOLDER_OPEN = "⟦"; // ⟦
export const PLACEHOLDER_CLOSE = "⟧"; // ⟧

export interface Protected {
	text: string;
	spans: string[];
}

// Order matters: a code span swallows the URL inside it, a URL swallows the
// shortcode-looking `:80:` inside it. Placeholders never match a later
// pattern (no letters, no colons, no control characters).
const PATTERNS: RegExp[] = [
	/`[^`\n]+`/g,
	/\bhttps?:\/\/[^\s<>()]+/gi,
	/\bwww\.[^\s<>()]+/gi,
	/:[a-z0-9_+-]{2,}:/gi,
	// eslint-disable-next-line no-control-regex
	/\x03(?:\d{1,2}(?:,\d{1,2})?)?|[\x02\x0f\x11\x16\x1d\x1e\x1f]/g,
];

export function placeholder(n: number): string {
	return `${PLACEHOLDER_OPEN}${n}${PLACEHOLDER_CLOSE}`;
}

export function protect(text: string): Protected {
	interface Match {
		match: string;
		index: number;
		endIndex: number;
	}
	const allMatches: Match[] = [];

	for (const pattern of PATTERNS) {
		let m;
		pattern.lastIndex = 0;
		while ((m = pattern.exec(text)) !== null) {
			allMatches.push({match: m[0], index: m.index, endIndex: m.index + m[0].length});
		}
	}

	// Code spans (first pattern) take priority and swallow other matches inside them
	const codeSpans = allMatches.filter((m) => m.match[0] === "`");
	const otherMatches = allMatches.filter((m) => {
		if (m.match[0] === "`") return false;
		return !codeSpans.some((cs) => m.index >= cs.index && m.endIndex <= cs.endIndex);
	});

	// Combine and sort by position in original text
	const filteredMatches = [...codeSpans, ...otherMatches];
	filteredMatches.sort((a, b) => a.index - b.index);

	// Build spans array and track replacements
	const spans: string[] = [];
	const replacements: Array<{index: number; spanIndex: number; length: number}> = [];

	for (const {match, index, endIndex} of filteredMatches) {
		spans.push(match);
		replacements.push({index, spanIndex: spans.length, length: endIndex - index});
	}

	// Replace from right to left to maintain indices
	let out = text;
	for (let i = replacements.length - 1; i >= 0; i--) {
		const {index, spanIndex, length} = replacements[i];
		out = out.substring(0, index) + placeholder(spanIndex) + out.substring(index + length);
	}

	return {text: out, spans};
}

export function restore(text: string, spans: string[]): {text: string; missing: number[]} {
	const seen = new Set<number>();
	const out = text.replace(/⟦\s*(\d+)\s*⟧/g, (match, n: string) => {
		const index = Number(n);

		if (index >= 1 && index <= spans.length) {
			seen.add(index);
			return spans[index - 1];
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
