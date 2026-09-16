/* eslint-disable no-console */
// Empty every filled entry whose {placeholder} braces no longer match its
// msgid (or msgid_plural, for plural entries) — the dynamic-tag casualties
// the model fill produces. The compile refuses a whole catalog for one
// mismatch, so this runs before every compile while the fills are landing.
//
//   npx tsx tools/i18n/sweep.ts [--tags de,fr,...]

import {existsSync, readFileSync, writeFileSync} from "node:fs";
import {resolve} from "node:path";
import {parsePo, serializePo} from "./po";
import {NAME_TO_TAG, TARGETS_SOURCE} from "./targets";
import {isDegenerate} from "./quality";

const braces = (text: string): string => (text.match(/\{[^{}]*\}/g) ?? []).sort().join("|");

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
		let changed = 0;

		for (const entry of po.entries) {
			if (!entry.msgstr[0]) {
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

			if (braces(entry.msgid) !== braces(entry.msgstr[0])) {
				entry.msgstr[0] = "";
				changed += 1;
			}

			if (entry.msgidPlural && entry.msgstr[1]) {
				if (braces(entry.msgidPlural) !== braces(entry.msgstr[1])) {
					entry.msgstr[1] = "";
					changed += 1;
				}
			}
		}

		if (changed) {
			writeFileSync(path, serializePo(po.headers, po.entries));
			console.log(`${tag}: emptied ${changed} placeholder-broken entries`);
			swept += changed;
		}
	}

	console.log(`sweep: ${swept} entries emptied overall`);
}

main();
