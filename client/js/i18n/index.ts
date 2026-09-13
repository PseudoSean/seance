// Vue binding + activation for the i18n runtime: the components' useI18n(),
// the `locale` setting's activate(), and the pre-boot <html lang>/<html dir>
// hand-off with the pre-paint script in client/index.html. The resolver
// itself is the Vue-free core.ts (mocha loads that one, not this file).

import {computed, ref} from "vue";
import {
	bestLocale,
	isRTL,
	resolvableTags,
	setCatalog,
	t as coreT,
	tCount as coreTCount,
	type Catalog,
	type Vars,
} from "./core";
import {AVAILABLE, DEV} from "./available";
import enCatalog from "../../locales/en.json";
import {getBranding} from "../branding";
import {mirrorPushPrefs} from "../push-prefs";

/** Read during every template call, so a locale change re-renders whatever
 * rendered a label. */
export const localeRef = ref("en");

const overlayCache = new Map<string, Catalog>();

async function loadOverlay(tag: string): Promise<Catalog | undefined> {
	if (tag === "en") {
		return undefined;
	}

	if (!overlayCache.has(tag)) {
		// One lazy webpack chunk per locale JSON. Overlay catalogs omit
		// untranslated entries (compile.ts), so missing keys fall to en.
		overlayCache.set(
			tag,
			((await import(`../../locales/${tag}.json`)) as {default: Catalog}).default
		);
	}

	return overlayCache.get(tag);
}

/**
 * Apply the `locale` setting ("auto" or a tag): resolve, load, install,
 * flip <html lang>/<html dir>, mirror to the push worker (it cannot read
 * localStorage). Runs from the setting's apply() at boot and on change.
 */
export async function activate(setting: string): Promise<void> {
	// "auto" never lands on a dev-only locale in a production build; an
	// explicitly stored tag (a dev-forced qqx, say) activates as chosen.
	const tag =
		setting === "auto"
			? bestLocale(navigator.languages ?? [], resolvableTags(AVAILABLE, DEV))
			: setting;
	setCatalog(tag, enCatalog, await loadOverlay(tag));
	localeRef.value = tag;

	const root = document.documentElement;
	root.lang = tag;
	root.dir = isRTL(tag) ? "rtl" : "ltr";

	// The splash is still in the DOM until boot removes it — localize what the
	// reader would otherwise read flash by. Visitors without JavaScript still
	// see English: there is no code to translate it for them.
	for (const [id, key] of [
		["loading-page-message", "loading.requiresJs"],
		["loading-slow", "loading.slow"],
		["loading-reload", "loading.reload"],
	] as const) {
		const node = document.getElementById(id);

		if (node) {
			node.textContent = coreT(key);
		}
	}

	void mirrorPushPrefs({locale: tag});
}

/** `const {t, tCount} = useI18n()` in setup(). Each call reads localeRef so
 * the component re-renders on a language change. */
export function useI18n() {
	const t = (key: string, vars?: Vars): string => {
		void localeRef.value;
		// The deploy's `strings` overrides are its voice (in the deploy's
		// language) and win in every locale — the same rule brandingString()
		// applies for non-Vue callers, in front of the one catalog lookup.
		const override = getBranding().strings?.[key];
		return typeof override === "string" && override.length > 0 ? override : coreT(key, vars);
	};

	const tCount = (key: string, count: number, vars?: Vars): string => {
		void localeRef.value;
		return coreTCount(key, count, vars);
	};

	return {t, tCount, locale: computed(() => localeRef.value)};
}
