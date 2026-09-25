// The ps theme in a real browser (docs/projects/ps-theme.md §12). Picking it
// in Appearance swaps the stylesheet and mounts the scene behind the whole
// app — sky, sun, moon and 190 stars (client/js/scenes/ps/scene.ts, through
// the hook in client/js/themeScene.ts). The run then:
//
// - reads the type: all nine font files (Mulish upright and italic, Fraunces;
//   Latin, Latin Extended and Vietnamese each) loaded, each drawing its text
//   rather than leaving it to the fallback (the latin-ext trap, ps-theme.md
//   §8) — the canvas widths the fonts were bundled with, and the fonts
//   Chromium reports it drew the neighbour's italic join, its Latin Extended
//   realname and line, a Latin Extended query name, and a Vietnamese name
//   upright, in italic and as a query in;
// - walks the clock with a time-zone override — noon, 22:00, midnight and
//   dusk (about 45 minutes after today's sunset) — and reads what the scene
//   publishes on <html>: the light (day/night), the text over the plains
//   (ink by day, white from dusk), the canvas colour, and the real colour of
//   another user's message;
// - reads the chrome (§6): the sidebar, header, user list and composer are
//   glass — a blur over the day tint at noon, the night tint at 22:00 — and
//   #status-bar-tint never blurs; the send glyph is the generated text
//   accent; at 22:00 the idle channel names are the night soft ink and the
//   open one the night ink; under reduced transparency the glass turns solid
//   (a SKIP line, never a pass, where Chromium cannot emulate it); and the
//   browser's theme-color is the sky's canvas, coffee's own colour after a
//   switch, and the sky again after the switch back;
// - hides and shows the page: the scene stops (its class, its SVG clocks and
//   every CSS animation in it) and starts again, stays stopped under reduced
//   motion, and a scene mounted into a hidden page starts stopped;
// - follows the open conversation: channel, query, none (Settings);
// - switches to coffee (the scene goes and leaves nothing on <html>) and
//   back to ps (one scene again, not two);
// - on a phone: the glass unblurred on the generated tint (the measured
//   budget's fallback, ps-theme.md §10), the header and composer at noon,
//   and at night the open drawer, on top of the scrim, not under it;
// - and last blocks the scene's chunk and reloads: the daylight fallback
//   stays, ink over it, and the console complains of the blocked request and
//   nothing else — the hook's one warning, naming it.
//
// Along the way it keeps the older promises: **the browser fetches no animal
// file at all** — not in #seance, not in #kittens, not as a still under
// reduced motion — though the stylesheet still names every one; a message
// fades in; sending and reacting show no glitter while the reaction still
// pops in; the timestamp stays one line; nothing says "ps <3".
//
// The animals are switched off, not removed (client/themes/ps.css, the block
// after `#theme-scene .ps-animals`). The checks must stay able to fail, and
// were watched failing on 2026-09-24 against a served public/themes/ps.css
// with rules appended (rebuild to restore it). One run appended both of
// - `#theme-scene .ps-animals{--ps-slot-a:var(--ps-horse)!important}` — the
//   layer paints and fetches horse.svg (horse-still.svg under reduced
//   motion) and every animal check names it;
// - `#chat .msg.self:last-child::before{content:"";animation:ps-fade .9s}` —
//   the send's glitter check fails;
// and another, on its own because a hidden scene fetches nothing,
// - `#theme-scene{display:none!important}` — the mount check, the switch
//   back to ps and the fallback check fail (and every "the scene runs", a
//   hidden element having no animations).
// The chrome's checks were watched failing on 2026-09-25 the same way, with
// - `#sidebar{backdrop-filter:none!important}` — the sidebar's glass checks
//   fail, at noon and at 22:00 (the phone's glass has had no filter since
//   the budget's fallback, 2026-09-25, so its checks read it unblurred).
//
//   NODE_ENV=production corepack yarn build && python3 -m http.server -d public 8021 &
//   node tools/browser-drive.mjs tools/scenarios/theme-ps.mjs
//
// A development build works too: its i18n tripwire ("[seance i18n] …"
// console warnings, compiled out of production) is one of the two kinds of
// line the fallback check sets aside by name (NOT_THE_SCENE).
//
// The default target is a plain-WS ircd on 127.0.0.1:8067 (the dev ircd's
// ws:// port); SEANCE_IRC_PORT overrides the port for a different rig, and
// SEANCE_HTTP_PORT the port the built `public/` is served on — worth setting
// deliberately, since a stale server already squatting on the default serves
// a *different* build and every check below then reports on that one.

const RUN = Date.now().toString(36);
const NICK = `ps${RUN}`;
/** The neighbour (see `neighbour`). */
const PEER = `${NICK}n`;
/**
 * A name in Latin Extended, for the fonts' second files (the latin-ext trap:
 * a face can load and still draw in the fallback). The ircd refuses it as a
 * nick (432 Erroneous Nickname), so the neighbour carries it as its realname,
 * which its join shows in italic, and says it in its line (upright); and a
 * query of that name puts it in Fraunces in the sidebar.
 */
const EXT_NAME = "Łucja";
/**
 * A Vietnamese name, for the fonts' third files: ễ (U+1EC5) is in neither the
 * Latin nor the Latin Extended file, so without the vietnamese subset the
 * name drew partly in the fallback. The neighbour says it upright and in
 * italic (IRC's ^], U+001D), and a query of that name sets it in Fraunces.
 */
const VI_NAME = "Nguyễn";
const BASE = `http://localhost:${process.env.SEANCE_HTTP_PORT ?? "8021"}/`;
const PORT = process.env.SEANCE_IRC_PORT ?? "8067";

export const url = `${BASE}?host=127.0.0.1&port=${PORT}&tls=false&nick=${NICK}&join=%23seance,%23kittens`;

const THEME_HREF = `document.getElementById("theme").getAttribute("href")`;
const OWN_TEXT = `hello from the plains ${RUN}`;
/** How long the echo of our own message is held back (see INSTALL_SHIM). */
const HOLD_MS = 1500;
/** The message text colour by day (ps.css `--chat-fg`, #1b2638) and from dusk. */
const INK = "rgb(27, 38, 56)";
const WHITE = "rgb(255, 255, 255)";
/** The daylight fallback's sky top (ps.css, `#theme-scene`), #3f8fe6. */
const FALLBACK_SKY = "rgb(63, 143, 230)";
/** What the hook warns when a scene's chunk does not load (themeScene.ts). */
const HOOK_WARNING = "The ps theme's scene did not load; its daylight fallback stays.";
/**
 * Console lines the fallback check sets aside by name, because they are the
 * rig's and not the scene's: a development build's i18n tripwire (compiled
 * out of production), and a GPU-less browser's answer to the translation
 * feature's WebGPU probe (client/js/translate/capability.ts), which runs
 * when a channel opens.
 */
