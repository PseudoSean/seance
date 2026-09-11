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
// A shortcode body must contain at least one letter, but :+1: and :-1: are
// special cases.
const PATTERNS: RegExp[] = [
	/`[^`\n]+`/g,
	/\bhttps?:\/\/[^\s<>()]+/gi,
	/\bwww\.[^\s<>()]+/gi,
	/:(?:[+-]1|(?=[a-z0-9_+-]*[a-z])[a-z0-9_+-]{2,}):/gi,
	/\x03(?:\d{1,2}(?:,\d{1,2})?)?|[\x02\x0f\x11\x16\x1d\x1e\x1f]/g,
];

export function placeholder(n: number): string {
	return `${PLACEHOLDER_OPEN}${n}${PLACEHOLDER_CLOSE}`;
}

export function protect(text: string): Protected {
	const spans: string[] = [];
	let out = text;

	for (const pattern of PATTERNS) {
		out = out.replace(pattern, (match: string) => {
			spans.push(match);
			return placeholder(spans.length);
		});
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
