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
import {EXPECTED_SCRIPTS, OWN_SCRIPTS} from "./scripts";

export {isDegenerate};

/** How far past its English a translation may run: 4x its length, plus 20. */
export const LENGTH_FACTOR = 4;
export const LENGTH_ALLOWANCE = 20;

export type SuspectReason =
	| "degenerate"
	| "runaway-length"
	| "foreign-script"
	| "foreign-script:no-target-script";

/** A {placeholder}'s content is the deploy's, never the translator's. */
const PLACEHOLDER = /\{[^{}]*\}/g;

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
 * The words of a text that could carry the target language: no
 * {placeholder}s (their content is the deploy's), none of the acronyms and
 * product names every language writes alike, and nothing under three
 * letters — a language tag ("de", "en") or an initial is no evidence of what
 * language a sentence is in, and "OPUS-MT de → en (CPU)" is a legitimate
 * row in every catalog.
 */
function bodyWords(text: string): string[] {
	return text
		.replace(PLACEHOLDER, " ")
		.toLowerCase()
		.split(/[^\p{L}\p{N}-]+/u)
		.filter(
			(word) =>
				word.length > 2 &&
				/\p{L}/u.test(word) &&
				!IDENTICAL_EVERYWHERE.has(word) &&
				!word.split("-").every((part) => part === "" || IDENTICAL_EVERYWHERE.has(part))
		);
}

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

	const own = OWN_SCRIPTS[tag];

	// A target with a script of its own has to answer in it. Latin is allowed
	// in every catalog (brand names, protocol words, {placeholder} names), so
	// an answer in French, Polish or invented pseudo-Welsh passed every other
	// rule and sat in the Ukrainian catalog looking well-formed. A body with
	// letters of its own and not one character of the target's script is not
	// in the target language at all.
	if (own && bodyWords(text).length > 0 && !own.some((script) => script.test(text))) {
		return "foreign-script:no-target-script";
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
 * that is its own English source, one that dropped the source's own leading
 * or trailing space, one carrying a machine-translation artifact, and one
 * that came back with fewer sentences than it was given. */
export type SlotVerdict =
	| SuspectReason
	| "placeholder"
	| "unchanged"
	| "padding"
	| "artifact"
	| "sentences";

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

/** A string's own leading and trailing whitespace, as one comparable pair. */
const padding = (text: string): string =>
	`${/^\s*/.exec(text)![0]}|${text.trim() === "" ? "" : /\s*$/.exec(text)![0]}`;

/**
 * True when the translation dropped (or invented) the padding its English
 * carries. A msgid with a space at one end has it on purpose -- it is read
 * out beside something else, like the screen-reader prefix before a nick --
 * and every engine trims its answer, so all 23 catalogs came back with the
 * padding gone and the two texts run together. Whitespace is not copy: the
 * translation has to carry exactly what the source does.
 */
export function isMispadded(source: string, text: string): boolean {
	return padding(source) !== padding(text);
}

/**
 * The answer with the source's own padding put back around it. Whitespace at
 * the ends is structure, not copy -- no engine keeps it and no translator
 * should have to -- so the fill re-pads before judging, and `isMispadded`
 * stays the net under the catalogs nothing re-pads (a hand edit, a fill that
 * ran before this rule).
 */
export function repad(source: string, text: string): string {
	if (!text.trim()) {
		return text;
	}

	return `${/^\s*/.exec(source)![0]}${text.trim()}${/\s*$/.exec(source)![0]}`;
}

/**
 * The text an artifact is looked for in: no {placeholder}s and no code
 * spans. What a deploy writes inside a brace and what a msgid fences as
 * code is an identifier, not prose — `{old_name}` and `` `ctcp_type` ``
 * carry underscores that are nobody's mistake.
 */
const CODE_SPAN = /`[^`\n]*`/g;

const withoutIdentifiers = (text: string): string =>
	text.replace(CODE_SPAN, " ").replace(PLACEHOLDER, " ");

/**
 * Control tokens the seq2seq engines write out as text when they run out of
 * sentence, found by comparing every 23 catalogs' msgstrs against their own
 * msgids: NLLB's `_BAR_` for a pipe, its sentencepiece word mark, the
 * end-of-stream tags, and the musical notes it pads a short answer with.
 * None of them appears in any English source, so any of them is an artifact
 * wherever it is found.
 */
const ARTIFACT_TOKENS = /_BAR_|<\/?s>|<unk>|<pad>|▁|[♪♫♬]/u;

/** An HTML entity: the engines escape a character the source writes plainly. */
const ENTITY = /&(?:quot|amp|lt|gt|apos|nbsp|#\d+);/gi;

/**
 * True when the answer carries a machine-translation artifact its English
 * never did. 22 ru entries shipped one — `…подключения._`,
 * `…каналов._BAR_`, `♫ Aliases.ий` — and every other gate found them
 * well-formed: the length is right, the script is right, the placeholders
 * match.
 *
 * A doubled full stop is one of these too (`doublesTerminator`).
 *
 * The stray `_` and `|` are the delicate half. An underscore BETWEEN two
 * alphanumerics is snake_case, and an underscore the source itself carries
 * is copy (two msgids name the character: "letters, digits, _ and -"), so
 * the rule fires only on a character the English has nowhere and that is
 * not sitting inside a word — the `_` glued onto the end of a sentence, or
 * onto the front of the English the model gave up translating.
 */
/**
 * True when the answer padded the end of a sentence the source had already
 * finished: ru came back with `…в этом браузере..` and `…сеть IRC...` for
 * msgids ending in one period. The rule is as narrow as the evidence — the
 * source's trailing run of periods is exactly one and the answer's is two or
 * more — because an ellipsis IS the copy in a good many msgids ("Loading…",
 * and the pot says so in their contexts), and a source that writes three
 * periods wants three back.
 */
function doublesTerminator(source: string, text: string): boolean {
	const run = (value: string) => (/\.+$/.exec(value.trimEnd()) ?? [""])[0].length;

	return run(source) === 1 && run(text) >= 2;
}

export function hasMtArtifact(source: string, text: string): boolean {
	if (ARTIFACT_TOKENS.test(text)) {
		return true;
	}

	if (doublesTerminator(source, text)) {
		return true;
	}

	for (const entity of text.match(ENTITY) ?? []) {
		if (!source.includes(entity)) {
			return true;
		}
	}

	const body = withoutIdentifiers(text);
	const english = withoutIdentifiers(source);

	for (const character of ["_", "|"]) {
		if (english.includes(character)) {
			continue;
		}

		for (let i = body.indexOf(character); i >= 0; i = body.indexOf(character, i + 1)) {
			const before = body[i - 1];
			const after = body[i + 1];

			if (!/[\p{L}\p{N}]/u.test(before ?? "") || !/[\p{L}\p{N}]/u.test(after ?? "")) {
				return true;
			}
		}
	}

	return false;
}

/**
 * Abbreviations whose full stop ends no sentence. English only: the source
 * is always the pot's English, and only the source is counted strictly.
 */
const SENTENCE_ABBR = /\b(?:e\.g|i\.e|etc|vs)\./giu;

/**
 * A sentence BREAK in the English source: a full stop, bang or question
 * mark with another sentence behind it. Only an internal break counts — a
 * translation that merely drops the final full stop has dropped no copy —
 * and the next sentence has to open with a capital, a digit or a
 * {placeholder}, so `Downloading {model}… {percent}%` is the continuation
 * it looks like rather than two sentences. `…` is never a source break: the
 * pot uses it for progress, not for prose.
 */
const SOURCE_BREAK = /[.!?]+\s+(?=[\p{Lu}\p{N}{])/gu;

/**
 * The same break in an answer, counted generously — the gate is about copy
 * that went missing, so anything a target legitimately breaks a sentence
 * with counts: an ellipsis, a semicolon, the Arabic question mark, the Urdu
 * full stop, and the CJK marks, which take no space after them.
 */
const ANSWER_BREAK = /[.!?…;؟۔]+\s+(?=[\p{L}\p{N}{])|[。！？；]+\s*(?=[\p{L}\p{N}{])/gu;

/**
 * Targets that mark a sentence break with a space rather than with
 * punctuation, so there is nothing here to count. Thai writes no full stop
 * at all; counting terminators there refused 38 sound translations.
 */
const NO_SENTENCE_PUNCTUATION = new Set(["th"]);

/**
 * True when the answer came back with fewer sentences than its English had.
 * A destructive confirmation lost the sentence that said so — de's
 * clear-history dialog kept "Are you sure…?" and dropped "This cannot be
 * undone." — and three more strings dropped "Not reconnecting."; nothing
 * else notices, because what is left is a good translation of what is left.
 */
export function dropsSentences(tag: string, source: string, text: string): boolean {
	if (NO_SENTENCE_PUNCTUATION.has(tag)) {
		return false;
	}

	const wanted = (source.replace(SENTENCE_ABBR, "@").match(SOURCE_BREAK) ?? []).length;

	if (wanted === 0) {
		return false;
	}

	return (text.match(ANSWER_BREAK) ?? []).length < wanted;
}

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

	if (isMispadded(source, text)) {
		return "padding";
	}

	if (hasMtArtifact(source, text)) {
		return "artifact";
	}

	if (isUnchanged(source, text)) {
		return "unchanged";
	}

	// After `unchanged`: an answer that is the English again has every
	// sentence the English had, and reporting it as the echo it is keeps the
	// sweep's counts honest.
	if (dropsSentences(tag, source, text)) {
		return "sentences";
	}

	return isSuspectCatalogEntry(tag, source, text);
}
