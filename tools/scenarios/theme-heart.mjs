// The <3 theme in a real browser (docs/projects/heart-theme.md): picking it
// in Appearance swaps the stylesheet, the chat root carries the
// conversation's seed, the message area carries the meadow, a message fades
// in, an own pending message carries its glitter, text keeps its contrast on
// the sky, and two channels grow two different meadows.
//
//   corepack yarn build && python3 -m http.server -d public 8021 &
//   node tools/browser-drive.mjs tools/scenarios/theme-heart.mjs
//
// The default target is a plain-WS ircd on 127.0.0.1:8067 (the dev ircd's
// ws:// port); SEANCE_IRC_PORT overrides the port for a different rig.

const RUN = Date.now().toString(36);
const NICK = `hb${RUN}`;
const BASE = "http://localhost:8021/";
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
	await page.screenshot("heart-kittens");

	await page.click(`.channel-list-item[data-type="lobby"]`);
	await page.sleep(300);
	const lobbyScene = await page.evaluate(
		`document.getElementById("chat-container").dataset.scene ?? "none"`
	);
	page.check(`the lobby has no scene (${lobbyScene})`, lobbyScene === "none");

	page.check(`no console errors (${page.consoleErrors.length})`, page.consoleErrors.length === 0);
}
