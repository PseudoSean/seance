/* eslint-disable no-console -- the dev-only diagnostics in warnOnce() are the
 * one sanctioned console.warn in the i18n runtime; production never reaches
 * it (see the block below). */
// Vue-free catalog resolution — mocha loads this file, so: no Vue, no DOM,
// no storage (test/helpers/i18n.ts). The Vue/activation side lives in
// index.ts; the settings wiring in settings.ts; the pre-paint copy of the
// RTL set in client/index.html is pinned by test/helpers/i18n.ts.

import enCatalog from "../../locales/en.json";

export type Vars = Record<string, string | number>;
export type Catalog = Record<string, string | Record<string, string>>;

// en is the active catalog from the first import: the IRC layer resolves its
// status strings through t() before — and without — the Vue side's
// activate() runs, and under mocha it must resolve real English, not keys.
// setCatalog() replaces this with the chosen locale's overlay on activation.
let catalog: Catalog = enCatalog;
let tag = "en";

/** Tags whose writing systems flow right-to-left. The pre-paint script in
 * client/index.html carries the same list — test/helpers/i18n.ts pins them
 * together. */
export const RTL_TAGS = new Set(["ar", "fa", "he", "ur", "ps", "sd", "ug", "yi", "qqx"]);

const rulesCache = new Map<string, Intl.PluralRules>();

function rulesFor(locale: string): Intl.PluralRules {
	let rules = rulesCache.get(locale);

	if (!rules) {
		rules = new Intl.PluralRules(locale);
		rulesCache.set(locale, rules);
	}

	return rules;
}

// --- dev-only diagnostics -------------------------------------------------
// A build-time scanner (tools/i18n/check.ts) verifies every static t() call
// site against the pot, so a key that goes missing at runtime is by
// construction a dynamically composed one — `t(\`mode.${m}\`)`, a name built
// from data — or a key a refactor left behind. Development builds warn once
// per key (per locale) on the console; production compiles the check away:
// webpack replaces process.env.NODE_ENV, the branch folds, nothing warns or
// throws. setWarnMissing() exists for tests, which run under NODE_ENV=test.

/** Number vars format through the active locale's digits and decimal
 * separator, grouping off — a `{port}` stays 6667, a `{count}` in de stays
 * 1500, Arabic-EG writes ٦٦٦٧. Call sites that want grouping use
 * numbers.ts's formatNumber(). */
const plainNumbers = new Map<string, Intl.NumberFormat>();

function plainNumber(locale: string): Intl.NumberFormat {
	let fmt = plainNumbers.get(locale);

	if (!fmt) {
		fmt = new Intl.NumberFormat(locale, {useGrouping: false});
		plainNumbers.set(locale, fmt);
	}

	return fmt;
}

const DEV_I18N = process.env.NODE_ENV !== "production";
const warned = new Set<string>();

// The keys the active locale's overlay carries — the rest of the en keys
// are UNTRANSLATED in this locale, and development builds say so (see the
// coverage warning in t()/tCount()). en itself has no overlay: nothing is
// untranslated when en is the active locale. The base catalog is whatever
// setCatalog was given as en (the en.json import in the live tree; a
// fixture under test).
const overlayKeys = new Set<string>();
let baseCatalog: Catalog = enCatalog;

let warnEnabled = DEV_I18N;

/** Flip the missing-key/var/coverage warnings (tests; production never runs
 * them). */
export function setWarnMissing(on: boolean): void {
	warnEnabled = on;
}

/** What has been warned about so far (key or template+var ids). A browser
 * scenario sweeps the UI and asserts this stays empty. */
export function missingKeys(): readonly string[] {
	return [...warned];
}

function warnOnce(id: string, message: string): void {
	if (!DEV_I18N || !warnEnabled || warned.has(id)) {
		return;
	}

	warned.add(id);
	console.warn(`[seance i18n] ${message}`);
}

/** The active locale's keys that en has but the overlay does not — the
 * untranslated set. Intentionally-empty en copy (values with nothing in
 * them) is not "untranslated": there is no copy to translate. en active →
 * [] (en is the base catalog). */
export function untranslatedKeys(): string[] {
	if (tag === "en") {
		return [];
	}

	return Object.keys(baseCatalog).filter(
		(key) => !isEmptyEnValue(baseCatalog[key]) && !overlayKeys.has(key)
	);
}

/** True when the key resolves through en rather than the active locale's
 * overlay — the definition of untranslated (and never true for en). */
function isUntranslated(key: string): boolean {
	return tag !== "en" && !overlayKeys.has(key) && !isEmptyEnValue(baseCatalog[key]);
}

function isEmptyEnValue(value: string | Record<string, string> | undefined): boolean {
	return (
		value === "" ||
		(typeof value === "object" && value !== null && Object.keys(value).length === 0)
	);
}

