/* eslint-disable no-console */
// npx tsx tools/i18n/compile.ts [--pseudo]
//
// Compiles the catalogs the runtime loads: client/locales/messages.pot
// becomes en.json (the msgids ARE the English copy), every
// client/locales/<tag>.po becomes <tag>.json, and the qqx pseudo-RTL locale
// is generated from en on every run (Task 10's direction/length/plural test
// rig). Also regenerates client/js/i18n/available.ts and
// client/locales/tags.json, so the build never ships a stale catalog —
// package.json runs this before webpack.
//
// Fuzzy entries are skipped with a stderr warning (the runtime falls back to
// en per key); a translation that lost a {placeholder} the msgid has fails
// the run with the key named. [--pseudo] is accepted for CLI compatibility;
// there is no flag gating — qqx generation is unconditional.

import {mkdirSync, readFileSync, readdirSync, writeFileSync} from "node:fs";
import {dirname, resolve} from "node:path";
import {parsePo, PoEntry} from "./po";
import {PLURAL_RULES, parsePluralForms, PluralRule} from "./plural";
import {pseudo} from "./pseudo";
import {AVAILABLE_PATH, LOCALES_DIR} from "./paths";

/** What the runtime loads: strings, plurals keyed by CLDR category. */
export type Catalog = Record<string, string | Record<string, string>>;

/** One entry of the generated locale list. */
export interface AvailableLocale {
	tag: string;
	devOnly?: boolean;
}

export interface CompileOptions {
	/** Directory holding messages.pot and <tag>.po files. Default client/locales. */
	localesDir?: string;
	/** Where the compiled <tag>.json catalogs are written. Default localesDir. */
	outDir?: string;
	/** Where available.ts is written. Default client/js/i18n/available.ts. */
	availablePath?: string;
	/** Where tags.json is written. Default <localesDir>/tags.json. */
	tagsPath?: string;
}

export interface CompileResult {
	/** Locale tags in generated order: en, the locales, qqx. */
	tags: string[];
	/** tag → catalog, for every file written: en, qqx and each locale. */
	catalogs: Record<string, Catalog>;
	/** The fuzzy-skip warnings (also printed on stderr). */
	warnings: string[];
}

/** gettext's C plural expression, restricted to the arithmetic it allows. */
function pluralEval(expr: string, n: number): number {
	if (!/^[n0-9 ():!=<>+\-*/%&|?:]+$/.test(expr)) {
		throw new Error(`unsafe plural expression: ${expr}`);
	}

	// gettext's C expressions yield 0/1; the JS forms of simple rules ("n != 1")
	// yield booleans, so coerce — the result indexes msgstr[N]. The regex
	// allowlist above is the only thing that reaches here.
	// eslint-disable-next-line @typescript-eslint/no-implied-eval
	return Number(Function("n", `"use strict"; return (${expr});`)(n));
}

const CLDR_CATEGORIES = ["zero", "one", "two", "few", "many", "other"] as const;

/** CLDR category -> gettext msgstr index, probed over n = 0..199. */
function categoryIndexMap(tag: string, expr: string): Record<string, number> {
	const rules = new Intl.PluralRules(tag);
	const probed: Record<string, number> = {};

	for (let n = 0; n <= 199; n++) {
		const category = rules.select(n); // "zero"|"one"|"two"|"few"|"many"|"other"

		if (!(category in probed)) {
			probed[category] = pluralEval(expr, n);
		}
	}

	// Emit in CLDR's canonical order so the compiled JSON reads stably.
	const map: Record<string, number> = {};

	for (const category of CLDR_CATEGORIES) {
		if (category in probed) {
			map[category] = probed[category];
		}
	}

	return map;
}

/** {name} tokens must survive translation — an MT row that ate one is broken. */
function assertPlaceholders(entry: PoEntry): void {
	const tokens = (text: string): string => (text.match(/\{(\w+)\}/g) ?? []).sort().join(",");
	const source = entry.msgidPlural ?? entry.msgid;

	for (const text of entry.msgstr) {
		if (text && tokens(text) !== tokens(source)) {
			throw new Error(
				`compile: ${entry.msgctxt}: placeholder mismatch\n  source: ${tokens(
					source
				)}\n  translation: ${tokens(text)}`
			);
		}
	}
}

/** Entry → compiled value. Untranslated entries compile to "" — no invention. */
function compileEntry(entry: PoEntry, tag: string, expr: string): string | Record<string, string> {
	if (entry.msgidPlural !== undefined) {
		const map = categoryIndexMap(tag, expr);
		const forms: Record<string, string> = {};

		for (const [category, index] of Object.entries(map)) {
			const text = entry.msgstr[index];

			if (text) {
				forms[category] = text;
			}
		}

		return forms;
	}

	return entry.msgstr[0] ?? "";
}

/** A compiled value with nothing in it: an untranslated singular or plural. */
function isEmptyValue(value: string | Record<string, string>): boolean {
	return value === "" || Object.keys(value).length === 0;
}

/** en.json from the pot: msgid/msgid_plural with a fixed en mapping. */
function enCatalogFromPot(entries: PoEntry[]): Catalog {
	const catalog: Catalog = {};

	for (const entry of entries) {
		if (!entry.msgctxt) {
			continue;
		}

		// English's Plural-Forms (n != 1) puts gettext index 0 in CLDR "one"
		// and index 1 in "other", so a fixed mapping is correct for en alone.
		catalog[entry.msgctxt] =
			entry.msgidPlural === undefined
				? entry.msgid
				: {one: entry.msgid, other: entry.msgidPlural};
	}

	return catalog;
}

