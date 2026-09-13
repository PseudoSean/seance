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
