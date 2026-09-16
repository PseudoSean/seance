/* eslint-disable no-console */
// Scaffold client/locales/<tag>.po for every language in
// translation-languages.txt that does not have one yet (Step 2 of the
// localization/translation phase). Each new file carries the full entry set
// of messages.pot with empty msgstr, the standard headers, and the
// language's Plural-Forms from plural-rules.json (the same table compile.ts
// and merge.ts read). Existing .po files are never touched.
//
//   npx tsx tools/i18n/scaffold.ts [--force]
//
// After scaffolding, run `yarn i18n:merge` so the new files are marked for
// translators (entries without a msgstr would compile as the English copy
// anyway), then fill them (tools/i18n/fill.ts).

import {existsSync, readFileSync, writeFileSync} from "node:fs";
import {resolve} from "node:path";
import {parsePo, serializePo} from "./po";
import {PLURAL_RULES, formatPluralForms} from "./plural";
import {NAME_TO_TAG, TARGETS_SOURCE} from "./targets";

const LOCALES = resolve("client/locales");
const POT = resolve(LOCALES, "messages.pot");

function main(): void {
	const force = process.argv.includes("--force");
	const names = readFileSync(TARGETS_SOURCE, "utf8")
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line !== "" && !line.startsWith("#"));

	const pot = parsePo(readFileSync(POT, "utf8"));
	let created = 0;
	let skipped = 0;

	for (const name of names) {
		const tag = NAME_TO_TAG[name];

		if (!tag) {
			console.warn(`scaffold: no tag for "${name}" — skipped (add it to NAME_TO_TAG)`);
			continue;
		}

		const out = resolve(LOCALES, `${tag}.po`);

		// English is compiled from the pot itself — a hand-written en.po is
		// refused by the compile.
		if (tag === "en") {
			continue;
		}

		if (existsSync(out) && !force) {
			skipped += 1;
			continue;
		}

		const rule = PLURAL_RULES[tag];
		// po.ts's serializer reads header values by lowercase key and emits
		// the canonical spellings itself.
		const headers: Record<string, string> = {
			language: tag,
			"mime-version": "1.0",
			"content-type": "text/plain; charset=UTF-8",
			"content-transfer-encoding": "8bit",
			...(rule ? {"plural-forms": formatPluralForms(rule)} : {}),
		};

		const entries = pot.entries.map((entry) => ({
			...entry,
			msgstr: entry.msgidPlural ? ["", ""] : [""],
		}));

		writeFileSync(out, serializePo(headers, entries));
		console.log(`scaffold: ${tag}.po (${entries.length} entries)`);
		created += 1;
	}

	console.log(`scaffold: ${created} created, ${skipped} already present`);
}

main();
