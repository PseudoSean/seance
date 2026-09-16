// The translation chips' one accent look (client/css/style.css): the
// detection mark a reader left alone (.msg-translation-skipped-tag inside
// .msg-translation-skipped) and the unchanged-failure chip (the same class
// inside .msg-translation-failed, a fas fa-equals icon) both wear the same
// accent border and ink as .msg-translation-chip, and neither keeps the old
// muted grey or the old 0.75 dim.
//
// No ircd and no engine: the page boots to the connect form, a network is
// fabricated in-page (lib/fake-network.mjs -- the same `init` bus dispatch
// a registration makes) and two entries are committed into
// store.state.translations for two of its rendered messages, one
// detection-skipped and one failed with "came back unchanged". The claims
// are read off the real DOM as computed styles.
//
//   corepack yarn build    (dev build: window.socket is dev-build-only)
//   node tools/browser-drive.mjs tools/scenarios/translation-chips.mjs
//
// The served origin is the dev stack's https://127.0.0.1:8000 (self-signed;
// browser-drive passes --ignore-certificate-errors). Override with SEANCE_BASE.

import {fakeNetworkSnippet} from "./lib/fake-network.mjs";

export const url = `${process.env.SEANCE_BASE || "https://127.0.0.1:8000/"}`;

// The fabricated channel's message ids (fake-network.mjs defaults, baseId
// 0): two of the three rendered rows in #seance.
const SKIPPED_MSG = 21;
const UNCHANGED_MSG = 23;

const INJECT = `(() => {
	const root = document.getElementById("app");
	const store = root && root.__vue_app__ && root.__vue_app__.config.globalProperties.$store;

	if (!store) {
		return false;
	}

	// The shapes reader.ts commits: a detection skip (the reading language
	// was not among the detector's candidates) and the unchanged failure
	// (client/js/translate/outgoing.ts UNCHANGED).
	store.commit("translationEntry", {
		id: ${SKIPPED_MSG},
		entry: {
			status: "skipped",
			text: "",
			from: "de",
			to: "en",
			candidates: ["fr", "nl"],
			engine: null,
			error: null,
			hidden: false,
			reason: "unsure",
		},
	});
	store.commit("translationEntry", {
		id: ${UNCHANGED_MSG},
		entry: {
			status: "failed",
			text: "",
			from: "de",
			to: "en",
			candidates: [],
			engine: null,
			error: "came back unchanged",
			hidden: false,
		},
	});
	return true;
})()`;

/**
 * The two tags and the accent chip as computed styles, or null while any of
 * them is missing. The muted grey the tag used to wear is resolved the way
 * the browser resolves it (a probe element), so the "not muted any more"
 * claim needs no hard-coded rgb string.
 */
const STYLES = `(() => {
	const skipped = document.querySelector(
		"#chat .msg-translation-skipped .msg-translation-skipped-tag"
	);
	const unchanged = document.querySelector(
		"#chat .msg-translation-failed .msg-translation-skipped-tag"
	);
	const chip = document.querySelector("#chat .msg-translation-chip");

	if (!skipped || !unchanged || !chip) {
		return null;
	}

	const probe = document.createElement("span");
	probe.style.color = "var(--body-color-muted)";
	document.body.appendChild(probe);
	const muted = getComputedStyle(probe).color;
	probe.remove();

	const s = getComputedStyle(skipped);
	const u = getComputedStyle(unchanged);
	const c = getComputedStyle(chip);

	return {
		skippedBorder: s.borderTopColor,
		unchangedBorder: u.borderTopColor,
		chipBorder: c.borderTopColor,
		skippedOpacity: s.opacity,
		unchangedOpacity: u.opacity,
		muted,
		chipCount: document.querySelectorAll("#chat .msg-translation-chip").length,
		hasEquals: !!unchanged.querySelector(".fa-equals"),
		unchangedTitle: unchanged.getAttribute("title"),
	};
})()`;

export default async function run(page) {
	await page.goto(page.url, {waitForSelector: "#connect form"});
	page.check("the app booted to the connect form", (await page.count("#connect form")) === 1);

	// Fabricate a connected TestNet with #seance open. window.socket is
	// dev-build-only, so a false here means the build is not a development
	// one and every assertion after this would be about nothing.
	const fabricated = await page.evaluate(fakeNetworkSnippet());
	page.check("a development build fabricated the network", fabricated === true);
	await page.waitFor(`!!document.querySelector("#chat")`, {label: "the chat window"});
	await page.waitFor(`document.querySelectorAll("#chat .msg").length >= 3`, {
		label: "the fabricated channel's messages",
	});

	page.check("the translation entries injected", (await page.evaluate(INJECT)) === true);
	await page.waitFor(`(${STYLES}) !== null`, {
		label: "both chips and the accent chip rendered",
	});

	const s = await page.evaluate(STYLES);
	console.log("chips", JSON.stringify(s, null, 1));

	page.check("exactly one accent chip on the page", s.chipCount === 1);
	page.check(
		"the detection mark's border is the chip's accent border",
		s.skippedBorder === s.chipBorder
	);
	page.check(
		"the unchanged chip's border is the chip's accent border",
		s.unchangedBorder === s.chipBorder
	);
	page.check(
		"neither tag kept the old muted grey",
		s.skippedBorder !== s.muted && s.unchangedBorder !== s.muted
	);
	page.check(
		"the old 0.75 dim is gone from both tags",
		s.skippedOpacity === "1" && s.unchangedOpacity === "1"
	);
	page.check("the unchanged chip is the equals icon", s.hasEquals === true);
	page.check(
		'the unchanged chip is titled "Not translated"',
		s.unchangedTitle === "Not translated"
	);

	await page.screenshot("translation-chips");
	page.check("no console errors", page.consoleErrors.length === 0);
}
