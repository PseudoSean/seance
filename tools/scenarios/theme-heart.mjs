// The <3 theme in a real browser (docs/projects/heart-theme.md): picking it
// in Appearance swaps the stylesheet, the chat root carries the
// conversation's seed, the message area carries the meadow and its animals
// as fourteen background layers, **the browser fetches the animals the scene
// casts and no others**, a message fades in, an own pending message carries
// its glitter, a reaction bursts on arrival, text keeps its contrast on the
// sky, two channels grow two different meadows, and a screenshot catches one
// of #seance's visitors.
//
//   corepack yarn build && python3 -m http.server -d public 8021 &
//   node tools/browser-drive.mjs tools/scenarios/theme-heart.mjs
//
// The default target is a plain-WS ircd on 127.0.0.1:8067 (the dev ircd's
// ws:// port); SEANCE_IRC_PORT overrides the port for a different rig, and
// SEANCE_HTTP_PORT the port the built `public/` is served on — worth setting
// deliberately, since a stale server already squatting on the default serves
// a *different* build and every check below then reports on that one.

const RUN = Date.now().toString(36);
const NICK = `hb${RUN}`;
const BASE = `http://localhost:${process.env.SEANCE_HTTP_PORT ?? "8021"}/`;
const PORT = process.env.SEANCE_IRC_PORT ?? "8067";

export const url = `${BASE}?host=127.0.0.1&port=${PORT}&tls=false&nick=${NICK}&join=%23seance,%23kittens`;

const THEME_HREF = `document.getElementById("theme").getAttribute("href")`;
const OWN_TEXT = `hello from the meadow ${RUN}`;
/** How long the echo of our own message is held back (see INSTALL_SHIM). */
const HOLD_MS = 1500;

/**
 * Hold back the echo of our own message (tools/scenarios/pending-messages.mjs's
 * technique): a real echo on this rig comes back in a couple of
 * milliseconds, too fast for the pending copy — and the burst that plays
 * while a message is pending — to survive even one CDP round trip. Every
 * other frame passes straight through. Installed once, right after
 * navigation and before the connect form is submitted, so the client's own
 * WebSocket is the shimmed one.
 */
