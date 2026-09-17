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

/** Why a slot's fill cannot be kept: `isSuspectCatalogEntry`, plus the
 * {placeholder} braces the render and the compile depend on, plus an answer
 * that is its own English source. */
export type SlotVerdict = SuspectReason | "placeholder" | "unchanged";

/**
 * Words a catalog legitimately carries unchanged in every language: the
 * acronyms and product names the pot uses (`grep` of messages.pot), plus the
 * assent every locale writes the same way. An answer counts as unchanged
 * only when its WHOLE text is these, so "Connected (TLS)" is still judged on
 * its own words while a bare "TLS" is let through.
 */
const IDENTICAL_EVERYWHERE = new Set(
	[
		"ok",
		"irc",
		"ircv3",
		"sasl",
		"tls",
		"webgpu",
		"websocket",
		"url",
		"opus",
		"mt",
		"opus-mt",
		"nllb",
		"nllb-200",
		"200",
		"qwen",
		"qwen3",
		"gpu",
		"cpu",
		"gib",
		"mib",
		"kib",
		"utc",
		"markdown",
		"emoji",
	].map((word) => word.toLowerCase())
);

/**
 * The text as a comparison sees it: no {placeholder}s (their content is the
 * deploy's, not the translator's), no case, no punctuation, one space
 * between words. "Close" and "close." are the same answer.
 */
function echoForm(text: string): string {
	return text
		.replace(PLACEHOLDER, " ")
		.toLowerCase()
		.replace(/[^\p{L}\p{N}-]+/gu, " ")
		.trim()
		.replace(/\s+/g, " ");
}

/**
 * True when `text` is `source` again rather than a translation of it. The
 * engines answer with the English they were given often enough that a
 * catalog fills up with it (uk came back 864 entries English), and nothing
 * else notices: English letters are allowed in every script, the length is
 * right and the placeholders match. The slot is better left empty — the
 * runtime serves English for a missing key anyway, and an empty slot is
 * what the next fill looks for.
 */
export function isUnchanged(source: string, text: string): boolean {
	const left = echoForm(source);

	// Nothing to translate: no letters at all, or only {placeholder}s and
	// punctuation.
	if (!left || !/\p{L}/u.test(left)) {
		return false;
	}

	if (left !== echoForm(text)) {
		return false;
	}

	return !left.split(" ").every((word) => IDENTICAL_EVERYWHERE.has(word));
}

const braces = (text: string): string => (text.match(PLACEHOLDER) ?? []).sort().join("|");

/**
 * The one verdict the fill and the sweep both judge a filled slot by, so
 * that the fill refuses exactly what the sweep would empty: anything else
 * is a loop, each writing back what the other takes away. `source` is the
 * English text THAT SLOT translates, never the entry as a whole.
 */
export function slotVerdict(tag: string, source: string, text: string): SlotVerdict | null {
	if (!text) {
		return null;
	}

	if (braces(source) !== braces(text)) {
		return "placeholder";
	}

	if (isUnchanged(source, text)) {
		return "unchanged";
	}

	return isSuspectCatalogEntry(tag, source, text);
}
