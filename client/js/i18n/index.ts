// Vue binding + activation for the i18n runtime: the components' useI18n(),
// the `locale` setting's activate(), and the pre-boot <html lang>/<html dir>
// hand-off with the pre-paint script in client/index.html. The resolver
// itself is the Vue-free core.ts (mocha loads that one, not this file).

import {computed, ref} from "vue";
import {bestLocale, isRTL, missingKeys, resolvableTags, setCatalog, type Catalog, type Vars} from "./core";
import {brandingT} from "../branding";
import {AVAILABLE, DEV} from "./available";
import enCatalog from "../../locales/en.json";
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
	// "auto" and any stored tag resolve against this build's list: a
	// production build carries no qqx at all, so a stored qqx pick (a
	// settings restore from a dev machine, say) falls back to the automatic
	// resolution instead of activating the rig.
	let tag =
		setting === "auto" || !resolvableTags(AVAILABLE, DEV).includes(setting)
			? bestLocale(navigator.languages ?? [], resolvableTags(AVAILABLE, DEV))
			: setting;

	// Best-effort, never a rejection: settingsBackup restores the whole
	// settings blob, so a stored tag this build has no compiled catalog for
	// reaches activate() through boot's `void activate()` — a rejecting
	// dynamic import there would cascade. Fall back to en, as the worker's
	// applyLocale() does (client/js/push/i18n.ts).
	try {
		setCatalog(tag, enCatalog, await loadOverlay(tag));
	} catch {
		tag = "en";
		setCatalog("en", enCatalog, undefined);
	}

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
			// The same override-aware resolver the components use: a deploy's
			// `strings` override of a splash key is live, not inert.
			node.textContent = brandingT(key);
		}
	}

	void mirrorPushPrefs({locale: tag});
}

/** `const {t, tCount} = useI18n()` in setup(). Each call reads localeRef so
 * the component re-renders on a language change. Both resolve through the
 * one override-aware helper (brandingT): the deploy's `strings` overrides
 * interpolate their `{var}`s — on flat, var-bearing and plural keys alike —
 * and a key with no override answers from the catalogs exactly as core
 * would. */
export function useI18n() {
	const t = (key: string, vars?: Vars): string => {
		void localeRef.value;
		return brandingT(key, vars);
	};

	const tCount = (key: string, count: number, vars?: Vars): string => {
		void localeRef.value;
		return brandingT(key, vars, count);
	};

	return {t, tCount, locale: computed(() => localeRef.value)};
}

// Development-only console hook: `seanceI18n.t("bogus.key")` in the devtools
// console shows exactly what the missing-key tripwire does (the placeholder
// renders, one console.warn fires), and `seanceI18n.missingKeys()` lists
// every key/var the session has tripped. Production builds (DEV=false)
// never assign it — no hook, no surface, no warnings.
if (DEV) {
	(window as unknown as {seanceI18n?: unknown}).seanceI18n = {
		t: brandingT,
		tCount: (key: string, count: number, vars?: Vars) => brandingT(key, vars, count),
		missingKeys,
	};
}