const INSTALL_SHIM = `(() => {
	const Native = WebSocket;
	const slow = new RegExp(${JSON.stringify(`PRIVMSG #seance :${OWN_TEXT}$`)});
	window.WebSocket = class extends Native {
		addEventListener(type, listener, ...rest) {
			if (type !== "message") {
				return super.addEventListener(type, listener, ...rest);
			}
			return super.addEventListener(type, (ev) => {
				if (slow.test(String(ev.data))) {
					setTimeout(() => listener(ev), ${HOLD_MS});
				} else {
					listener(ev);
				}
			}, ...rest);
		}
	};
	return true;
})()`;

/** Colour helpers installed once: any CSS colour (a hex from a custom
 * property, an rgb() from a computed style) resolved through a probe
 * element, then WCAG contrast between two of them. Copied verbatim from
 * tools/scenarios/themes.mjs. */
const INSTALL_CONTRAST = `(() => {
	if (window.__themeCheck) return true;
	const probe = document.createElement("span");
	probe.style.position = "absolute";
	document.body.appendChild(probe);
	const rgb = (value) => {
		probe.style.color = "";
		probe.style.color = value;
		return (getComputedStyle(probe).color.match(/[\\d.]+/g) || []).slice(0, 3).map(Number);
	};
	const lum = (v) =>
		v
			.map((x) => {
				const s = x / 255;
				return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
			})
			.reduce((sum, x, i) => sum + x * [0.2126, 0.7152, 0.0722][i], 0);
	const ratio = (a, b) => {
		const [l, d] = [lum(rgb(a)), lum(rgb(b))].sort((x, y) => y - x);
		return Math.round(((l + 0.05) / (d + 0.05)) * 100) / 100;
	};
	const cs = (sel, prop, pseudo) => {
		const el = document.querySelector(sel);
		return el ? getComputedStyle(el, pseudo || null)[prop] : null;
	};
	const root = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
	window.__themeCheck = {ratio, cs, root};
	return true;
})()`;

/**
 * What the meadow's animal files are doing, from the page's own point of view:
 *
 * - `declared`: every `heart/<file>.svg` the theme's stylesheet names anywhere
 *   — the animal tokens, their `-far` tints and the reduced-motion stills.
 * - `cast`: the files the open conversation's scene actually substitutes into
 *   the three slots, read off the computed `--heart-slot-a/-b/-f`.
 * - `fetched`: what the browser has actually asked the network for, from
 *   Resource Timing. Background images fetched by CSS appear here like any
 *   other subresource.
 *
 * All three are read out of the running page rather than written down here:
 * this file has already shipped a hardcoded cast that went stale the moment a
 * scene was recast.
 */
const MEADOW_FILES = `(() => {
	const files = (s) => [...String(s).matchAll(/heart\\/([a-z-]+\\.svg)/g)].map((m) => m[1]);
	const declared = new Set();

	for (const sheet of document.styleSheets) {
		let rules;
		try {
			rules = sheet.cssRules;
		} catch {
			continue; // a cross-origin sheet; the theme is not one
		}
		for (const rule of rules) for (const f of files(rule.cssText || "")) declared.add(f);
	}

	const cs = getComputedStyle(document.getElementById("chat-container"));
	const cast = new Set();

	for (const slot of ["a", "b", "f"]) {
		for (const f of files(cs.getPropertyValue("--heart-slot-" + slot))) cast.add(f);
	}

	const fetched = new Set(
		files(performance.getEntriesByType("resource").map((e) => e.name).join(" "))
	);
	return {
		declared: [...declared].sort(),
		cast: [...cast].sort(),
		fetched: [...fetched].sort(),
	};
})()`;

/** MEADOW_FILES once the scene's own animals have arrived (they are fetched
 * asynchronously, a moment after the stylesheet swap paints). */
async function meadowFiles(page, label) {
	await page.waitFor(
		`(() => {
			const m = ${MEADOW_FILES};
			return m.cast.length > 0 && m.cast.every((f) => m.fetched.includes(f));
		})()`,
		{label}
	);
	return page.evaluate(MEADOW_FILES);
}

export default async function run(page) {
	// A ?host link only pre-fills the connect form (a link is a suggestion,
	// boot.ts handleQueryParams); connect for real.
	await page.goto(page.url, {waitForSelector: "#connect form"});
	await page.evaluate(INSTALL_SHIM);
	await page.evaluate(`document.querySelector("#connect form").requestSubmit()`);
	await page.waitFor(`document.querySelector('.channel-list-item[data-name="#seance"]')`, {
		timeout: 30000,
		label: "#seance in the sidebar",
	});
	await page.click(`.channel-list-item[data-name="#seance"]`);
	await page.waitFor(`document.querySelector("#input")`, {label: "the input box"});
	await page.waitFor(`document.querySelector("#chat .msg")`, {label: "the join burst"});
	await page.sleep(1000); // let the join burst and the catch-up settle
	await page.evaluate(INSTALL_CONTRAST);

	// Pick the <3 theme from Appearance.
	await page.click(`#footer button.settings`);
	await page.waitFor(`document.querySelector(".settings-menu button.appearance")`, {
		label: "settings open",
	});
	await page.click(`.settings-menu button.appearance`);
	await page.waitFor(`document.querySelector("#theme-select")`, {label: "the theme select"});
	// The window's generic @change handler stores the select's value as the
	// setting; a bubbling `change` is what picking an option produces.
	await page.evaluate(
		`(() => {
			const el = document.querySelector("#theme-select");
			el.value = "heart";
			el.dispatchEvent(new Event("change", {bubbles: true}));
		})()`
	);
	await page.sleep(700);
	await page.click(`.channel-list-item[data-name="#seance"]`);
	await page.waitFor(`document.querySelector("#input")`, {label: "back in #seance"});
	await page.sleep(300);
	// When the meadow's animal layers started animating: each file's visit is
	// timed from its own load, and "heart-visitor" below waits out that clock.
	const meadowSince = Date.now();

	page.check(
		"the stylesheet is themes/heart.css",
		(await page.evaluate(THEME_HREF)) === "themes/heart.css"
	);

	const seedA = await page.evaluate(
		`[document.getElementById("chat-container").dataset.scene, getComputedStyle(document.getElementById("chat-container")).getPropertyValue("--channel-seed").trim()]`
	);
	page.check(
		`#seance carries a scene and a seed (${seedA})`,
		/^[0-5]$/.test(seedA[0]) && /^0\.\d+$/.test(seedA[1])
	);

	const bg = await page.evaluate(
		`getComputedStyle(document.querySelector('#chat .chat-view[data-type="channel"] .chat')).backgroundImage`
	);
	page.check(
		"the message area carries the meadow's layers",
		bg.split("radial-gradient").length >= 5
	);
	page.check(
		"the meadow carries the animals as layers",
		/heart\/(horse|deer|puppy|bunny|kitten|frog|ladybug|bird)(-far)?\.svg/.test(bg)
	);
	const layers = await page.evaluate(
		`getComputedStyle(document.querySelector('#chat .chat-view[data-type="channel"] .chat')).backgroundSize.split(",").length`
	);
	page.check(`fourteen background layers (${layers})`, layers === 14);

	// The whole of the theme's size argument (tools/heart/README.md § Budget
	// and browsers): the directory holds every animal, a scene casts three,
	// and a `url()` sitting in a custom property that no resolved
	// background-image substitutes is never fetched. If that is wrong the
	// budget is wrong, so it is checked here rather than remembered.
	const meadow = await meadowFiles(page, "the scene's animals fetched");
	const seen = new Set(meadow.cast);
	const extra = meadow.fetched.filter((f) => !meadow.cast.includes(f));
	const uncast = meadow.declared.filter((f) => !meadow.cast.includes(f));
	// Two or three: every scene casts two near animals and most a distant
	// visitor, but scene 4's plateau is deliberately empty and a phone drops
	// slot B — so the count is reported, and only the sets below are pinned.
	page.check(
		`the scene casts ${meadow.cast.length} animals (${meadow.cast.join(" ")})`,
		meadow.cast.length >= 2 && meadow.cast.length <= 3
	);
	page.check(
		`${meadow.fetched.length} of the theme's ${meadow.declared.length} animal files were ` +
			`fetched, and they are exactly the cast${
				extra.length ? ` — also ${extra.join(" ")}` : ""
			}`,
		extra.length === 0
	);
	page.check(
		`the ${uncast.length} uncast files were never requested (${uncast.slice(0, 4).join(" ")}${
			uncast.length > 4 ? " …" : ""
		})`,
		uncast.length > 0 && uncast.every((f) => !meadow.fetched.includes(f))
	);

	// A scene sizes its distant visitor as `calc(0.7 * var(--heart-<animal>-h))`
	// — a calc nested inside the slot's own `calc(var(--strip) * …)`. That is
	// valid CSS, but nothing without a browser can confirm it resolves, and a
	// layer that computed to nothing would simply not be painted, in silence.
	// Measure it: the tenth background layer of fourteen is the visitor, and it
	// should be 0.7 of its own animal's token, in strips.
	const visitor = (meadow.cast.find((f) => f.endsWith("-far.svg")) ?? "").replace("-far.svg", "");
	const slotPx = await page.evaluate(
		`(() => {
			const chat = document.querySelector('#chat .chat-view[data-type="channel"] .chat');
			const probe = document.createElement("div");
			probe.style.cssText = "position:absolute;visibility:hidden;height:var(--strip)";
			chat.appendChild(probe);
			const strip = probe.getBoundingClientRect().height;
			probe.remove();
			const token = parseFloat(
				getComputedStyle(document.getElementById("chat-container")).getPropertyValue(
					"--heart-${visitor}-h"
				)
			);
			const sizes = getComputedStyle(chat).backgroundSize.split(",");
			const far = parseFloat(sizes[9].trim().split(/\\s+/).pop());
			return {far, expected: 0.7 * token * strip, token, strip};
		})()`
	);
	page.check(
		`the ${visitor} on the plateau is ${slotPx.far.toFixed(1)}px — 0.7 of its own ` +
			`${slotPx.token} token on a ${slotPx.strip.toFixed(0)}px strip, ` +
			`${slotPx.expected.toFixed(1)}px`,
		slotPx.far > 1 && Math.abs(slotPx.far - slotPx.expected) < 1
	);

	const anim = await page.evaluate(
		`getComputedStyle(document.querySelector("#chat .msg")).animationName`
	);
	page.check(`messages fade in (${anim})`, anim.includes("heart-fade"));

	const timeMetrics = await page.evaluate(
		`(() => {
			const el = document.querySelector("#chat .msg .time");
			const cs = getComputedStyle(el);
			return [el.getBoundingClientRect().height, parseFloat(cs.lineHeight)];
		})()`
	);
	page.check(
		`timestamp is one line (${timeMetrics[0].toFixed(1)}px height, ${timeMetrics[1].toFixed(
			1
		)}px line-height)`,
		timeMetrics[0] < timeMetrics[1] * 1.6
	);

	// The echo of this line is held back by INSTALL_SHIM, so the pending
	// copy (and its burst) stays on screen long enough to read.
	await page.evaluate(
		`(() => {
			const i = document.getElementById("input");
			i.value = ${JSON.stringify(OWN_TEXT)};
			i.dispatchEvent(new Event("input", {bubbles: true}));
			document.getElementById("form").requestSubmit();
		})()`
	);
	await page.waitFor(`document.querySelector("#chat .msg.self.pending")`, {
		label: "the pending own message",
	});
	const burst = await page.evaluate(
		`getComputedStyle(document.querySelector("#chat .msg.self.pending"), "::before").animationName`
	);
	page.check(`an own message bursts (${burst})`, burst.includes("heart-sparkle"));
	await page.waitFor(`!document.querySelector("#chat .msg.pending")`, {
		timeout: HOLD_MS + 10000,
		label: "the held-back echo",
	});

	// The first reaction on a message enters the whole group; the theme
	// bursts on it. The enter class lives 0.9 s (heart-hold), long enough
	// for one round trip — but it can also be gone before a separate poll
	// catches it, so submit and poll in one evaluate (requestAnimationFrame,
	// up to 4 s) rather than a submit followed by a separate page.waitFor.
	const reactionBurst = await page.evaluate(
		`(async () => {
			const i = document.getElementById("input");
			i.value = "/react 💖";
			i.dispatchEvent(new Event("input", {bubbles: true}));
			document.getElementById("form").requestSubmit();
			const deadline = performance.now() + 4000;
			for (;;) {
				const el = document.querySelector(
					"#chat .reactions-enter-active .msg-reaction:not(.msg-reaction-add)"
				);
				if (el) return getComputedStyle(el, "::before").animationName;
				if (performance.now() > deadline) return "none";
				await new Promise(requestAnimationFrame);
			}
		})()`
	);
	page.check(`a reaction bursts (${reactionBurst})`, reactionBurst.includes("heart-sparkle"));

	for (const [label, fg, bg] of [
		[
			"text on sky",
			`getComputedStyle(document.querySelector('#chat .msg[data-type="message"] .content')).color`,
			`getComputedStyle(document.querySelector('#chat .chat-view[data-type="channel"] .chat')).backgroundColor`,
		],
		[
			"timestamp on sky",
			`getComputedStyle(document.querySelector('#chat .msg[data-type="message"] .time')).color`,
			`getComputedStyle(document.querySelector('#chat .chat-view[data-type="channel"] .chat')).backgroundColor`,
		],
	]) {
		const ratio = await page.evaluate(`window.__themeCheck.ratio(${fg}, ${bg})`);
		page.check(`${label} ${ratio}:1 ≥ 4.5`, ratio >= 4.5);
	}

	await page.screenshot("heart-seance");

	// #seance is scene 3: puppy (slot A), frog (slot B), a bunny on the
	// plateau. Each file's visit is timed from when it loaded, and the three
	// windows only overlap between 15 s and 21.9 s — puppy 15–38.4 s, frog
	// 12–25.5 s, bunny-far 8–21.9 s — so wait out that clock rather than a
	// fixed pause, which the checks above may already have outrun.
	const VISITOR_AT = 20000;
	await page.sleep(Math.max(500, VISITOR_AT - (Date.now() - meadowSince)));
	await page.screenshot("heart-visitor");

	await page.click(`.channel-list-item[data-name="#kittens"]`);
	await page.waitFor(`document.querySelector("#input")`, {label: "in #kittens"});
	await page.sleep(300);
	const seedB = await page.evaluate(
		`[document.getElementById("chat-container").dataset.scene, getComputedStyle(document.getElementById("chat-container")).getPropertyValue("--channel-seed").trim()]`
	);
	page.check(
		`#kittens grows a different meadow (${seedB})`,
		seedB[0] !== seedA[0] || seedB[1] !== seedA[1]
	);

	// A second scene adds its own cast and nothing else: over the whole run
	// the browser has fetched the union of the conversations opened, never
	// the directory.
	const meadowB = await meadowFiles(page, "#kittens' animals fetched");

	for (const f of meadowB.cast) {
		seen.add(f);
	}

	const union = [...seen].sort();
	page.check(
		`two scenes have fetched ${meadowB.fetched.length} files, the union of their casts ` +
			`(${union.join(" ")})`,
		meadowB.fetched.join(" ") === union.join(" ")
	);
	await page.screenshot("heart-kittens");

	await page.click(`.channel-list-item[data-type="lobby"]`);
	await page.sleep(300);
	const lobbyScene = await page.evaluate(
		`document.getElementById("chat-container").dataset.scene ?? "none"`
	);
	page.check(`the lobby has no scene (${lobbyScene})`, lobbyScene === "none");

	page.check(`no console errors (${page.consoleErrors.length})`, page.consoleErrors.length === 0);
}