const NOT_THE_SCENE = [
	/^warning \[seance i18n\] /,
	/^warning \[rendering\] No available adapters\. /,
];

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

/**
 * What the animal files are doing, from the page's own point of view:
 *
 * - `declared`: every `ps/<file>.svg` the theme's stylesheet names anywhere
 *   — the animal tokens, their `-far` tints and the reduced-motion stills.
 *   The files are kept, so this is never empty.
 * - `layer`/`image`: the scene's animal layer (`#theme-scene .ps-animals`)
 *   and its computed `background-image`, which is three slots.
 * - `cast`: the files the layer's slots would substitute, read off its
 *   computed `--ps-slot-a/-b/-f`.
 * - `painted`: animal files in that `background-image`.
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
const ANIMAL_FILES = `(() => {
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

	const layer = document.querySelector("#theme-scene .ps-animals");
	const cs = layer ? getComputedStyle(layer) : null;
	const cast = new Set();

	for (const slot of ["a", "b", "f"]) {
		for (const f of files(cs ? cs.getPropertyValue("--ps-slot-" + slot) : "")) cast.add(f);
	}

	const image = cs ? cs.backgroundImage : null;
	const names = performance.getEntriesByType("resource").map((e) => e.name);
	return {
		declared: [...declared].sort(),
		layer: !!layer,
		image,
		cast: [...cast].sort(),
		painted: files(image || "").sort(),
		fetched: [...new Set(files(names.join(" ")))].sort(),
		entries: names.length,
		control:
			names.some((n) => /\\/themes\\/ps\\.css(\\?|$)/.test(n)) &&
			names.some((n) => /\\/themes\\/ps\\/[a-z0-9-]+\\.woff2/.test(n)),
	};
})()`;

/** How long after the scene is painted a background image, had one been
 * substituted, has been requested and has finished on a local server. The
 * falsification in the header is what shows this is long enough. */
const SETTLE_MS = 2500;

/** ANIMAL_FILES once the theme's own subresources are on the record and the
 * scene has had time to request anything it was going to. */
async function animalFiles(page, label) {
	await page.waitFor(`${ANIMAL_FILES}.control`, {label});
	await page.sleep(SETTLE_MS);
	return page.evaluate(ANIMAL_FILES);
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
	page.check(`${where}: the scene has its animal layer`, m.layer);
	page.check(
		`${where}: the animal layer paints three empty slots (${m.image})`,
		m.image === "none, none, none"
	);
	page.check(
		`${where}: every animal slot is empty${m.cast.length ? ` — ${m.cast.join(" ")}` : ""}`,
		m.layer && m.cast.length === 0
	);
	page.check(
		`${where}: the layer paints no animal${
			m.painted.length ? ` — ${m.painted.join(" ")}` : ""
		}`,
		m.layer && m.painted.length === 0
	);
	page.check(
		`${where}: no animal file was fetched${
			m.fetched.length ? ` — ${m.fetched.join(" ")}` : ""
		}`,
		m.fetched.length === 0
	);
}

/** The IANA zone whose local hour is `hour` right now: Etc/GMT-N is UTC+N. */
function zoneFor(hour) {
	let off = (((hour - new Date().getUTCHours()) % 24) + 24) % 24;
	if (off > 14) off -= 24;
	return off === 0 ? "Etc/GMT" : off > 0 ? `Etc/GMT-${off}` : `Etc/GMT+${-off}`;
}

/**
 * Sunrise and sunset in local minutes on a day of the year, copied from
 * client/js/scenes/ps/engine.ts `sunTimes` with its LATITUDE (45) and
 * SOLAR_NOON (750): this file runs under plain node and cannot import
 * TypeScript. Keep the two in step.
 */
function sunTimes(doy) {
	const RAD = Math.PI / 180;
	const decl = -23.44 * Math.cos((2 * Math.PI * (doy + 10)) / 365) * RAD;
	const cosH = -Math.tan(45 * RAD) * Math.tan(decl);
	const hourAngle = Math.acos(Math.max(-1, Math.min(1, cosH))) / RAD;
	const half = (hourAngle / 15) * 60;
	return {rise: 750 - half, set: 750 + half};
}

/** engine.ts DUSK: how long after sunset the dusk stops run. */
const DUSK = 105;

/** engine.ts `dayOfYear`: 1 on 1 January of the local calendar date. */
const dayOfYear = (d) =>
	(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(d.getFullYear(), 0, 0)) /
	86400000;

const hhmm = (minute) =>
	`${String(Math.floor(minute / 60) % 24).padStart(2, "0")}:${String(
		Math.floor(minute % 60)
	).padStart(2, "0")}`;

/**
 * Someone else in #seance: a bare IRC connection from node (Node 22's global
 * WebSocket, one line per frame, as tools/irc-ws-probe.mjs speaks it), so the
 * message column has another user's line to read the text colour off — our
 * own lines are dimmed by style.css's `.self` rule, and the rig keeps no
 * history of a channel nobody is in. Its realname, when it differs from the
 * nick, is shown in its join (extended-join), in italic.
 */
async function neighbour(nick, realname = nick) {
	const ws = new WebSocket(`ws://127.0.0.1:${PORT}/`, ["text.ircv3.net"]);
	ws.binaryType = "arraybuffer";
	const text = (data) => (typeof data === "string" ? data : new TextDecoder().decode(data));
	await new Promise((resolve, reject) => {
		ws.onopen = resolve;
		ws.onerror = () => reject(new Error(`the neighbour ${nick} could not connect`));
	});
	await new Promise((resolve, reject) => {
		const timer = setTimeout(
			() => reject(new Error(`the neighbour ${nick} did not register`)),
			15000
		);
		ws.onmessage = (ev) => {
			const line = text(ev.data);

			if (line.startsWith("PING ")) {
				ws.send(`PONG ${line.slice(5)}`);
			} else if (/^:\S+ 001 /.test(line)) {
				clearTimeout(timer);
				resolve();
			}
		};
		ws.send(`NICK ${nick}`);
		ws.send(`USER ${nick} 0 * :${realname}`);
	});
	ws.send("JOIN #seance");
	return {
		say: (line) => ws.send(`PRIVMSG #seance :${line}`),
		quit: () => {
			ws.send("QUIT");
			ws.close();
		},
	};
}

/** Wait, without failing the run, for `expression` to hold; says whether it did. */
async function settle(page, expression, ms) {
	for (const until = Date.now() + ms; Date.now() < until; ) {
		if (await page.evaluate(`!!(${expression})`)) {
			return true;
		}

		await page.sleep(150);
	}

	return page.evaluate(`!!(${expression})`);
}

/** Someone else's message line in the open conversation. */
const OTHERS_LINE = `document.querySelector('#chat .chat .msg[data-type="message"]:not(.self) .content')`;