/** qqx from en: pseudo-translated, one text in every plural category. */
function pseudoCatalogFromEn(en: Catalog): Catalog {
	const catalog: Catalog = {};

	for (const [key, value] of Object.entries(en)) {
		// Empty en values (an intentional empty copy) have nothing to
		// pseudo-translate: leave the key out so en serves it at runtime.
		if (isEmptyValue(value)) {
			continue;
		}

		if (typeof value === "string") {
			catalog[key] = pseudo(value);
			continue;
		}

		// The plural plumbing (category lookup, fallback) is what the rig
		// exercises, so every category carries the same doubled text.
		const same = pseudo(value.one ?? Object.values(value)[0] ?? "");
		const forms: Record<string, string> = {};

		for (const category of Object.keys(value)) {
			forms[category] = same;
		}

		catalog[key] = forms;
	}

	return catalog;
}

function renderAvailable(available: AvailableLocale[]): string {
	// Baked from this run's NODE_ENV: production builds hide the pseudo
	// locale in the selector without any runtime check.
	const dev = `export const DEV = ${process.env.NODE_ENV !== "production"};\n`;

	return (
		"// Generated by tools/i18n/compile.ts — do not edit.\n" +
		`export const AVAILABLE = ${JSON.stringify(available, null, "\t")} as const;\n` +
		'export type AvailableLocale = (typeof AVAILABLE)[number]["tag"];\n' +
		dev
	);
}

export function compileLocales(options: CompileOptions = {}): CompileResult {
	const localesDir = resolve(options.localesDir ?? LOCALES_DIR);
	const outDir = resolve(options.outDir ?? localesDir);
	const availablePath = resolve(options.availablePath ?? AVAILABLE_PATH);
	const tagsPath = resolve(options.tagsPath ?? resolve(localesDir, "tags.json"));
	const warnings: string[] = [];
	const catalogs: Record<string, Catalog> = {};

	// en from the pot — the msgids ARE the English copy.
	const pot = parsePo(readFileSync(resolve(localesDir, "messages.pot"), "utf8"));
	catalogs.en = enCatalogFromPot(pot.entries);

	// qqx from en: the pseudo-RTL rig, generated on every run (Task 10).
	catalogs.qqx = pseudoCatalogFromEn(catalogs.en);

	const poFiles = readdirSync(localesDir)
		.filter((file) => file.endsWith(".po"))
		.sort();
	const localeTags: string[] = [];

	for (const file of poFiles) {
		const tag = file.slice(0, -".po".length);

		// en and qqx are produced from the pot itself — a hand-written file
		// for either tag would be overwritten or listed twice.
		if (tag === "qqx" || tag === "en") {
			throw new Error(
				`compile: ${tag} is compiled from the pot — there is no hand-written ${tag}.po`
			);
		}

		const {headers, entries} = parsePo(readFileSync(resolve(localesDir, file), "utf8"));
		const rule = PLURAL_RULES[tag] ?? parsePluralForms(headers["plural-forms"] ?? "");

		if (!rule) {
			throw new Error(
				`compile: no plural rule for ${tag} — add it to tools/i18n/plural-rules.json`
			);
		}

		const catalog: Catalog = {};

		for (const entry of entries) {
			if (entry.flags.includes("fuzzy")) {
				// gettext convention: a fuzzy entry is not trusted; the runtime
				// falls back to en for its key.
				const warning = `compile: skipping fuzzy ${entry.msgctxt}`;
				warnings.push(warning);
				console.warn(warning);
				continue;
			}

			assertPlaceholders(entry);
			const value = compileEntry(entry, tag, rule.expr);

			// The runtime falls back to en on key ABSENCE, so an entry with
			// nothing compiled must be left out — a present "" (or an empty
			// plural object) would shadow en. en.json itself keeps every pot
			// msgid verbatim, including the intentional empty copies.
			if (!isEmptyValue(value)) {
				catalog[entry.msgctxt] = value;
			}
		}

		catalogs[tag] = catalog;
		localeTags.push(tag);
	}

	const available: AvailableLocale[] = [
		{tag: "en"},
		...localeTags.map((tag) => ({tag})),
		{tag: "qqx", devOnly: true},
	];
	const tags = available.map((entry) => entry.tag);

	mkdirSync(outDir, {recursive: true});

	for (const [tag, catalog] of Object.entries(catalogs)) {
		writeFileSync(resolve(outDir, `${tag}.json`), JSON.stringify(catalog, null, 2) + "\n");
	}

	mkdirSync(dirname(availablePath), {recursive: true});
	writeFileSync(availablePath, renderAvailable(available));
	mkdirSync(dirname(tagsPath), {recursive: true});
	// Bare list for the pre-paint script; webpack.config.ts substitutes it
	// into client/index.html the way it fills __THEME_COLOR__ (Task 3). Both
	// generated files are excluded from prettier — the generator owns their
	// formatting — so regeneration is byte-stable.
	writeFileSync(tagsPath, JSON.stringify(tags, null, "\t") + "\n");

	return {tags, catalogs, warnings};
}

function main(): void {
	// --pseudo is accepted for compatibility with the plan's CLI shape; qqx is
	// generated on every run, so there is nothing to switch on.
	const args = process.argv.slice(2).filter((arg) => arg !== "--pseudo");

	if (args.length > 0) {
		console.error(`compile: unknown argument ${args[0]}`);
		process.exitCode = 1;
		return;
	}

	const result = compileLocales();
	const locales = result.tags.filter((tag) => tag !== "en" && tag !== "qqx");
	console.log(
		`compile: en.json, qqx.json, ${locales.length} locale catalog(s), available.ts, tags.json` +
			(result.warnings.length > 0 ? ` — ${result.warnings.length} fuzzy skipped` : "")
	);
}

if (require.main === module) {
	main();
}
