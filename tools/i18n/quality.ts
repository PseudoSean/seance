/**
 * The i18n fill's quality gate: the same degenerate-output rule the app's
 * translation pipeline judges every answer by (`outgoing.ts` `isDegenerate`,
 * wired into `answerError` and the queue's `report`). One rule, two callers:
 * the fill rejects a garbage row at translate time, the sweep empties one it
 * already shipped, and the running app reports a garbage answer as a failed
 * translation instead of rendering it.
 *
 * This module exists so the fill/sweep can import the rule without executing
 * fill.ts (an argv-driven script with side effects). On top of it, the two
 * rules only a CATALOG entry can be judged by -- a UI string has a known
 * English source and a known target language, neither of which a chat line
 * has, so neither rule belongs in the runtime gate: a chat line legitimately
 * runs long ("brb" -> "je reviens tout de suite") and legitimately carries
 * whatever script its author typed.
 */
import {isDegenerate} from "../../client/js/translate/outgoing";
import {EXPECTED_SCRIPTS} from "./scripts";

export {isDegenerate};

/** How far past its English a translation may run: 4x its length, plus 20. */
export const LENGTH_FACTOR = 4;
export const LENGTH_ALLOWANCE = 20;

export type SuspectReason = "degenerate" | "runaway-length" | "foreign-script";

/** A {placeholder}'s content is the deploy's, never the translator's. */
const PLACEHOLDER = /\{[^{}]*\}/g;

/**
 * Why a catalog entry's translation cannot be what it claims to be, or null
 * if nothing is wrong with it. `source` is the English text THAT SLOT
 * translates (the msgid for the slot a language's singular reads, the
 * msgid_plural for every other), never the entry as a whole.
 *
 * The three rules, in the order a reader wants them reported: the model got
 * stuck and repeated itself, it answered with an essay where a label was
 * asked for, or it answered in a writing system the target language is not
 * written in. Each was measured against the 22 machine-filled catalogs this
 * branch dropped.
 */
export function isSuspectCatalogEntry(
	tag: string,
	source: string,
	text: string
): SuspectReason | null {
	if (!text) {
		return null;
	}

	if (isDegenerate(text, source)) {
		return "degenerate";
	}

	if (text.length > LENGTH_FACTOR * source.length + LENGTH_ALLOWANCE) {
		return "runaway-length";
	}

	const allowed = EXPECTED_SCRIPTS[tag];

	if (!allowed) {
		return null;
	}

	for (const ch of text.replace(PLACEHOLDER, "")) {
		if (!/\p{L}/u.test(ch)) {
			continue;
		}

		if (!allowed.some((script) => script.test(ch))) {
			return "foreign-script";
		}
	}

	return null;
}
