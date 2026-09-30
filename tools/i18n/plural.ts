// The gettext plural-rules table (plural-rules.json) plus the small pieces
// of Plural-Forms parsing that compile.ts and merge.ts share. A new language
// adds one line to the table (documented in docs/resources/i18n.md); its
// expression is gettext's C plural form, restricted to what compile.ts's
// pluralEval allows.
import pluralRulesJson from "./plural-rules.json";

/** One language's gettext plural rule. */
export interface PluralRule {
	/** How many msgstr[N] slots a plural entry carries. */
	nplurals: number;
	/** gettext's C plural expression over `n`, e.g. "n != 1". */
	expr: string;
}

export const PLURAL_RULES = pluralRulesJson as Record<string, PluralRule>;

/** Parse a `Plural-Forms` header value into a rule; undefined when malformed. */
export function parsePluralForms(header: string): PluralRule | undefined {
	const nplurals = /nplurals\s*=\s*(\d+)/.exec(header);
	const expr = /plural\s*=\s*([^;]+)/.exec(header);

	if (!nplurals || !expr) {
		return undefined;
	}

	return {nplurals: Number(nplurals[1]), expr: expr[1].trim()};
}

/** Render a rule as the standard `Plural-Forms` header value. */
export function formatPluralForms(rule: PluralRule): string {
	return `nplurals=${rule.nplurals}; plural=(${rule.expr});`;
}

/** Evaluate gettext's C plural expression for `n`; the result indexes msgstr[N]. */
export function pluralEval(expr: string, n: number): number {
	if (!/^[n0-9 ():!=<>+\-*/%&|?:]+$/.test(expr)) {
		throw new Error(`unsafe plural expression: ${expr}`);
	}

	// gettext's C expressions yield 0/1; the JS forms of simple rules ("n != 1")
	// yield booleans, so coerce — the result indexes msgstr[N]. The regex
	// allowlist above is the only thing that reaches here.
	// eslint-disable-next-line @typescript-eslint/no-implied-eval
	return Number(Function("n", `"use strict"; return (${expr});`)(n));
}

/** One gettext slot of a plural entry and which source text fills it. */
export interface PluralSlot {
	/** The msgstr[N] index. */
	index: number;
	/** Which of the entry's two English forms this slot translates. */
	source: "msgid" | "msgidPlural";
}

/**
 * Every gettext slot of a plural entry, with the source text each one
 * translates: the slot the expression yields for n = 1 is the singular
 * (msgid), every other slot is the plural (msgid_plural). A one-form
 * language (ja, zh, ko, th, vi) is the exception — its single slot serves
 * every count, so it translates the plural text, the form that carries
 * {count}. Complete and independent of what is already filled — the caller
 * decides which slots it still needs.
 */
export function planPluralSlots(
	entry: {msgid: string; msgidPlural?: string},
	nplurals: number,
	expr: string
): PluralSlot[] {
	if (entry.msgidPlural === undefined) {
		return [];
	}

	// Only a language that HAS a singular gets one: with one form there is
	// nothing to contrast it with, and the count shows every time.
	const singular = nplurals > 1 ? pluralEval(expr, 1) : -1;

	return Array.from({length: nplurals}, (_, index) => ({
		index,
		source: index === singular ? ("msgid" as const) : ("msgidPlural" as const),
	}));
}
