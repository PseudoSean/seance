/**
 * Reader preferences the service worker needs (it cannot read
 * localStorage), mirrored into the IndexedDB store it already uses
 * (seance-push/kv, key "prefs"). Today: whether Markdown renders, so a
 * push notification strips markers exactly when the page does, and the
 * UI language tag (client/js/i18n) for the worker's own copy.
 * Written at boot and on every change (settings.ts apply()).
 */
import {idbGet, idbSet} from "./idb";

export type PushPrefs = {markdown: boolean; locale?: string};

export const PREFS_KEY = "prefs";

export async function mirrorPushPrefs(patch: Partial<PushPrefs>): Promise<void> {
	try {
		const prev = (await idbGet<Partial<PushPrefs>>(PREFS_KEY)) ?? {};
		await idbSet(PREFS_KEY, {...prev, ...patch});
	} catch (error) {
		// No IndexedDB (private mode, quota): the worker uses the default.
	}
}
