// The ps theme in a real browser (docs/projects/ps-theme.md): picking it
// in Appearance swaps the stylesheet, the chat root carries the
// conversation's seed, the message area carries the meadow as fourteen
// background layers with every animal slot empty, **the browser fetches no
// animal file at all** — not in a second scene, not as a still under reduced
// motion — a message fades in, sending and reacting show no glitter while the
// reaction still pops in, text keeps its contrast on the sky, and two
// channels grow two different meadows.
//
// The animals are switched off, not removed (client/themes/ps.css, the block
// after the scene table). The network check must stay able to fail: append
// `#chat .header{background-image:var(--ps-horse)}` to the served
// public/themes/ps.css and the run names horse.svg (and horse-still.svg under
// reduced motion) and exits non-zero; append
// `#chat .msg.self:last-child::before{content:"";animation:ps-fade .9s}` and
// the send's glitter check fails too. Both watched failing on 2026-09-24.
//
//   corepack yarn build && python3 -m http.server -d public 8021 &
//   node tools/browser-drive.mjs tools/scenarios/theme-ps.mjs
//
// The default target is a plain-WS ircd on 127.0.0.1:8067 (the dev ircd's
// ws:// port); SEANCE_IRC_PORT overrides the port for a different rig, and
// SEANCE_HTTP_PORT the port the built `public/` is served on — worth setting
// deliberately, since a stale server already squatting on the default serves
// a *different* build and every check below then reports on that one.

const RUN = Date.now().toString(36);
const NICK = `ps${RUN}`;
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
 * milliseconds, too fast for the pending copy — which is where the <3 theme
 * started its send burst — to survive even one CDP round trip. Every other
 * frame passes straight through. Installed once, right after navigation and
 * before the connect form is submitted, so the client's own WebSocket is the
 * shimmed one.
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

/**
 * Every CSS animation that starts inside #chat, pseudo-elements included
 * (`animationstart` carries `pseudoElement`), logged into `window.__animLog`.
 * An event log rather than a poll of computed styles: the reaction's enter
 * class now lives only as long as style.css's 160 ms pop, which a poll across
 * CDP round trips can miss, and a burst on a `::before` is exactly what a
 * poll of the element itself would never see.
 */
const INSTALL_ANIMATION_LOG = `(() => {
	if (window.__animLog) return true;
	window.__animLog = [];
	document.addEventListener(
		"animationstart",
		(e) => {
			const t = e.target;
			if (!(t instanceof Element) || !t.closest("#chat")) return;
			window.__animLog.push({
				name: e.animationName,
				pseudo: e.pseudoElement || "",
				cls: String(t.className),
				reaction: !!t.closest(".msg-reactions"),
			});
		},
		true
	);
	return true;
})()`;

/** One line per logged animation, for a check's label. */
const describeLog = (log) =>
	log.map((e) => `${e.name}${e.pseudo} on .${e.cls.split(/\s+/)[0]}`).join(", ") || "none";

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
 * - `declared`: every `ps/<file>.svg` the theme's stylesheet names anywhere
 *   — the animal tokens, their `-far` tints and the reduced-motion stills.
 *   The files are kept, so this is never empty.
 * - `cast`: the files the open conversation's slots would substitute, read
 *   off the computed `--ps-slot-a/-b/-f` of both `#chat-container` (where the
 *   scene sets them) and the meadow's `.chat` (which paints them).
 * - `painted`: animal files in the meadow's computed `background-image`.
 * - `fetched`: what the browser has actually asked the network for, from
 *   Resource Timing. Background images fetched by CSS appear here like any
 *   other subresource.
 * - `control`: whether Resource Timing is recording this theme's own
 *   subresources at all — the stylesheet and a font from `ps/`. Without it an
 *   empty `fetched` proves nothing (a full buffer, a read before the swap).
 *
 * All of it is read out of the running page rather than written down here:
 * this file has already shipped a hardcoded cast that went stale the moment a
 * scene was recast.
 */
const MEADOW_FILES = `(() => {
	const files = (s) => [...String(s).matchAll(/(?<![a-z])ps\\/([a-z-]+\\.svg)/g)].map((m) => m[1]);
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

	const chat = document.querySelector(
		'#chat .chat-view[data-type="channel"] .chat, #chat .chat-view[data-type="query"] .chat'
	);
	const cast = new Set();

	for (const el of [document.getElementById("chat-container"), chat]) {
		if (!el) continue;
		const cs = getComputedStyle(el);
		for (const slot of ["a", "b", "f"]) {
			for (const f of files(cs.getPropertyValue("--ps-slot-" + slot))) cast.add(f);
		}
	}

	const painted = chat ? files(getComputedStyle(chat).backgroundImage) : [];
	const names = performance.getEntriesByType("resource").map((e) => e.name);
	return {
		declared: [...declared].sort(),
		cast: [...cast].sort(),
		painted: painted.sort(),
		fetched: [...new Set(files(names.join(" ")))].sort(),
		entries: names.length,
		control:
			names.some((n) => /\\/themes\\/ps\\.css(\\?|$)/.test(n)) &&
			names.some((n) => /\\/themes\\/ps\\/[a-z0-9-]+\\.woff2/.test(n)),
	};
})()`;

