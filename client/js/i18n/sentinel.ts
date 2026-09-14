// Development-only DOM sentinel: every string that renders into the
// interface chrome is matched against the catalogs; a label on the screen
// that none of them produced never passed through t() — it was assembled at
// runtime, hardcoded, or glued together — and this names it on the console,
// once per string, in ANY language (the check belongs to the label, not to
// whichever locale happens to be selected).
//
// Deliberate verbatim surfaces are skipped, not excused: everything inside
// #chat (user content and server text, by design — docs/resources/i18n.md
// § What is never translated), form fields, and <select> options (the
// language list renders the languages' own names; theme names are the
// deploy's). Production folds the module away at the webpack define —
// installStringSentinel() is only called under DEV.
//
// Matching is exact against the merged catalog's values, then template-
// shaped: a value containing {vars} becomes a regex with a lazy wildcard
// per placeholder, so an interpolated frame ("Reconnecting to X in 5s…")
// still counts as translated while genuinely unknown text does not.
import {i18nValueTexts, activeLocale} from "./core";

/* eslint-disable no-console -- the sentinel's per-string warning is part of
 * the same sanctioned dev diagnostics family as core.ts's warnOnce. */

export interface DynamicString {
	text: string;
	/** `<tag.class>` of the carrying element, or the attribute slot. */
	where: string;
}

const dynamic: DynamicString[] = [];
const seen = new Set<string>();
let observer: MutationObserver | null = null;
let matchersTag = "";
let exact = new Set<string>();
let shaped: RegExp[] = [];

/** Values with {placeholders} become lazy-wildcard regexes; the rest match
 * exactly. Rebuilt whenever the active locale changes. */
function refreshMatchers(): void {
	const tag = activeLocale();

	if (tag === matchersTag) {
		return;
	}

	matchersTag = tag;
	exact = new Set<string>();
	shaped = [];

	for (const value of i18nValueTexts()) {
		if (!value) {
			continue;
		}

		if (value.includes("{")) {
			shaped.push(
				new RegExp(
					value
						.split(/\{\w+\}/)
						.map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
						.join(".*?"),
					"s"
				)
			);
		}

		exact.add(value);
	}
}

function known(text: string): boolean {
	refreshMatchers();

	if (exact.has(text)) {
		return true;
	}

	return shaped.some((shape) => shape.test(text));
}

/** Pure numbers, times, sigils, spacing: not labels. */
function isLabelShaped(text: string): boolean {
	return /[A-Za-zÀ-ɏЀ-ӿͰ-Ͽ؀-ۿ]/.test(text) && text.trim().length >= 2;
}

function verbatim(node: Node | null): boolean {
	let el = node instanceof Element ? node : node !== null ? node.parentElement : null;

	while (el) {
		if (
			el.id === "chat" ||
			el.closest("input, textarea, select, [contenteditable]") !== null ||
			el.hasAttribute("data-i18n-verbatim")
		) {
			return true;
		}

		el = el.parentElement;
	}

	return false;
}

function describe(node: Node): string {
	const el = node instanceof Element ? node : node.parentElement;

	if (!el) {
		return "";
	}

	const cls = typeof el.className === "string" ? el.className : "";

	return `${el.tagName.toLowerCase()}${cls ? `.${cls.split(" ").join(".")}` : ""}`;
}

function flag(text: string, where: string): void {
	const value = text.trim().replace(/\s+/g, " ");

	if (!isLabelShaped(value) || seen.has(value)) {
		return;
	}

	seen.add(value);

	if (known(value)) {
		return;
	}

	dynamic.push({text: value, where});
	console.warn(
		`[seance i18n] dynamic string outside the catalog: "${value}" (${where}) — it never passed through t()`
	);
}

function scanAdded(node: Node): void {
	if (node.nodeType === Node.TEXT_NODE) {
		if (!verbatim(node)) {
			flag(node.nodeValue ?? "", describe(node));
		}

		return;
	}

	if (node.nodeType !== Node.ELEMENT_NODE) {
		return;
	}

	const el = node as Element;

	if (!verbatim(el)) {
		// alt is exempt: image text on the chrome is the deploy's branding
		// (the logo's alt is the app name) or a content description, never a
		// catalog label. title/placeholder/aria-label are the label slots.
		for (const attr of ["title", "placeholder", "aria-label"]) {
			const value = el.getAttribute(attr);

			if (value) {
				flag(value, `${describe(el)}[${attr}]`);
			}
		}
	}

	for (const child of Array.from(el.childNodes)) {
		scanAdded(child);
	}
}

/** Start watching. Boot gates the call behind DEV, so production bundles
 * drop the module with the rest of the diagnostics. */
export function installStringSentinel(): void {
	if (observer || typeof MutationObserver === "undefined" || !document.body) {
		return;
	}

	observer = new MutationObserver((records) => {
		for (const record of records) {
			if (record.type === "childList") {
				for (const node of record.addedNodes) {
					scanAdded(node);
				}
			} else if (record.type === "characterData" && record.target.parentElement) {
				const node = record.target;

				if (!verbatim(node)) {
					flag(node.nodeValue ?? "", describe(node));
				}
			}
		}
	});

	observer.observe(document.body, {
		childList: true,
		subtree: true,
		characterData: true,
	});
}

/** What the sentinel has flagged so far (window.seanceI18n.dynamic()). */
export function dynamicStrings(): readonly DynamicString[] {
	return dynamic;
}