/** Make the page believe it was hidden or shown, and tell it. */
const VISIBILITY = (state) => `(() => {
	Object.defineProperty(document, "visibilityState", {configurable: true, get: () => ${JSON.stringify(
		state
	)}});
	Object.defineProperty(document, "hidden", {configurable: true, get: () => ${state === "hidden"}});
	document.dispatchEvent(new Event("visibilitychange"));
})()`;

/**
 * The scene and what it publishes, in one read. `ink` is the colour of
 * someone else's message text (the neighbour's), null when there is none;
 * `running` counts the CSS animations in the scene that are playing; `meta`
 * is the browser's theme-color; the clock is the page's own, under whatever
 * time zone is emulated.
 */
const SCENE_STATE = `(() => {
	const s = document.getElementById("theme-scene"), h = document.documentElement;
	const content = ${OTHERS_LINE};
	const d = new Date();
	return {
		display: getComputedStyle(s).display,
		background: getComputedStyle(s).backgroundImage,
		children: s.children.length,
		starFields: s.querySelectorAll(".ps-stars").length,
		stars: s.querySelectorAll(".ps-stars i").length,
		sun: !!s.querySelector(".ps-sun"),
		moon: !!s.querySelector(".ps-moon"),
		paused: s.classList.contains("ps-paused"),
		svgPaused: [...s.querySelectorAll("svg")].map((v) => v.animationsPaused()),
		running: s.getAnimations({subtree: true}).filter((a) => a.playState === "running").length,
		view: s.dataset.view,
		light: h.dataset.psLight,
		text: h.dataset.psText,
		canvas: h.style.getPropertyValue("--canvas-bg-color"),
		skyTop: s.style.getPropertyValue("--ps-sky-top"),
		meta: document.querySelector('meta[name="theme-color"]').content,
		ink: content ? getComputedStyle(content).color : null,
		minute: d.getHours() * 60 + d.getMinutes(),
		doy: (Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(d.getFullYear(), 0, 0)) / 86400000,
	};
})()`;

/** `.msg` eases its colour over 0.8 s (ps.css, the words over the plains). */
const TEXT_EASE_MS = 1200;

/** Emulate the local hour `hour`, then hide and show the page: the scene
 * ticks at once on becoming visible. */
async function atHour(page, hour) {
	await page.send("Emulation.setTimezoneOverride", {timezoneId: zoneFor(hour)});
	await page.evaluate(VISIBILITY("hidden"));
	await page.evaluate(VISIBILITY("visible"));
	await page.sleep(TEXT_EASE_MS);
	return page.evaluate(SCENE_STATE);
}

/** The scene is stopped: its class, both SVG clocks and every CSS animation. */
function checkStopped(page, s, where) {
	page.check(
		`${where}: the scene is stopped (ps-paused ${s.paused}, SVG clocks ${JSON.stringify(
			s.svgPaused
		)}, ${s.running} CSS animations running)`,
		s.paused && s.svgPaused.length === 2 && s.svgPaused.every(Boolean) && s.running === 0
	);
}

/** The scene runs: no pause class, both SVG clocks going, CSS animations playing. */
function checkRunning(page, s, where) {
	page.check(
		`${where}: the scene runs (ps-paused ${s.paused}, SVG clocks ${JSON.stringify(
			s.svgPaused
		)}, ${s.running} CSS animations running)`,
		!s.paused && s.svgPaused.length === 2 && s.svgPaused.every((p) => !p) && s.running > 0
	);
}

/** One scene, whole: shown, six layers, one field of 190 stars, a sun and a moon. */
function checkMounted(page, s, where) {
	page.check(
		`${where}: the scene is mounted and shown (display ${s.display}, ${s.children} layers, ` +
			`${s.starFields} star field of ${s.stars}, sun ${s.sun}, moon ${s.moon})`,
		s.display === "block" &&
			s.children === 6 &&
			s.starFields === 1 &&
			s.stars === 190 &&
			s.sun &&
			s.moon
	);
}

/** The neighbour's join line, shown on its own (not condensed). */
const PEER_JOIN = `#chat .msg[data-type="join"][data-from="${PEER}"]`;
/** The query named EXT_NAME in the sidebar. */
const EXT_QUERY_ROW = `.channel-list-item[data-type="query"][data-name="${EXT_NAME}"]`;
/** The query named VI_NAME in the sidebar. */
const VI_QUERY_ROW = `.channel-list-item[data-type="query"][data-name="${VI_NAME}"]`;
/** The neighbour's lines. */
const PEER_LINES = `#chat .msg[data-type="message"][data-from="${PEER}"] .content`;

/**
 * The theme's nine font files as `document.fonts` has them: family, style,
 * which block (Latin, U+0000-00FF first; Latin Extended, U+0100-02BA first;
 * Vietnamese, U+0102-0103 first) and status.
 */
const FONT_FACES = `[...document.fonts]
	.filter((f) => /^"?(Mulish|Fraunces)"?$/.test(f.family))
	.map((f) => {
		const first = f.unicodeRange.split(",")[0].trim();
		return {
			family: f.family.replace(/"/g, ""),
			style: f.style,
			block: /^U\\+0+-0*FF$/i.test(first)
				? "latin"
				: /^U\\+0*100-/i.test(first)
				? "latin-ext"
				: /^U\\+0*102-/i.test(first)
				? "vietnamese"
				: first,
			status: f.status,
		};
	})`;

/**
 * The rendered proof the fonts were bundled with (the latin-ext trap,
 * docs/projects/ps-theme.md §8), as it was first run: each face against a
 * fallback the same text would otherwise draw in, on a canvas. A pair of
 * equal widths means the bundled face did not draw the text.
 */
const FONT_WIDTHS = `(async () => {
	await document.fonts.ready;
	const c = document.createElement("canvas").getContext("2d");
	const w = (font, s) => ((c.font = font), c.measureText(s).width);
	const probe = {latin: "Handgloves 0123", ext: "Łucja Ősz ăĕ şţ"};
	return {
		mulish: [w("500 20px Mulish", probe.latin), w("500 20px serif", probe.latin)],
		mulishExt: [w("500 20px Mulish", probe.ext), w("500 20px serif", probe.ext)],
		mulishItalic: [w("italic 500 20px Mulish", probe.ext), w("italic 500 20px serif", probe.ext)],
		fraunces: [w("700 20px Fraunces", probe.latin), w("700 20px monospace", probe.latin)],
		frauncesExt: [w("700 20px Fraunces", probe.ext), w("700 20px monospace", probe.ext)],
	};
})()`;

/** The element whose own text (a direct text child) first contains
 * `needle`, under the elements `scope` selects; null when there is none. */