/** How long after the meadow is painted a background image, had one been
 * substituted, has been requested and has finished on a local server. The
 * falsification in the header is what shows this is long enough. */
const SETTLE_MS = 2500;

/** MEADOW_FILES once the theme's own subresources are on the record and the
 * meadow has had time to request anything it was going to. */
async function meadowFiles(page, label) {
	await page.waitFor(`${MEADOW_FILES}.control`, {label});
	await page.sleep(SETTLE_MS);
	return page.evaluate(MEADOW_FILES);
}

/** Every check that no animal is cast, painted or fetched, at one moment of
 * the run. */
function checkNoAnimals(page, m, where) {
	page.check(
		`${where}: Resource Timing records the theme's stylesheet and fonts (${m.entries} entries)`,
		m.control
	);
	page.check(
		`${where}: the stylesheet still names ${m.declared.length} animal files`,
		m.declared.length > 0
	);
	page.check(
		`${where}: every animal slot is empty${m.cast.length ? ` — ${m.cast.join(" ")}` : ""}`,
		m.cast.length === 0
	);
	page.check(
		`${where}: the meadow paints no animal${
			m.painted.length ? ` — ${m.painted.join(" ")}` : ""
		}`,
		m.painted.length === 0
	);
	page.check(
		`${where}: no animal file was fetched${
			m.fetched.length ? ` — ${m.fetched.join(" ")}` : ""
		}`,
		m.fetched.length === 0
	);
}

