// Vue-free catalog resolution — mocha loads this file, so: no Vue, no DOM,
// no storage (test/helpers/i18n.ts). The Vue/activation side lives in
// index.ts; the settings wiring in settings.ts; the pre-paint copy of the
// RTL set in client/index.html is pinned by test/helpers/i18n.ts.

export type Vars = Record<string, string | number>;
export type Catalog = Record<string, string | Record<string, string>>;

let catalog: Catalog = {};
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

/** Install the active catalog: en overlaid with the locale's entries. */
export function setCatalog(locale: string, en: Catalog, overlay: Catalog | undefined): void {
	tag = locale;
	catalog = {...en, ...(overlay ?? {})};
}

export function activeLocale(): string {
	return tag;
}

export function isRTL(locale: string = tag): boolean {
	return RTL_TAGS.has(locale.split("-")[0]);
}

/** `{name}` interpolation; an unknown name stays visible for debugging. */
export function interpolate(template: string, vars: Vars): string {
	return template.replace(/\{(\w+)\}/g, (match, name: string) =>
		name in vars ? String(vars[name]) : match
	);
}

/** A UI label. Unknown keys render as the key itself — check.ts fails first. */
export function t(key: string, vars: Vars = {}): string {
	const entry = catalog[key];
	return interpolate(typeof entry === "string" ? entry : key, vars);
}

/** A counted label: the entry carries CLDR plural categories from compile.ts. */
export function tCount(key: string, count: number, vars: Vars = {}): string {
	const entry = catalog[key];

	if (typeof entry !== "object" || entry === null) {
		return interpolate(typeof entry === "string" ? entry : key, {...vars, count, n: count});
	}

	const category = rulesFor(tag).select(count);
	const template = entry[category] ?? entry.other ?? Object.values(entry)[0] ?? key;
	return interpolate(template, {...vars, count, n: count});
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
