/* eslint-disable no-console */
// Empty every filled entry whose {placeholder} braces no longer match its
// msgid (or msgid_plural, for plural entries) — the dynamic-tag casualties
// the model fill produces. The compile refuses a whole catalog for one
// mismatch, so this runs before every compile while the fills are landing.
//
//   npx tsx tools/i18n/sweep.ts [--tags de,fr,...]

import {existsSync, readFileSync, writeFileSync} from "node:fs";
import {pathToFileURL} from "node:url";
import {resolve} from "node:path";
import {parsePo, PoEntry, serializePo} from "./po";
import {NAME_TO_TAG, TARGETS_SOURCE} from "./targets";
import {PLURAL_RULES, parsePluralForms, planPluralSlots, PluralRule} from "./plural";
import {isDegenerate} from "./quality";

const braces = (text: string): string => (text.match(/\{[^{}]*\}/g) ?? []).sort().join("|");

/**
 * Empty every filled msgstr slot whose {placeholder} braces no longer match
 * the English text THAT slot translates. Which text that is comes from
 * planPluralSlots, the same plan fill.ts fills by: the slot n = 1 reads
 * holds the singular, every other slot the plural — and a one-form
 * language's only slot holds the plural too. Checking slot 0 against msgid
 * regardless emptied every one-form plural whose singular has no {count},
 * which the next fill wrote back: a silent fill/sweep loop. Returns how
 * many slots were emptied; the entries are mutated in place.
 */
export function sweepEntries(entries: PoEntry[], rule: PluralRule): number {
	let changed = 0;

	for (const entry of entries) {
		if (!entry.msgstr.some((text) => text)) {
			continue;
		}

		// An empty msgid is a deliberately blank slot (the deploy fills it);
		// a model asked to translate "" only invents text.
		if (!entry.msgid && !entry.msgidPlural) {
			entry.msgstr[0] = "";
			changed += 1;
			continue;
		}

		// Degenerate model output ("~ ~ ~ …") reads as filled but is garbage.
		if (entry.msgstr.some((text) => text && isDegenerate(text))) {
			entry.msgstr = entry.msgstr.map(() => "");
			changed += 1;
			continue;
		}

		if (entry.msgidPlural === undefined) {
			if (entry.msgstr[0] && braces(entry.msgid) !== braces(entry.msgstr[0])) {
				entry.msgstr[0] = "";
				changed += 1;
			}

			continue;
		}

		for (const {index, source} of planPluralSlots(entry, rule.nplurals, rule.expr)) {
			const text = entry.msgstr[index];
			const english = source === "msgid" ? entry.msgid : entry.msgidPlural;

			if (text && braces(english) !== braces(text)) {
				entry.msgstr[index] = "";
				changed += 1;
			}
		}
	}

	return changed;
}

function main(): void {
	const args = process.argv.slice(2);
	const only = args.includes("--tags")
		? args[args.indexOf("--tags") + 1]?.split(",").map((s) => s.trim())
		: null;

	const names = readFileSync(TARGETS_SOURCE, "utf8")
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line !== "" && !line.startsWith("#"));
	const tags = names
		.map((name) => NAME_TO_TAG[name])
		.filter((tag) => tag && tag !== "en" && (!only || only.includes(tag)));

	let swept = 0;

	for (const tag of tags) {
		const path = resolve("client/locales", `${tag}.po`);

		if (!existsSync(path)) {
			continue;
		}

		const po = parsePo(readFileSync(path, "utf8"));
		const rule = PLURAL_RULES[tag] ?? parsePluralForms(po.headers["plural-forms"] ?? "");

		if (!rule) {
			console.warn(`sweep: no plural rule for ${tag} — skipped`);
			continue;
		}

		const changed = sweepEntries(po.entries, rule);

		if (changed) {
			writeFileSync(path, serializePo(po.headers, po.entries));
			console.log(`${tag}: emptied ${changed} placeholder-broken entries`);
			swept += changed;
		}
	}

	console.log(`sweep: ${swept} entries emptied overall`);
}

// Importing this module must not sweep the real catalogs (the toolchain
// test imports sweepEntries).
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
	main();
}