const TEXT_HOLDER = (scope, needle) => `(() => {
	for (const root of document.querySelectorAll(${JSON.stringify(scope)})) {
		const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
		for (let n = walk.nextNode(); n; n = walk.nextNode()) {
			if (n.data.includes(${JSON.stringify(needle)})) return n.parentElement;
		}
	}
	return null;
})()`;

/**
 * The fonts Chromium drew an element's own text in (CSS.getPlatformFontsForNode,
 * which counts the element's direct text children): `document.fonts` can say
 * a face has loaded while these glyphs went to the fallback, which shows here.
 * Needs the DOM and CSS domains enabled; null when `expression` finds nothing.
 */
async function drawnFonts(page, expression) {
	const {result} = await page.send("Runtime.evaluate", {expression, returnByValue: false});

	if (!result.objectId) {
		return null;
	}

	const {nodeId} = await page.send("DOM.requestNode", {objectId: result.objectId});
	const {fonts} = await page.send("CSS.getPlatformFontsForNode", {nodeId});
	return fonts;
}

const describeFonts = (fonts) =>
	fonts
		? fonts
				.map(
					(f) =>
						`${f.familyName} ${f.postScriptName}${f.isCustomFont ? "" : " (system)"} ×${
							f.glyphCount
						}`
				)
				.join(", ")
		: "nothing";

/**
 * Some text of the page is set in the family `family` (italic or not), and
 * drawn by that bundled face: its computed style says so, and so does every
 * font Chromium drew it in. A missing italic file would draw the upright one
 * slanted, whose name says no italic.
 */
async function checkDrawnIn(page, label, holder, family, italic) {
	const css = await page.evaluate(`(() => {
		const e = ${holder};
		if (!e) return null;
		const cs = getComputedStyle(e);
		return {style: cs.fontStyle, family: cs.fontFamily};
	})()`);
	const fonts = await drawnFonts(page, holder);
	const re = new RegExp(`^${family}\\b`);
	page.check(
		`fonts: ${label} (font-style ${css?.style}, font-family ${
			css?.family
		}; drawn in ${describeFonts(fonts)})`,
		css !== null &&
			css.style === (italic ? "italic" : "normal") &&
			re.test(css.family) &&
			fonts !== null &&
			fonts.length > 0 &&
			fonts.every(
				(f) =>
					f.isCustomFont &&
					re.test(f.familyName) &&
					/italic/i.test(f.postScriptName) === italic
			)
	);
}

/** The chrome's glass surfaces (docs/projects/ps-theme.md §6). */
const GLASS = ["#sidebar", "#chat .header", "#chat .userlist", "#form"];
/** The glass tints' colours, day and night (ps.css, the chrome section). */
const DAY_GLASS = "255, 251, 244";
const NIGHT_GLASS = "12, 17, 32";

/**
 * The chrome in one read: each glass surface's background and backdrop
 * filter, #status-bar-tint's, whether reduced transparency is in force, and
 * the send glyph's colour beside the generated text accent it should be.
 */
const CHROME = `(() => {
	const read = (el) => {
		if (!el) return null;
		const cs = getComputedStyle(el);
		return {bg: cs.backgroundColor, blur: cs.backdropFilter};
	};
	return {
		glass: Object.fromEntries(${JSON.stringify(
			GLASS
		)}.map((s) => [s, read(document.querySelector(s))])),
		tint: read(document.getElementById("status-bar-tint")),
		reducedTransparency: matchMedia("(prefers-reduced-transparency: reduce)").matches,
		accent: getComputedStyle(document.getElementById("form")).getPropertyValue("--ps-g-accent-text").trim(),
		send: getComputedStyle(document.querySelector("#form #submit"), "::before").color,
	};
})()`;

/** `rgb(r, g, b)` / `rgba(r, g, b, a)` as {rgb: "r, g, b", a}; null otherwise. */
function rgba(s) {
	const m = /^rgba?\((\d+), (\d+), (\d+)(?:, ([\d.]+))?\)$/.exec(s ?? "");
	return m ? {rgb: `${m[1]}, ${m[2]}, ${m[3]}`, a: m[4] === undefined ? 1 : Number(m[4])} : null;
}

/** `#rrggbb` as the `rgb(r, g, b)` a computed colour is written in. */
function hexRgb(hex) {
	const m = /^#([0-9a-f]{6})$/i.exec(hex);

	if (!m) {
		return `not a #rrggbb colour: ${hex}`;
	}

	const n = parseInt(m[1], 16);
	return `rgb(${n >> 16}, ${(n >> 8) & 255}, ${n & 255})`;
}