export default async function run(page) {
	// A ?host link only pre-fills the connect form (a link is a suggestion,
	// boot.ts handleQueryParams); connect for real.
	await page.goto(page.url, {waitForSelector: "#connect form"});
	// Resource Timing drops entries silently past its default 250, which would
	// let "no animal file was fetched" pass on a busy page; the control in
	// MEADOW_FILES catches that too, this makes it not happen.
	await page.evaluate(`performance.setResourceTimingBufferSize(10000)`);
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

	// Pick the ps theme from Appearance.
	await page.click(`#footer button.settings`);
	await page.waitFor(`document.querySelector(".settings-menu button.appearance")`, {
		label: "settings open",
	});
	await page.click(`.settings-menu button.appearance`);
	await page.waitFor(`document.querySelector("#theme-select")`, {label: "the theme select"});
	// The theme is called ps, shown as "ps"; the ancestor's "ps <3" is gone.
	const options = await page.evaluate(
		`[...document.querySelectorAll("#theme-select option")].map((o) => [o.value, o.textContent.trim()])`
	);
	page.check(
		`the theme list offers ps as "ps" (${JSON.stringify(options.find(([v]) => v === "ps"))})`,
		options.some(([v, text]) => v === "ps" && text === "ps")
	);
	page.check(
		`no theme is called heart or shown as "ps <3" (${options.length} themes)`,
		options.every(([v, text]) => v !== "heart" && !text.includes("<3"))
	);
	// The window's generic @change handler stores the select's value as the
	// setting; a bubbling `change` is what picking an option produces.
	await page.evaluate(
		`(() => {
			const el = document.querySelector("#theme-select");
			el.value = "ps";
			el.dispatchEvent(new Event("change", {bubbles: true}));
		})()`
	);
	await page.sleep(700);
	// Settings is a modal over the whole app: nothing behind its backdrop
	// takes a click, so leave through Done before touching the sidebar.
	await page.click(`.settings-modal-done`);
	await page.waitFor(`!document.querySelector(".settings-modal-done")`, {
		label: "settings closed",
	});
	await page.click(`.channel-list-item[data-name="#seance"]`);
	await page.waitFor(`document.querySelector("#input")`, {label: "back in #seance"});
	await page.sleep(300);

	page.check(
		"the stylesheet is themes/ps.css",
		(await page.evaluate(THEME_HREF)) === "themes/ps.css"
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
	const layers = await page.evaluate(
		`getComputedStyle(document.querySelector('#chat .chat-view[data-type="channel"] .chat')).backgroundSize.split(",").length`
	);
	page.check(`fourteen background layers (${layers})`, layers === 14);

	// The animals are off: every slot empty, nothing painted, and — the part
	// only a browser can say — no animal file requested, although the
	// stylesheet still names all of them. A `url()` sitting in a custom
	// property that no resolved background-image substitutes is never fetched
	// (tools/heart/README.md § Budget and browsers).
	checkNoAnimals(page, await meadowFiles(page, "the theme's subresources recorded"), "#seance");

	const anim = await page.evaluate(
		`getComputedStyle(document.querySelector("#chat .msg")).animationName`
	);
	page.check(`messages fade in (${anim})`, anim.includes("ps-fade"));

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

	// No glitter on a send. The echo of this line is held back by
	// INSTALL_SHIM, so the pending copy — where the <3 theme's burst began —
	// is on screen for a while before the echo replaces it; every animation
	// that starts in #chat meanwhile is logged. The echo's own fade is the
	// control that the log is live.
	await page.evaluate(INSTALL_ANIMATION_LOG);
	await page.evaluate(`window.__animLog.length = 0`);
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
	await page.waitFor(`!document.querySelector("#chat .msg.pending")`, {
		timeout: HOLD_MS + 10000,
		label: "the held-back echo",
	});
	await page.sleep(1500); // the <3 theme's longest burst ran 1.4 s
	const sendLog = await page.evaluate(`window.__animLog.slice()`);
	page.check(
		`the echo fades in (${describeLog(sendLog)})`,
		sendLog.some((e) => e.name === "ps-fade" && !e.pseudo)
	);
	page.check(
		`sending shows no glitter: nothing animates on a pseudo-element`,
		sendLog.every((e) => !e.pseudo)
	);

	// The first reaction on a message enters the whole group
	// (.reactions-enter-active); style.css pops it in over 160 ms, and that
	// pop is every theme's. The pop must still happen, and nothing else.
	await page.evaluate(`window.__animLog.length = 0`);
	await page.evaluate(
		`(() => {
			const i = document.getElementById("input");
			i.value = "/react 💖";
			i.dispatchEvent(new Event("input", {bubbles: true}));
			document.getElementById("form").requestSubmit();
		})()`
	);
	await page.waitFor(`window.__animLog.some((e) => e.name === "reaction-pop")`, {
		timeout: 8000,
		label: "the reaction's pop",
	});
	await page.sleep(1500);
	const reactLog = await page.evaluate(`window.__animLog.slice()`);
	page.check(
		`a reaction still pops in (${describeLog(reactLog)})`,
		reactLog.some((e) => e.name === "reaction-pop" && !e.pseudo)
	);
	page.check(
		`a reaction shows no glitter: nothing on a pseudo-element, only the pop on the reaction`,
		reactLog.every((e) => !e.pseudo && (!e.reaction || e.name === "reaction-pop"))
	);

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

	await page.screenshot("ps-seance");

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

	// A second scene casts other animals in its table; the override empties
	// its slots all the same, so over the whole run nothing has been fetched.
	checkNoAnimals(page, await meadowFiles(page, "#kittens' meadow settled"), "#kittens");
	await page.screenshot("ps-kittens");

	// Reduced motion repoints every animal token at its still. The slots stay
	// empty, so no still is painted or fetched either. The repointing itself
	// is the control that the emulation took: without it this leg would be a
	// second look at the animated tokens.
	await page.send("Emulation.setEmulatedMedia", {
		features: [{name: "prefers-reduced-motion", value: "reduce"}],
	});
	await page.click(`.channel-list-item[data-name="#seance"]`);
	await page.waitFor(`document.querySelector("#input")`, {label: "back in #seance, reduced"});
	const still = await page.evaluate(
		`getComputedStyle(document.documentElement).getPropertyValue("--ps-horse").trim()`
	);
	page.check(
		`reduced motion points the animals at their stills (${still})`,
		/-still\.svg/.test(still)
	);
	checkNoAnimals(page, await meadowFiles(page, "the reduced meadow settled"), "reduced motion");
	await page.screenshot("ps-reduced");
	await page.send("Emulation.setEmulatedMedia", {features: []});

	await page.click(`.channel-list-item[data-type="lobby"]`);
	await page.sleep(300);
	const lobbyScene = await page.evaluate(
		`document.getElementById("chat-container").dataset.scene ?? "none"`
	);
	page.check(`the lobby has no scene (${lobbyScene})`, lobbyScene === "none");

	const oldName = await page.evaluate(
		`/ps\\s*(<|&lt;)3/.test(document.documentElement.outerHTML + document.title)`
	);
	page.check(`the page says "ps <3" nowhere`, oldName === false);

	page.check(`no console errors (${page.consoleErrors.length})`, page.consoleErrors.length === 0);
}