/** Install the active catalog: en overlaid with the locale's entries. */
export function setCatalog(locale: string, en: Catalog, overlay: Catalog | undefined): void {
	tag = locale;
	baseCatalog = en;
	catalog = {...en, ...(overlay ?? {})};
	overlayKeys.clear();

	if (overlay) {
		for (const key of Object.keys(overlay)) {
			overlayKeys.add(key);
		}
	}

	warned.clear(); // a locale change re-derives what is worth warning about
}

export function activeLocale(): string {
	return tag;
}

export function isRTL(locale: string = tag): boolean {
	return RTL_TAGS.has(locale.split("-")[0]);
}

/** `{name}` interpolation; an unknown name stays visible for debugging (a
 * dev-only console.warn names it). A number var is written by the active
 * locale — digits, decimal separator, no grouping. */
export function interpolate(template: string, vars: Vars, label?: string): string {
	return template.replace(/\{(\w+)\}/g, (match, name: string) => {
		if (!Object.prototype.hasOwnProperty.call(vars, name)) {
			warnOnce(
				`${tag}\u0000var\u0000${label ?? template}\u0000${name}`,
				`unknown var {${name}} in ${
					label ? `"${label}"` : JSON.stringify(template)
				} (${tag}) — the placeholder stays visible`
			);
			return match;
		}

		const value = vars[name];
		return typeof value === "number" ? plainNumber(tag).format(value) : String(value);
	});
}

/** A UI label. Unknown keys render as the key itself — check.ts fails first
 * for static call sites; development builds warn (see the diagnostics
 * block) for the dynamic ones. A key the active locale has not translated
 * yet warns too (dev only): the English copy shows, and the warning is how
 * the remaining work names itself while you browse. */
export function t(key: string, vars: Vars = {}): string {
	const entry = catalog[key];

	if (typeof entry !== "string") {
		warnOnce(
			`${tag}\u0000key\u0000${key}`,
			`missing key "${key}" (${tag}) — a dynamically composed key, or one the pot lost`
		);
	} else if (isUntranslated(key)) {
		warnOnce(
			`${tag}\u0000untranslated\u0000${key}`,
			`untranslated in "${tag}": "${key}" — the English copy shows`
		);
	}

	return interpolate(typeof entry === "string" ? entry : key, vars, key);
}

/** A counted label: the entry carries CLDR plural categories from compile.ts. */
export function tCount(key: string, count: number, vars: Vars = {}): string {
	const entry = catalog[key];

	if (typeof entry === "string") {
		if (isUntranslated(key)) {
			warnOnce(
				`${tag}\u0000untranslated\u0000${key}`,
				`untranslated in "${tag}": "${key}" — the English copy shows`
			);
		}

		return interpolate(entry, {...vars, count, n: count}, key);
	}

	if (typeof entry !== "object" || entry === null) {
		warnOnce(
			`${tag}\u0000key\u0000${key}`,
			`missing key "${key}" (${tag}) — a dynamically composed key, or one the pot lost`
		);
		return interpolate(key, {...vars, count, n: count}, key);
	}

	if (isUntranslated(key)) {
		warnOnce(
			`${tag}\u0000untranslated\u0000${key}`,
			`untranslated in "${tag}": "${key}" — the English copy shows`
		);
	}

	const category = rulesFor(tag).select(count);
	const template = entry[category] ?? entry.other ?? Object.values(entry)[0] ?? key;
	return interpolate(template, {...vars, count, n: count}, key);
}

/** Every string the active catalogs can render: singular values and every
 * plural category's text, from the merged catalog. The development string
 * sentinel (sentinel.ts) matches DOM text against these — a label on the
 * screen that none of them produced never passed through t(). */
export function i18nValueTexts(): string[] {
	const texts: string[] = [];

	for (const value of Object.values(catalog)) {
		if (typeof value === "string") {
			texts.push(value);
		} else {
			texts.push(...Object.values(value));
		}
	}

	return texts;
}

/** "auto" resolution: exact tag first, then base language, then en. */
export function bestLocale(preferred: readonly string[], available: readonly string[]): string {
	for (const want of preferred) {
		const exact = available.find((candidate) => candidate.toLowerCase() === want.toLowerCase());

		if (exact) {
			return exact;
		}

		const base = want.split("-")[0].toLowerCase();
		const loose = available.find((candidate) => candidate.toLowerCase() === base);

		if (loose) {
			return loose;
		}
	}

	return "en";
}

/** The tags "auto" may resolve against — and the tags a stored pick may
 * activate (index.ts filters both through this): dev-only locales (the qqx
 * pseudo locale) exist for development testing only, so a production build
 * neither auto-picks, lists nor activates them. */
export function resolvableTags(
	available: ReadonlyArray<{tag: string; devOnly?: boolean}>,
	dev: boolean
): string[] {
	return available.filter((entry) => dev || !("devOnly" in entry)).map((entry) => entry.tag);
}