/** Glass: a blur, over a tint of `rgb` that lets the plains through. */
function isGlass(surface, rgb) {
	const c = rgba(surface?.bg);
	return !!c && c.rgb === rgb && c.a < 1 && /blur\(/.test(surface.blur);
}

/** The phone's glass: the `rgb` tint at `alpha`, with no backdrop filter. */
function isUnblurredTint(surface, rgb, alpha) {
	const c = rgba(surface?.bg);
	return !!c && c.rgb === rgb && Math.abs(c.a - alpha) < 0.005 && surface.blur === "none";
}

/** Every glass surface is glass of the `rgb` tint. */
function checkGlass(page, chrome, where, rgb) {
	for (const selector of GLASS) {
		const s = chrome.glass[selector];
		page.check(
			`${where}: ${selector} is glass over rgb(${rgb}) (${
				s ? `${s.bg}, ${s.blur}` : "missing"
			})`,
			isGlass(s, rgb)
		);
	}
}

/** The send glyph is the generated text accent (ps.css's glass palette). */
function checkAccent(page, chrome, where) {
	page.check(
		`${where}: the send glyph is the text accent ${chrome.accent} (${chrome.send})`,
		chrome.send === hexRgb(chrome.accent)
	);
}

/**
 * The sidebar's channel names: an idle one (a connected channel, not open,
 * highlighted, muted or under the pointer) and the open one, with the soft
 * ink the idle one should be in.
 */
const RAIL_NAMES = `(() => {
	const rows = [...document.querySelectorAll('#sidebar .channel-list-item[data-type="channel"]')];
	const name = (row) => row && {row: row.dataset.name, color: getComputedStyle(row.querySelector(".name")).color};
	return {
		soft: getComputedStyle(document.getElementById("sidebar")).getPropertyValue("--ps-g-soft").trim(),
		idle: name(rows.find((r) => !r.matches(".active, .has-highlight, .is-muted, .not-connected, .parted-channel, :hover"))),
		open: name(rows.find((r) => r.matches(".active"))),
	};
})()`;

/** The night glass's ink (spec §6), which the open row's name is written in. */
const NIGHT_INK = "rgb(233, 238, 247)";

/**
 * Under reduced transparency the glass is solid: no blur, an opaque fill.
 * Chromium may not emulate the feature; then the check is skipped, loudly,
 * rather than passed. Lifted again at the end, and the glass of the `rgb`
 * tint must be back.
 */
async function checkReducedTransparency(page, where, rgb) {
	await page.send("Emulation.setEmulatedMedia", {
		features: [{name: "prefers-reduced-transparency", value: "reduce"}],
	});
	await page.sleep(TEXT_EASE_MS); // the glass's colour flips over --ps-flip
	const reduced = await page.evaluate(CHROME);

	if (!reduced.reducedTransparency) {
		console.log(
			`  SKIP ${where}, reduced transparency: matchMedia("(prefers-reduced-transparency: reduce)") ` +
				`stays false under Emulation.setEmulatedMedia — this Chromium does not emulate the feature`
		);
	} else {
		for (const selector of GLASS) {
			const s = reduced.glass[selector];
			const c = rgba(s?.bg);
			page.check(
				`${where}, reduced transparency: ${selector} is solid (${
					s ? `${s.bg}, ${s.blur}` : "missing"
				})`,
				!!c && c.a === 1 && s.blur === "none"
			);
		}
	}

	await page.send("Emulation.setEmulatedMedia", {features: []});
	await page.sleep(TEXT_EASE_MS);
	const back = await page.evaluate(CHROME);
	page.check(
		`${where}: reduced transparency lifted, the glass is back (${GLASS.map(
			(s) => back.glass[s]?.blur
		).join(" | ")})`,
		GLASS.every((s) => isGlass(back.glass[s], rgb))
	);
}

/** The phone's sidebar: its glass, and whether it is on top at its centre. */
const DRAWER = `(() => {
	const s = document.getElementById("sidebar");
	const r = s.getBoundingClientRect();
	const cs = getComputedStyle(s);
	const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
	return {
		bg: cs.backgroundColor,
		blur: cs.backdropFilter,
		onTop: !!hit && s.contains(hit),
		hit: hit ? hit.tagName.toLowerCase() + (hit.id ? "#" + hit.id : "") + [...hit.classList].map((c) => "." + c).join("") : "nothing",
	};
})()`;

async function openAppearance(page) {
	await page.click(`#footer button.settings`);
	await page.waitFor(`document.querySelector(".settings-menu button.appearance")`, {
		label: "settings open",
	});
	await page.click(`.settings-menu button.appearance`);
	await page.waitFor(`document.querySelector("#theme-select")`, {label: "the theme select"});
}

/** The window's generic @change handler stores the select's value as the
 * setting; a bubbling `change` is what picking an option produces. */
async function chooseTheme(page, name) {
	await page.evaluate(
		`(() => {
			const el = document.querySelector("#theme-select");
			el.value = ${JSON.stringify(name)};
			el.dispatchEvent(new Event("change", {bubbles: true}));
		})()`
	);
	await page.sleep(700);
}

/** Settings is a modal over the whole app: nothing behind its backdrop
 * takes a click, so leave through Done before touching the sidebar. */
async function closeSettings(page) {
	await page.click(`.settings-modal-done`);
	await page.waitFor(`!document.querySelector(".settings-modal-done")`, {
		label: "settings closed",
	});
}

async function openSeance(page, label) {
	await page.click(`.channel-list-item[data-name="#seance"]`);
	await page.waitFor(`document.querySelector("#input")`, {label});
	await page.sleep(300);
}

/** Type a line into the composer and send it. */
async function sendLine(page, text) {
	await page.evaluate(
		`(() => {
			const i = document.getElementById("input");
			i.value = ${JSON.stringify(text)};
			i.dispatchEvent(new Event("input", {bubbles: true}));
			document.getElementById("form").requestSubmit();
		})()`
	);
}

export default async function run(page) {
	// A ?host link only pre-fills the connect form (a link is a suggestion,
	// boot.ts handleQueryParams); connect for real.
	await page.goto(page.url, {waitForSelector: "#connect form"});
	// Resource Timing drops entries silently past its default 250, which would
	// let "no animal file was fetched" pass on a busy page; the control in
	// ANIMAL_FILES catches that too, this makes it not happen.
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

	// A line of our own first: joins are condensed by default, and the
	// neighbour's must stand alone to show its hostmask and realname, not
	// fold into the join burst's last event.
	await sendLine(page, `waiting on the plains ${RUN}`);
	await page.waitFor(`!document.querySelector("#chat .msg.pending")`, {
		label: "our line before the neighbour",
	});

	const peer = await neighbour(PEER, EXT_NAME);
	peer.say(`hello from the neighbour ${RUN}`);
	peer.say(`${EXT_NAME} says hello too ${RUN}`);
	peer.say(`${VI_NAME} says xin chào ${RUN}`);
	peer.say(`\x1d${VI_NAME}\x1d, in italic ${RUN}`);
	await page.waitFor(OTHERS_LINE, {label: "the neighbour's line"});
	await page.waitFor(`document.querySelector('${PEER_JOIN} .realname')`, {
		label: "the neighbour's join, on its own, with its realname",
	});

	// ---- pick ps from Appearance

	await openAppearance(page);
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
	await chooseTheme(page, "ps");
	await closeSettings(page);
	await openSeance(page, "back in #seance");

	page.check(
		"the stylesheet is themes/ps.css",
		(await page.evaluate(THEME_HREF)) === "themes/ps.css"
	);
	checkMounted(page, await page.evaluate(SCENE_STATE), "#seance");

	// The animals are off: every slot of the scene's animal layer empty,
	// nothing painted, and — the part only a browser can say — no animal file
	// requested, although the stylesheet still names all of them. A `url()`
	// sitting in a custom property that no resolved background-image
	// substitutes is never fetched (tools/heart/README.md § Budget and
	// browsers).
	checkNoAnimals(page, await animalFiles(page, "the theme's subresources recorded"), "#seance");

	// ---- the fonts
	//
	// Every one of the nine files has text of its own on the page: the
	// neighbour's join (its hostmask and its realname, EXT_NAME, in italic),
	// its lines (EXT_NAME upright, VI_NAME upright and in italic), and queries
	// called EXT_NAME and VI_NAME, whose names the sidebar sets in Fraunces.
	// Each face must have loaded, and — the latin-ext trap — each must have
	// drawn that text.

	await sendLine(page, `/query ${EXT_NAME}`);
	await page.waitFor(`document.querySelector('${EXT_QUERY_ROW}')`, {
		label: `the query ${EXT_NAME} in the sidebar`,
	});
	await sendLine(page, `/query ${VI_NAME}`);
	await page.waitFor(`document.querySelector('${VI_QUERY_ROW}')`, {
		label: `the query ${VI_NAME} in the sidebar`,
	});
	await openSeance(page, `back in #seance from ${EXT_NAME}`);
	await page.evaluate(`document.fonts.ready.then(() => true)`);
	await page.sleep(500);

	const faces = await page.evaluate(FONT_FACES);

	for (const [family, style] of [
		["Mulish", "normal"],
		["Mulish", "italic"],
		["Fraunces", "normal"],
	]) {
		for (const block of ["latin", "latin-ext", "vietnamese"]) {
			const face = faces.filter(
				(f) => f.family === family && f.style === style && f.block === block
			);
			page.check(
				`fonts: ${family} ${style}, ${block}, is loaded (${
					face.map((f) => f.status).join(", ") || "not declared"
				})`,
				face.length === 1 && face[0].status === "loaded"
			);
		}
	}

	const widths = await page.evaluate(FONT_WIDTHS);

	for (const [probe, [own, fallback]] of Object.entries(widths)) {
		page.check(
			`fonts: ${probe} measures unlike its fallback (${own.toFixed(2)} vs ${fallback.toFixed(
				2
			)})`,
			own !== fallback
		);
	}

	await page.send("DOM.enable");
	await page.send("DOM.getDocument", {depth: 0});
	await page.send("CSS.enable");
	await checkDrawnIn(
		page,
		"the neighbour's join shows its hostmask in Mulish italic",
		TEXT_HOLDER(`${PEER_JOIN} .hostmask`, "@"),
		"Mulish",
		true
	);
	await checkDrawnIn(
		page,
		`the neighbour's join shows its realname, ${EXT_NAME}, in Mulish italic`,
		TEXT_HOLDER(`${PEER_JOIN} .realname`, EXT_NAME),
		"Mulish",
		true
	);
	await checkDrawnIn(
		page,
		`the neighbour's line says ${EXT_NAME} in Mulish`,
		TEXT_HOLDER(PEER_LINES, EXT_NAME),
		"Mulish",
		false
	);
	await checkDrawnIn(
		page,
		`the sidebar names the query ${EXT_NAME} in Fraunces`,
		TEXT_HOLDER(`${EXT_QUERY_ROW} .name`, EXT_NAME),
		"Fraunces",
		false
	);
	await checkDrawnIn(
		page,
		`the neighbour's line says ${VI_NAME} in Mulish`,
		TEXT_HOLDER(PEER_LINES, `${VI_NAME} says`),
		"Mulish",
		false
	);
	await checkDrawnIn(
		page,
		`the neighbour's line says ${VI_NAME} in Mulish italic`,
		TEXT_HOLDER(`${PEER_LINES} .irc-italic`, VI_NAME),
		"Mulish",
		true
	);
	await checkDrawnIn(
		page,
		`the sidebar names the query ${VI_NAME} in Fraunces`,
		TEXT_HOLDER(`${VI_QUERY_ROW} .name`, VI_NAME),
		"Fraunces",
		false
	);
	await page.send("CSS.disable");
	await page.send("DOM.disable");

	// ---- messages: the fade, no glitter, the reaction's pop

	const anim = await page.evaluate(
		`getComputedStyle(document.querySelector("#chat .msg")).animationName`
	);
	page.check(`messages fade in (${anim})`, anim.includes("ps-fade"));

	// The neighbour's own line, not the first .time in the log: that can be a
	// condensed group's empty one, stretched to a two-line summary beside it
	// (the rig's #seance history is whatever earlier runs left).
	const timeMetrics = await page.evaluate(
		`(() => {
			const el = document.querySelector('#chat .msg[data-type="message"][data-from="${PEER}"] .time');
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
	await sendLine(page, OWN_TEXT);
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
	await sendLine(page, "/react 💖");
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

	await page.screenshot("ps-seance");

	// ---- a second channel, the same place

	await page.click(`.channel-list-item[data-name="#kittens"]`);
	await page.waitFor(`document.querySelector("#input")`, {label: "in #kittens"});
	await page.sleep(300);
	checkNoAnimals(page, await animalFiles(page, "#kittens settled"), "#kittens");
	await page.screenshot("ps-kittens");

	// ---- reduced motion

	// Reduced motion repoints every animal token at its still. The slots stay
	// empty, so no still is painted or fetched either. The repointing itself
	// is the control that the emulation took: without it this leg would be a
	// second look at the animated tokens. The scene stops outright, visible
	// or not.
	await page.send("Emulation.setEmulatedMedia", {
		features: [{name: "prefers-reduced-motion", value: "reduce"}],
	});
	await openSeance(page, "back in #seance, reduced");
	const still = await page.evaluate(
		`getComputedStyle(document.documentElement).getPropertyValue("--ps-horse").trim()`
	);
	page.check(
		`reduced motion points the animals at their stills (${still})`,
		/-still\.svg/.test(still)
	);
	checkNoAnimals(page, await animalFiles(page, "the reduced scene settled"), "reduced motion");
	checkStopped(page, await page.evaluate(SCENE_STATE), "reduced motion, visible");
	await page.evaluate(VISIBILITY("hidden"));
	checkStopped(page, await page.evaluate(SCENE_STATE), "reduced motion, hidden");
	await page.evaluate(VISIBILITY("visible"));
	await page.sleep(300);
	checkStopped(page, await page.evaluate(SCENE_STATE), "reduced motion, shown again");
	await page.screenshot("ps-reduced");
	await page.send("Emulation.setEmulatedMedia", {features: []});
	await page.sleep(300);
	checkRunning(page, await page.evaluate(SCENE_STATE), "reduced motion lifted");

	// ---- the hours

	const noon = await atHour(page, 12);
	page.check(
		`noon (${hhmm(noon.minute)}): daylight, ink text ${noon.ink} (light ${noon.light}, text ${
			noon.text
		})`,
		noon.light === "day" && noon.text === "ink" && noon.ink === INK
	);
	page.check(
		`noon: the canvas is the sky's top (${noon.canvas} = ${noon.skyTop})`,
		noon.canvas !== "" && noon.canvas === noon.skyTop
	);
	// The browser's own bar runs on into the sky (scene.ts themeColorFor).
	page.check(
		`noon: theme-color is the canvas (${noon.meta} = ${noon.canvas})`,
		noon.canvas !== "" && noon.meta === noon.canvas
	);

	// The chrome floats over the plains as day glass; the iOS status bar's
	// tint is never blurred (iOS would not sample it: CLAUDE.md, "The iOS
	// status bar").
	const noonChrome = await page.evaluate(CHROME);
	checkGlass(page, noonChrome, "noon", DAY_GLASS);
	page.check(
		`noon: #status-bar-tint has no backdrop filter (${noonChrome.tint?.blur})`,
		noonChrome.tint?.blur === "none"
	);
	checkAccent(page, noonChrome, "noon");
	await page.screenshot("ps-noon");

	for (const hour of [22, 0]) {
		const s = await atHour(page, hour);
		page.check(
			`${hhmm(s.minute)}: night, white text ${s.ink} (light ${s.light}, text ${s.text})`,
			s.light === "night" && s.text === "light" && s.ink === WHITE
		);
		page.check(
			`${hhmm(s.minute)}: the canvas is the sky's top (${s.canvas} = ${s.skyTop})`,
			s.canvas !== "" && s.canvas === s.skyTop
		);

		if (hour === 22) {
			// Night glass, and the chrome's words in the night glass's inks.
			const at = hhmm(s.minute);
			const night = await page.evaluate(CHROME);
			checkGlass(page, night, at, NIGHT_GLASS);
			checkAccent(page, night, at);
			const rail = await page.evaluate(RAIL_NAMES);
			page.check(
				`${at}: an idle channel name is the night soft ink ${rail.soft} (${
					rail.idle ? `${rail.idle.row} ${rail.idle.color}` : "no idle channel row"
				})`,
				!!rail.idle && rail.idle.color === hexRgb(rail.soft)
			);
			page.check(
				`${at}: the open channel's name is the night ink ${NIGHT_INK} (${
					rail.open ? `${rail.open.row} ${rail.open.color}` : "no open channel row"
				})`,
				!!rail.open && rail.open.color === NIGHT_INK
			);
		}

		await page.screenshot(`ps-${String(hour).padStart(2, "0")}00`);

		if (hour === 22) {
			await checkReducedTransparency(page, hhmm(s.minute), NIGHT_GLASS);
		}
	}

	// Dusk: 45 minutes after today's sunset, by the engine's own formula. A
	// time-zone override moves the clock in whole hours and the minute is
	// whatever it is now, so the hour is the one that puts the current minute
	// nearest that moment: 15 to 75 minutes after sunset, whatever the day or
	// the minute. The control checks the page's clock is inside the dusk
	// window before the colour check means anything.
	const today = sunTimes(dayOfYear(new Date()));
	const duskHour = Math.round((today.set + 45 - new Date().getUTCMinutes()) / 60);
	const dusk = await atHour(page, ((duskHour % 24) + 24) % 24);
	const set = sunTimes(dusk.doy).set;
	page.check(
		`the dusk leg is at dusk (${hhmm(dusk.minute)}, sunset ${hhmm(set)}, dusk until ${hhmm(
			set + DUSK
		)})`,
		dusk.minute > set && dusk.minute <= set + DUSK
	);
	page.check(
		`dusk (${hhmm(dusk.minute)}): white text while the light changes ${dusk.ink} (light ${
			dusk.light
		}, text ${dusk.text})`,
		dusk.text === "light" && dusk.ink === WHITE
	);
	await page.screenshot("ps-dusk");

	// ---- a hidden page stops the scene

	await atHour(page, 12);
	checkRunning(page, await page.evaluate(SCENE_STATE), "shown");
	await page.evaluate(VISIBILITY("hidden"));
	checkStopped(page, await page.evaluate(SCENE_STATE), "hidden");
	await page.evaluate(VISIBILITY("visible"));
	await page.sleep(300);
	checkRunning(page, await page.evaluate(SCENE_STATE), "shown again");

	// ---- the view follows the conversation

	// Its own query: EXT_NAME's is in the sidebar too.
	const QUERY_ROW = `.channel-list-item[data-type="query"][data-name="${NICK}x"]`;
	await sendLine(page, `/query ${NICK}x`);
	await page.waitFor(`document.querySelector('${QUERY_ROW}')`, {
		label: "the query in the sidebar",
	});
	await page.click(QUERY_ROW);
	await page.sleep(300);
	const inQuery = await page.evaluate(SCENE_STATE);
	page.check(`a query: the scene's view is query (${inQuery.view})`, inQuery.view === "query");
	await openSeance(page, "back in #seance from the query");
	const inChannel = await page.evaluate(SCENE_STATE);
	page.check(
		`a channel: the scene's view is channel (${inChannel.view})`,
		inChannel.view === "channel"
	);

	// ---- theme switches

	await openAppearance(page);
	const inSettings = await page.evaluate(SCENE_STATE);
	page.check(
		`no conversation (Settings): the scene's view is other (${inSettings.view})`,
		inSettings.view === "other"
	);
	await chooseTheme(page, "coffee");
	const coffee = await page.evaluate(SCENE_STATE);
	page.check(
		`coffee: no scene (display ${coffee.display}, ${coffee.children} children)`,
		coffee.display === "none" && coffee.children === 0
	);
	page.check(
		`coffee: nothing left on <html> (light ${coffee.light}, text ${coffee.text}, canvas "${coffee.canvas}")`,
		coffee.light === undefined && coffee.text === undefined && coffee.canvas === ""
	);
	// coffee's own themeColor (client/js/configuration.ts), not the sky's.
	page.check(
		`coffee: theme-color is coffee's own #1a1816 (${coffee.meta})`,
		coffee.meta.toLowerCase() === "#1a1816"
	);

	// A scene mounted into a hidden page starts stopped; showing the page
	// starts it.
	await page.evaluate(VISIBILITY("hidden"));
	await chooseTheme(page, "ps");
	const back = await page.evaluate(SCENE_STATE);
	checkMounted(page, back, "ps again, applied while hidden");
	checkStopped(page, back, "ps again, applied while hidden");
	await page.evaluate(VISIBILITY("visible"));
	await page.sleep(300);
	const shown = await page.evaluate(SCENE_STATE);
	checkRunning(page, shown, "ps again, shown");
	// Only a visible scene ticks, so only now is theme-color the sky again.
	page.check(
		`ps again, shown: theme-color follows the sky again (${shown.meta} = ${shown.canvas})`,
		shown.canvas !== "" && shown.meta === shown.canvas
	);
	await closeSettings(page);
	await openSeance(page, "back in #seance after the switches");

	// ---- a phone, at noon: the scene behind the conversation alone

	const viewportHas = (cls) =>
		page.evaluate(
			`document.getElementById("viewport").classList.contains(${JSON.stringify(cls)})`
		);
	await page.send("Emulation.setDeviceMetricsOverride", {
		width: 390,
		height: 844,
		deviceScaleFactor: 1,
		mobile: true,
	});
	await page.sleep(500);

	// The sidebar and the user list are overlays at this width; put both
	// away (the overlay's own click handler, and the header's toggle).
	if (await viewportHas("menu-open")) {
		await page.evaluate(`document.getElementById("sidebar-overlay").click()`);
	}

	const userlistWasOpen = await viewportHas("userlist-open");

	if (userlistWasOpen) {
		await page.evaluate(`document.querySelector("#chat .header button.rt").click()`);
	}

	await page.sleep(800);
	await page.screenshot("ps-phone-noon");

	// On the phone layout the glass has no backdrop filter and keeps the
	// generated tint (ps.css, the phones section: the measured budget's
	// fallback, ps-theme.md §10): the header and the composer at noon.
	await atHour(page, 12);
	const phoneNoon = await page.evaluate(CHROME);

	for (const selector of ["#chat .header", "#form"]) {
		const s = phoneNoon.glass[selector];
		page.check(
			`a phone at noon: ${selector} is the day tint at 78 %, unblurred (${
				s ? `${s.bg}, ${s.blur}` : "missing"
			})`,
			isUnblurredTint(s, DAY_GLASS, 0.78)
		);
	}

	// ---- the phone at night, the drawer open: the night tint over the plains

	// The scrim starts at the drawer's edge (ps.css, the phone block), so the
	// drawer lies over the plains themselves, not a dimmed grey.
	await atHour(page, 22);
	await page.click(`#chat .header .lt`);
	await page.waitFor(`document.getElementById("viewport").classList.contains("menu-open")`, {
		label: "the phone's sidebar open",
	});
	await page.sleep(700); // the drawer's slide
	const drawer = await page.evaluate(DRAWER);
	page.check(
		`a phone at night: the open drawer is the night tint at 74 %, unblurred (${drawer.bg}, ${drawer.blur})`,
		isUnblurredTint(drawer, NIGHT_GLASS, 0.74)
	);
	page.check(
		`a phone at night: the drawer is on top, not under the scrim (${drawer.hit})`,
		drawer.onTop
	);
	await page.screenshot("ps-phone-night-sidebar");
	await page.evaluate(`document.getElementById("sidebar-overlay").click()`);
	await page.waitFor(`!document.getElementById("viewport").classList.contains("menu-open")`, {
		label: "the phone's sidebar closed",
	});

	await page.send("Emulation.setDeviceMetricsOverride", {
		width: Number(page.opt("width", 1280)),
		height: Number(page.opt("height", 900)),
		deviceScaleFactor: 1,
		mobile: page.flags.has("--mobile"),
	});
	await page.sleep(300);

	if (userlistWasOpen) {
		await page.evaluate(`document.querySelector("#chat .header button.rt").click()`);
	}

	const oldName = await page.evaluate(
		`/ps\\s*(<|&lt;)3/.test(document.documentElement.outerHTML + document.title)`
	);
	page.check(`the page says "ps <3" nowhere`, oldName === false);

	page.check(`no console errors (${page.consoleErrors.length})`, page.consoleErrors.length === 0);

	// ---- last: the scene's chunk does not load

	// The service worker fetches on the page's behalf and the memory cache
	// holds the chunk: either would mount the scene past the block.
	await page.send("Network.enable");
	await page.send("Network.setBypassServiceWorker", {bypass: true});
	await page.send("Network.setCacheDisabled", {cacheDisabled: true});
	await page.send("Network.setBlockedURLs", {urls: ["*scene-ps*"]});
	const logsFrom = page.consoleLogs.length;
	const entriesFrom = page.logEntries.length;
	await page.send("Page.reload", {ignoreCache: true});

	const warned = () =>
		page.consoleLogs.slice(logsFrom).some((l) => l.text.startsWith(HOOK_WARNING));
	for (let i = 0; i < 200 && !warned(); i++) {
		await page.sleep(100);
	}

	page.check(`the reload tried the scene and it did not load (the hook warned)`, warned());

	// The reload lands on the connect form, filled from the saved network
	// (a fresh nick, in case the old one is still leaving). Back in #seance,
	// the neighbour speaks again: the ink is read off that line.
	await page.waitFor(`document.querySelector("#connect form")`, {label: "the connect form"});
	await page.fill(`[id="connect:nick"]`, `${NICK}b`);
	await page.evaluate(`document.querySelector("#connect form").requestSubmit()`);
	await page.waitFor(`document.querySelector('.channel-list-item[data-name="#seance"]')`, {
		timeout: 30000,
		label: "#seance in the sidebar after the reload",
	});
	await page.click(`.channel-list-item[data-name="#seance"]`);
	await page.sleep(1000); // the join burst
	peer.say(`still here ${RUN}`);
	await settle(page, OTHERS_LINE, 10000);
	await page.sleep(TEXT_EASE_MS);
	page.check(
		"after the reload the stylesheet is still themes/ps.css",
		(await page.evaluate(THEME_HREF)) === "themes/ps.css"
	);
	const soft = await page.evaluate(SCENE_STATE);
	page.check(
		`no chunk: an empty scene element, still shown (display ${soft.display}, ${soft.children} children)`,
		soft.display === "block" && soft.children === 0
	);
	page.check(
		`no chunk: the daylight fallback paints the sky (${soft.background})`,
		soft.background.includes(FALLBACK_SKY)
	);
	page.check(
		`no chunk: ink text, nothing published (text ${soft.text}, ink ${soft.ink})`,
		soft.text === undefined && soft.ink === INK
	);
	await page.screenshot("ps-no-scene");

	// The console may say two things and no more: the blocked request, and
	// the hook's one warning. The Chromium this was written against writes no
	// console line at all for a request DevTools blocked (Log.entryAdded
	// carries nothing for it), so the request is witnessed by the warning,
	// whose ChunkLoadError names it; a browser that does log it may log it
	// once. NOT_THE_SCENE's lines are the rig's, and set aside by name.
	const complaints = [
		...page.logEntries
			.slice(entriesFrom)
			.filter((e) => e.level === "error" || e.level === "warning")
			.map((e) => `${e.level} [${e.source}] ${e.text} ${e.url}`),
		...page.consoleLogs
			.slice(logsFrom)
			.filter((l) => ["error", "warning", "assert", "exception"].includes(l.type))
			.map((l) => `${l.type} ${l.text}`),
	];
	const setAside = complaints.filter((c) => NOT_THE_SCENE.some((re) => re.test(c)));
	const blocked = complaints.filter((c) =>
		/^error \[network\] .* \S*\/js\/scene-ps\.js$/.test(c)
	);
	const warning = complaints.filter((c) => c.startsWith(`warning ${HOOK_WARNING}`));
	const unexpected = complaints.filter(
		(c) => !setAside.includes(c) && !blocked.includes(c) && !warning.includes(c)
	);
	const firstLine = (c) => c.split("\n")[0].slice(0, 110);
	page.check(
		`no chunk: the hook warned once, naming the blocked js/scene-ps.js (${warning.length})`,
		warning.length === 1 && /\/js\/scene-ps\.js\b/.test(warning[0])
	);
	page.check(
		`no chunk: the console says nothing else (${blocked.length} blocked-request line, ` +
			`${setAside.length} set aside${
				unexpected.length ? `; unexpected: ${unexpected.map(firstLine).join(" | ")}` : ""
			})`,
		unexpected.length === 0 && blocked.length <= 1 && warning.length === 1
	);
	console.log(`   set aside: ${setAside.map(firstLine).join(" | ") || "nothing"}`);

	peer.quit();
	await page.send("Network.setBlockedURLs", {urls: []});
	await page.send("Emulation.setTimezoneOverride", {timezoneId: ""});
}
