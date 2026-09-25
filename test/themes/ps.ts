import {expect} from "chai";
import fs from "fs";
import path from "path";
import {contrast, hexRgb, luminance, rgbHex} from "../../client/js/scenes/ps/colour";
import {momentFor, sunTimes} from "../../client/js/scenes/ps/engine";
import {
	DAY_BRIGHTNESS,
	DAY_GLASS_MARK,
	DAY_GLASS_TEXT,
	glassVars,
	GLASS_SURFACES as TINTED,
	MARK_SOLVE,
	SATURATE,
	TEXT_SOLVE,
	TINT_CAP,
	type GlassSurface,
} from "../../client/js/scenes/ps/glass";
import {paletteAt} from "../../client/js/scenes/ps/palette";
import {LAND_SHARE} from "../../client/js/scenes/ps/plains";
import {sceneVars} from "../../client/js/scenes/ps/scene";
import {
	checkedGrounds,
	dayGlassGrounds,
	glassGround,
	withPinned,
	type Light,
} from "../../tools/ps/legibility";
import bird from "../../tools/heart/rigs/bird.mjs";
import bunny from "../../tools/heart/rigs/bunny.mjs";
import deer from "../../tools/heart/rigs/deer.mjs";
import frog from "../../tools/heart/rigs/frog.mjs";
import horse from "../../tools/heart/rigs/horse.mjs";
import kitten from "../../tools/heart/rigs/kitten.mjs";
import ladybug from "../../tools/heart/rigs/ladybug.mjs";
import puppy from "../../tools/heart/rigs/puppy.mjs";

const css = fs.readFileSync(path.resolve(__dirname, "../../client/themes/ps.css"), "utf8");
const coffee = fs.readFileSync(path.resolve(__dirname, "../../client/themes/coffee.css"), "utf8");

describe("the ps theme (client/themes/ps.css)", function () {
	it("is coffee's rules with its own tokens", function () {
		expect(css.startsWith("/*")).to.be.true;
		expect(css).to.include('@import "coffee.css";');
		expect(css).to.include("color-scheme: light;");
		expect(css).to.match(/^\s*--chat-bg:/m);
	});
});

/* ---- reading the stylesheet ---- */

interface Rule {
	/** The at-rules around the rule, outermost first, joined by a space ("" at the top level). */
	at: string;
	selectors: string[];
	decls: Array<[string, string]>;
}

/** A selector list split on its top-level commas: the comma inside `:not(a, b)` stays put. */
function splitSelectors(list: string): string[] {
	const out: string[] = [];
	let depth = 0;
	let start = 0;

	for (let i = 0; i < list.length; i++) {
		if (list[i] === "(") {
			depth++;
		} else if (list[i] === ")") {
			depth--;
		} else if (list[i] === "," && depth === 0) {
			out.push(list.slice(start, i));
			start = i + 1;
		}
	}

	out.push(list.slice(start));
	return out.map((s) => s.trim().replace(/\s+/g, " ")).filter(Boolean);
}

/** Every style rule in `text`, comments dropped, with the at-rules around it (@media, @supports…). */
function rulesIn(text: string): Rule[] {
	const src = text.replace(/\/\*[\s\S]*?\*\//g, "");
	const out: Rule[] = [];
	const at: string[] = [];
	let start = 0;

	for (let i = 0; i < src.length; i++) {
		if (src[i] === "{") {
			const prelude = src.slice(start, i).trim();

			if (prelude.startsWith("@")) {
				at.push(prelude);
				start = i + 1;
				continue;
			}

			const end = src.indexOf("}", i);
			out.push({
				at: at.join(" "),
				selectors: splitSelectors(prelude),
				decls: src
					.slice(i + 1, end)
					.split(";")
					.map((d) => d.trim())
					.filter(Boolean)
					.map((d) => [
						d.slice(0, d.indexOf(":")).trim(),
						d.slice(d.indexOf(":") + 1).trim(),
					]),
			});
			i = end;
			start = end + 1;
		} else if (src[i] === "}") {
			at.pop();
			start = i + 1;
		} else if (src[i] === ";") {
			start = i + 1; // the end of @import, or of a declaration in @font-face
		}
	}

	return out;
}

const rules = rulesIn(css);
const DAY = ":root";
const NIGHT = ':root[data-ps-light="night"]';
const REDUCED_TRANSPARENCY = "@media (prefers-reduced-transparency: reduce)";

/** The declarations every top-level rule naming `selector` gives it, in source order. */
function declsOf(selector: string, at = "", list = rules): Array<[string, string]> {
	return list
		.filter((r) => r.at === at && r.selectors.includes(selector))
		.flatMap((r) => r.decls);
}

/** The last value `selector` gets for `property`, or undefined. */
function valueOf(selector: string, property: string, at = ""): string | undefined {
	return declsOf(selector, at)
		.filter(([p]) => p === property)
		.at(-1)?.[1];
}

/**
 * The custom properties <html> holds in one light: coffee.css's :root, then
 * every top-level :root rule in ps.css, then (at night) its night rules.
 */
function paletteOf(light: "day" | "night"): Map<string, string> {
	const out = new Map<string, string>();

	const take = (decls: Array<[string, string]>) => {
		for (const [p, v] of decls) {
			if (p.startsWith("--")) {
				out.set(p, v);
			}
		}
	};

	take(declsOf(DAY, "", rulesIn(coffee)));
	take(declsOf(DAY));

	if (light === "night") {
		take(declsOf(NIGHT));
	}

	return out;
}

/** `value` with every var() replaced from `palette`, recursively. */
function resolve(palette: Map<string, string>, value: string, depth = 0): string {
	if (depth > 20) {
		throw new Error(`a var() cycle through ${value}`);
	}

	return value.replace(/var\((--[\w-]+)(?:,\s*([^()]*))?\)/g, (_, name: string, fallback) => {
		const v = palette.get(name) ?? fallback;

		if (v === undefined) {
			throw new Error(`${name} is not defined`);
		}

		return resolve(palette, v, depth + 1);
	});
}

/** A resolved colour as [r, g, b, alpha]. */
function rgba(value: string): [number, number, number, number] {
	const v = value.trim();

	if (v === "transparent") {
		return [0, 0, 0, 0];
	}

	const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v)?.[1];

	if (hex) {
		const six = hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex;
		const [r, g, b] = [0, 2, 4].map((i) => parseInt(six.slice(i, i + 2), 16));
		return [r, g, b, 1];
	}

	const m = /^rgb\(\s*(\d+)\s+(\d+)\s+(\d+)\s*(?:\/\s*([\d.]+)(%?))?\s*\)$/.exec(v);

	if (!m) {
		throw new Error(`not a colour this test reads: ${value}`);
	}

	const alpha = m[4] === undefined ? 1 : Number(m[4]) / (m[5] ? 100 : 1);
	return [Number(m[1]), Number(m[2]), Number(m[3]), alpha];
}

/** `colour` composited over the opaque `ground`, as #rrggbb. */
function over(colour: string, ground: string): string {
	const [r, g, b, a] = rgba(colour);
	const [R, G, B] = hexRgb(ground);
	return rgbHex(r * a + R * (1 - a), g * a + G * (1 - a), b * a + B * (1 - a));
}

/** The token list coffee.css reads, as the plan-1 test had it. */
const COFFEE_TOKENS = [
	"--chat-fg",
	"--chat-fg-muted",
	"--chat-fg-faint",
	"--chat-heading",
	"--chat-rule",
	"--chat-accent",
	"--chat-accent-fg",
	"--chat-accent-rule",
	"--chat-highlight-bg",
	"--chat-selection",
	"--composer-bg",
	"--composer-border",
	"--window-border",
	"--window-shadow",
	"--menu-bg",
	"--rail-bg-top",
	"--rail-bg-bottom",
	"--rail-fg",
	"--rail-fg-strong",
	"--rail-fg-active",
	"--rail-fg-muted",
	"--rail-item-active-bg",
	"--rail-item-hover-bg",
	"--rail-accent",
	"--rail-accent-fg",
	"--rail-badge-bg",
	"--rail-badge-fg",
	"--rail-input-bg",
	"--rail-input-border",
	"--event-join",
	"--event-quit",
	"--nick-default",
	"--notice-color",
	"--action-color",
	"--note-bg",
	"--note-fg",
	"--warn-bg",
	"--warn-fg",
	"--error-bg",
	"--error-fg",
	"--ok-bg",
	"--ok-fg",
	"--tint-soft",
	"--tint-strong",
	"--accent-tint-20",
	"--accent-tint-30",
	"--focus-ring",
	"--scrollbar-track",
	"--scrollbar-thumb",
	"--scrollbar-thumb-active",
	"--tok-comment",
	"--tok-keyword",
	"--tok-string",
	"--tok-number",
	"--tok-function",
	"--tok-operator",
	"--tok-punctuation",
	"--tok-tag",
	"--tok-attr",
];

/**
 * The surfaces, as Task 4's walk classified them
 * (.superpowers/sdd/2026-09-24-ps-plan2-chrome/task-4-report.md): glass is
 * tinted and blurred over the plains, solid is the glass's opaque colour.
 * The composer is one glass surface: its bars are its children. The chips
 * leave the pressed (.self) and add (+) chips their own tints.
 */
const GLASS_SURFACES = [
	"#sidebar",
	"#chat .header",
	"#chat .userlist",
	"#form",
	"#chat .msg-reaction:not(.self, .msg-reaction-add)",
];

const SOLID_SURFACES = [
	".settings-modal",
	"#help",
	"#changelog",
	"#connect",
	"#context-menu",
	".mentions-popup",
	".textcomplete-menu",
	".reaction-picker",
	".reaction-picker-heading",
	"#upload-preview",
	"#confirm-dialog",
	"#push-prompt",
	".scroll-down-arrow",
];

/** The dialogs whose .vue files hardcode white text, fine on coffee's dark body and not on paper. */
const WHITE_TEXT_DIALOGS = ["#confirm-dialog", "#upload-preview", "#push-prompt"];

/** By day each surface reads its own tint (--ps-g-tint: the scene's for that surface, or the generated one); at night the generated one. */
const TINT_DAY = "rgb(255 251 244 / var(--ps-g-tint))";
const TINT_NIGHT = "rgb(12 17 32 / var(--ps-g-tint-a))";
/** The glass's backdrop: brightened (--ps-g-lift) by day while the scene runs, never at night or without it. */
const GLASS_FILTER = `blur(0.625rem) var(--ps-g-lift,) saturate(${SATURATE})`;
/** Where the scene is running and it is day: the one place the backdrop is brightened. */
const DAY_SCENE = ':root[data-ps-light="day"]';
const PHONE =
	"@media (max-width: 768px), (max-height: 500px) and (hover: none) and (pointer: coarse)";
/** style.css's user list laid over a narrow chat pane, the condition verbatim. */
const OVERLAID = "@container chat (max-width: calc(50ch + 8.5rem + 84px))";
/** Which of the scene's day tints each glass surface reads (client/js/scenes/ps/glass.ts). */
const TINT_OF: Record<string, GlassSurface> = {
	"#chat .header": "header",
	"#form": "composer",
	"#sidebar": "side",
	"#chat .userlist": "side",
	"#chat .msg-reaction:not(.self, .msg-reaction-add)": "float",
};
const readsTint = (s: GlassSurface) => `var(--ps-g-tint-${s}, var(--ps-g-tint-a))`;

describe("the ps theme's chrome: glass over the plains (docs/projects/ps-theme.md §6)", function () {
	it("defines every token coffee.css reads twice: the day palette on :root, the night one under :root[data-ps-light=night]", function () {
		const day = new Set(declsOf(DAY).map(([p]) => p));
		const night = new Set(declsOf(NIGHT).map(([p]) => p));

		for (const token of COFFEE_TOKENS) {
			expect(day.has(token), `${token} on :root`).to.be.true;
			expect(night.has(token), `${token} at night`).to.be.true;
		}
	});

	it("takes the spec's glass primaries, and the generated tint, soft ink and badge", function () {
		const spec = {
			day: {
				"--ps-g-solid": "#fbf8f2",
				"--ps-g-ink": "#1f2a3d",
				"--ps-g-edge": "rgb(255 255 255 / 55%)",
				"--ps-g-field": "rgb(255 255 255 / 72%)",
				"--ps-g-selected": "rgb(255 255 255 / 60%)",
				"--ps-g-accent": "#c2562b",
			},
			night: {
				"--ps-g-solid": "#121827",
				"--ps-g-ink": "#e9eef7",
				"--ps-g-edge": "rgb(255 255 255 / 9%)",
				"--ps-g-field": "rgb(255 255 255 / 7%)",
				// The spec's white 11 % lifted the ground toward the light text on it;
				// on the glass every wash deepens toward black at night (the user's pick, 2026-09-25).
				"--ps-g-selected": "rgb(0 0 0 / 60%)",
				"--ps-g-accent": "#d9784a",
			},
		};

		for (const light of ["day", "night"] as const) {
			const p = paletteOf(light);

			for (const [token, want] of Object.entries(spec[light])) {
				expect(resolve(p, `var(${token})`), `${light} ${token}`).to.equal(want);
			}

			for (const token of [
				"--ps-g-tint-a",
				"--ps-g-soft",
				"--ps-g-badge",
				"--ps-g-accent-text",
			]) {
				expect(p.has(token), `${light} ${token}`).to.be.true;
			}
		}

		// Generated, not hand-written: only the glass block declares the text accent, once a light.
		const block = css.slice(
			css.indexOf("/* ps:glass-palette:start"),
			css.indexOf("/* ps:glass-palette:end */")
		);
		const declared = (text: string) => text.match(/^\s*--ps-g-accent-text:/gm)?.length ?? 0;
		expect(declared(css), "in ps.css").to.equal(2);
		expect(declared(block), "in the glass block").to.equal(2);

		expect(resolve(paletteOf("day"), "var(--rail-badge-bg)")).to.equal(
			resolve(paletteOf("day"), "var(--ps-g-badge)")
		);
		expect(resolve(paletteOf("night"), "var(--rail-badge-bg)")).to.equal(
			resolve(paletteOf("night"), "var(--ps-g-badge)")
		);
	});

	it("clears the rail's gradient: the glass paints the sidebar", function () {
		for (const light of ["day", "night"] as const) {
			expect(resolve(paletteOf(light), "var(--rail-bg-top)")).to.equal("transparent");
			expect(resolve(paletteOf(light), "var(--rail-bg-bottom)")).to.equal("transparent");
		}
	});

	it("writes and marks with the text accent, and keeps the spec's accent for the open row's marker", function () {
		for (const light of ["day", "night"] as const) {
			const p = paletteOf(light);
			expect(resolve(p, "var(--chat-accent)"), light).to.equal(
				resolve(p, "var(--ps-g-accent-text)")
			);
			expect(resolve(p, "var(--rail-accent)"), light).to.equal(
				resolve(p, "var(--ps-g-accent)")
			);
		}

		expect(
			valueOf(".channel-list-item .connection-status-icon.is-connecting::before", "color")
		).to.equal("var(--ps-g-accent-text)");
		expect(
			valueOf(
				"#chat .msg-reaction:not(.self, .msg-reaction-add):focus-visible",
				"border-color"
			)
		).to.equal("var(--ps-g-accent-text)");
	});

	it("starts the phone's scrim at the drawer's inner edge, so the drawer frosts the plains, not the scrim", function () {
		const style = fs.readFileSync(
			path.resolve(__dirname, "../../client/css/style.css"),
			"utf8"
		);
		expect(style, "style.css's phone block, the same list").to.include(`${PHONE} {`);
		// Physical, as style.css places the drawer (right: 100% and a translate).
		expect(valueOf("#sidebar-overlay", "left", PHONE)).to.equal("var(--sidebar-width)");
	});

	it("washes the glass away from its text: lighter by day, toward black at night, the solid panels keeping their tints", function () {
		for (const s of ["#sidebar", "#chat .header", "#chat .userlist", "#form"]) {
			expect(valueOf(s, "--tint-soft"), s).to.equal("var(--ps-g-wash-soft)");
			expect(valueOf(s, "--tint-strong"), s).to.equal("var(--ps-g-wash-strong)");
		}

		const [day, night] = [paletteOf("day"), paletteOf("night")];

		for (const token of ["--ps-g-wash-soft", "--ps-g-wash-strong", "--rail-item-hover-bg"]) {
			expect(resolve(day, `var(${token})`), `day ${token}`).to.match(/^rgb\(255 255 255 \//);
			expect(resolve(night, `var(${token})`), `night ${token}`).to.match(/^rgb\(0 0 0 \//);
		}

		expect(resolve(night, "var(--rail-item-active-bg)")).to.match(/^rgb\(0 0 0 \//);
		// The solid panels' tints stay creama's and coffee's.
		expect(resolve(day, "var(--tint-strong)")).to.equal("rgb(0 0 0 / 8%)");
		expect(resolve(night, "var(--tint-strong)")).to.equal("rgb(255 255 255 / 8%)");
	});

	it("keeps the user list's blur while a disconnected conversation fades: the fade is on the messages and the jump-to-recent disc, and eases both ways", function () {
		expect(valueOf("#chat.disconnected .chat-content", "opacity")).to.equal("1");
		expect(valueOf("#chat.disconnected .chat-content > .chat", "opacity")).to.equal("0.55");
		// The transition on the base rule, as style.css puts it on .chat-content's:
		// under .disconnected alone it would fade out and snap back on reconnect.
		expect(valueOf("#chat .chat-content > .chat", "transition")).to.equal("opacity 0.3s ease");
		expect(valueOf("#chat.disconnected .chat-content > .chat", "transition")).to.equal(
			undefined
		);
		// The disc fades with the conversation it jumps in: the arrow, since
		// .scroll-down's own opacity is what shows and hides it. Its transition
		// keeps style.css's background and colour ones beside the fade.
		expect(valueOf("#chat.disconnected .scroll-down-arrow", "opacity")).to.equal("0.55");
		expect(valueOf("#chat.disconnected .scroll-down", "opacity")).to.equal(undefined);
		expect(valueOf("#chat .scroll-down-arrow", "transition")).to.equal(
			"background 0.2s, color 0.2s, opacity 0.3s ease"
		);
	});

	it("tints the upload preview's rows and thumbnail backing instead of greying them", function () {
		expect(valueOf("#upload-preview .upload-preview-item", "background")).to.equal(
			"var(--tint-soft)"
		);
		expect(valueOf("#upload-preview .upload-preview-media", "background")).to.equal(
			"var(--tint-strong)"
		);
	});

	it("sets the windows flush with the sidebar, square and flat: none of day.css's floating card", function () {
		// The user, 2026-09-25: "I don't like the pop-out look (the 3d look) of the channel frame,
		// the way it separates from the network panel; … I don't like the round corners".
		expect(valueOf("#viewport", "padding")).to.equal("0");
		expect(valueOf("#viewport.menu-open", "padding")).to.equal("0");
		expect(valueOf(".window", "border-radius")).to.equal("0");
		expect(valueOf(".window", "box-shadow")).to.equal("none");
		expect(valueOf("#loading .window", "margin")).to.equal("0");
	});

	it("gives ps the daylight fallback's canvas as its theme-color before the scene loads", function () {
		const config = fs.readFileSync(
			path.resolve(__dirname, "../../client/js/configuration.ts"),
			"utf8"
		);
		const canvas = valueOf(DAY, "--canvas-bg-color");
		expect(canvas).to.equal("#3f8fe6");
		expect(config).to.include(`{name: "ps", displayName: "ps", themeColor: "${canvas}"}`);
	});

	it("draws both badges alike, the generated fill and a white numeral: the mockup's one badge", function () {
		expect(valueOf(".channel-list-item .badge.highlight", "background")).to.equal(
			"var(--rail-badge-bg)"
		);
		expect(valueOf(".channel-list-item .badge.highlight", "color")).to.equal(
			"var(--rail-badge-fg)"
		);
	});

	for (const selector of GLASS_SURFACES) {
		it(`makes ${selector} glass: the tint, swapped at night, and a 0.625rem blur`, function () {
			expect(valueOf(selector, "background-color"), "the day tint").to.equal(TINT_DAY);
			expect(valueOf(`${NIGHT} ${selector}`, "background-color"), "the night tint").to.equal(
				TINT_NIGHT
			);

			for (const property of ["backdrop-filter", "-webkit-backdrop-filter"]) {
				expect(valueOf(selector, property), property).to.equal(GLASS_FILTER);
			}
		});
	}

	it("gives each glass surface its day tint: the scene's for that surface (glass.ts), the generated one without the scene", function () {
		expect(Object.keys(TINT_OF)).to.have.members(GLASS_SURFACES);

		for (const [selector, surface] of Object.entries(TINT_OF)) {
			expect(valueOf(selector, "--ps-g-tint"), selector).to.equal(readsTint(surface));
		}

		// (On the phone layout no surface reads the scene's tints: the budget's
		// fallback, the next test.)

		// A user list laid over a narrow pane, under style.css's own condition,
		// stands over the chat, the yurt included.
		const style = rulesIn(
			fs.readFileSync(path.resolve(__dirname, "../../client/css/style.css"), "utf8")
		);
		expect(
			declsOf("#chat .userlist", OVERLAID, style),
			"style.css lays the list over the pane under the same condition"
		).to.deep.include(["position", "absolute"]);
		expect(valueOf("#chat .userlist", "--ps-g-tint", OVERLAID)).to.equal(readsTint("float"));

		// A composer risen above the near grass (the scene's ps-form-tall on <html>) stands over the yurt too.
		expect(valueOf(":root.ps-form-tall #form", "--ps-g-tint")).to.equal(readsTint("float"));
		expect(
			rules
				.filter((r) => r.selectors.some((s) => s.includes("ps-form-tall")))
				.map((r) => r.at),
			"at the top level, after #form's own; and restated by the phone's fallback"
		).to.deep.equal(["", PHONE]);
		// The band's top the scene measures against is the land's (plains.ts LAND_SHARE, ps.css .ps-land).
		const land = /^([\d.]+)%$/.exec(valueOf("#theme-scene .ps-land", "height") ?? "");
		expect(Number(land?.[1]) / 100, "the land's height").to.be.closeTo(LAND_SHARE, 1e-9);

		// The names the scene publishes are the ones read, and the fallback is the solver's cap.
		const names = Object.keys(glassVars({doy: 172, minute: 750, weather: "clear"}, "day"));
		expect(names.sort()).to.deep.equal(TINTED.map((s) => `--ps-g-tint-${s}`).sort());
		expect(resolve(paletteOf("day"), "var(--ps-g-tint-a)")).to.equal(String(TINT_CAP));
	});

	it("drops the glass's backdrop filter on the phone layout, the measured budget's fallback (spec §10): no blur and no brightening, and the generated tint, never the scene's", function () {
		// The composer risen above the grass is named too: its top-level rule outranks a bare #form.
		const surfaces = [...GLASS_SURFACES, ":root.ps-form-tall #form"];

		for (const selector of surfaces) {
			for (const property of ["backdrop-filter", "-webkit-backdrop-filter"]) {
				expect(valueOf(selector, property, PHONE), `${selector} ${property}`).to.equal(
					"none"
				);
			}

			// The scene's tints are solved through brightness(1.3), so without it
			// only the generated tint is proven (--ps-g-tint-a: the legibility
			// model's, which counts no filter); the night glass reads it already.
			expect(valueOf(selector, "--ps-g-tint", PHONE), selector).to.equal(
				"var(--ps-g-tint-a)"
			);
		}

		expect(
			rules
				.filter((r) => r.at === PHONE)
				.flatMap((r) => r.decls)
				.filter(([, v]) => v.includes("--ps-g-tint-") && !v.includes("--ps-g-tint-a")),
			"nothing on the phone reads a scene tint"
		).to.deep.equal([]);
		expect(resolve(paletteOf("day"), "var(--ps-g-tint-a)")).to.equal(String(TINT_CAP));
		expect(resolve(paletteOf("night"), "var(--ps-g-tint-a)")).to.equal("0.74");

		// It wins by coming last: every other rule that gives one of these
		// selectors a tint or a filter (the glass, its tints, the overlaid user
		// list, the risen composer) is written before it, with the same selector.
		// Reduced transparency's solid comes after it and still wins.
		for (const property of ["--ps-g-tint", "backdrop-filter", "-webkit-backdrop-filter"]) {
			const sets = (r: Rule) =>
				r.decls.some(([p]) => p === property) &&
				r.selectors.some((s) => surfaces.includes(s));
			const fallback = rules.findIndex((r) => r.at === PHONE && sets(r));
			const others = rules.filter(
				(r) => r.at !== PHONE && r.at !== REDUCED_TRANSPARENCY && sets(r)
			);
			expect(fallback, `${property}: the fallback sets it`).to.be.at.least(0);
			expect(others.length, `${property}: the rules it overrides`).to.be.at.least(1);

			for (const r of others) {
				expect(rules.indexOf(r), `${property}: ${r.selectors.join(", ")}`).to.be.below(
					fallback
				);
			}
		}
	});

	it("brightens the backdrop by day, only while the scene runs: brightness(1.3) before the saturation, and nowhere else", function () {
		expect(valueOf(DAY_SCENE, "--ps-g-lift")).to.equal(`brightness(${DAY_BRIGHTNESS})`);
		const lifts = rules.filter((r) => r.decls.some(([p]) => p === "--ps-g-lift"));
		expect(
			lifts.map((r) => ({at: r.at, selectors: r.selectors})),
			"no other rule lifts it: not :root (the fallback), not the night"
		).to.deep.equal([{at: "", selectors: [DAY_SCENE]}]);
		// Every blur on the page reads the lift the same way, so none is brightened but by day.
		const filters = rules.flatMap((r) =>
			r.decls.filter(([p, v]) => /backdrop-filter$/.test(p) && v !== "none").map(([, v]) => v)
		);
		expect(filters.length).to.be.at.least(2);
		expect([...new Set(filters)]).to.deep.equal([GLASS_FILTER]);
	});

	for (const selector of SOLID_SURFACES) {
		it(`makes ${selector} solid: --ps-g-solid`, function () {
			expect(valueOf(selector, "background-color")).to.equal("var(--ps-g-solid)");
		});
	}

	it("resolves the solid to #fbf8f2 by day and #121827 at night", function () {
		expect(resolve(paletteOf("day"), "var(--ps-g-solid)")).to.equal("#fbf8f2");
		expect(resolve(paletteOf("night"), "var(--ps-g-solid)")).to.equal("#121827");
	});

	it("keeps the message toolbar solid with the column: :root's window colour by day, the night solid under the light treatment", function () {
		// The toolbar's icons are the column's colours (style.css #chat .msg-action:
		// --body-color-muted), so its box follows the column's treatment, not the
		// chrome's light: style.css paints it --window-bg-color, which is the solid on
		// :root and the night glass's solid inside the column under the light treatment.
		expect(resolve(paletteOf("day"), "var(--window-bg-color)")).to.equal("#fbf8f2");
		expect(valueOf(':root[data-ps-text="light"] #chat .chat', "--window-bg-color")).to.equal(
			"#121827"
		);
	});

	it("gives the dialogs with white text in their .vue files the glass ink, and the drop target", function () {
		for (const selector of WHITE_TEXT_DIALOGS) {
			expect(valueOf(selector, "color"), selector).to.equal("var(--ps-g-ink)");
		}
	});

	it("draws the jump-to-recent disc in the glass ink on the solid", function () {
		expect(valueOf(".scroll-down-arrow", "color")).to.equal("var(--ps-g-ink)");
	});

	it("never puts a backdrop filter on #status-bar-tint or an ancestor of it (html, body)", function () {
		for (const r of rules) {
			const blurs = r.decls.some(([p, v]) => /backdrop-filter$/.test(p) && v !== "none");

			if (blurs) {
				for (const s of r.selectors) {
					expect(s, "a blurred selector").to.not.include("#status-bar-tint");
					expect(s, "a blurred selector").to.not.match(
						/^(html|body|:root)(\[[^\]]*\])*$/
					);
				}
			}
		}

		expect(
			rules.filter((r) => r.selectors.some((s) => s.includes("#status-bar-tint"))),
			"no rule for the tint at all"
		).to.deep.equal([]);
	});

	it("turns the glass solid under prefers-reduced-transparency: no blur, --ps-g-solid, by day and at night", function () {
		for (const selector of GLASS_SURFACES) {
			for (const s of [selector, `${NIGHT} ${selector}`]) {
				expect(valueOf(s, "background-color", REDUCED_TRANSPARENCY), s).to.equal(
					"var(--ps-g-solid)"
				);
				expect(valueOf(s, "backdrop-filter", REDUCED_TRANSPARENCY), s).to.equal("none");
				expect(valueOf(s, "-webkit-backdrop-filter", REDUCED_TRANSPARENCY), s).to.equal(
					"none"
				);
			}
		}
	});

	it("no longer carries plan 1's chrome: the <3 rail, the paper header, the opaque user list", function () {
		expect(css).to.not.match(/#e6d9ff|#ffe3d1/i);
		expect(css).to.not.include("--ps-paper");
		expect(valueOf("#chat .userlist", "background-color")).to.not.equal(
			"var(--window-bg-color)"
		);
		expect(valueOf("#chat .header", "background")).to.equal(undefined);
	});

	it("clears the user list's count row, and veils its sticky headings with the list's own tint instead of the window colour", function () {
		expect(valueOf("#chat .userlist .count", "background-color")).to.equal("transparent");
		expect(valueOf("#chat .userlist .user-mode::before", "background-color")).to.equal(
			TINT_DAY
		);
		expect(valueOf(`${NIGHT} #chat .userlist .user-mode::before`, "background-color")).to.equal(
			TINT_NIGHT
		);
	});

	it("flips day and night over 0.8s, and at once under reduced motion", function () {
		expect(valueOf(DAY, "--ps-flip")).to.equal("0.8s");
		expect(valueOf(DAY, "--ps-flip", "@media (prefers-reduced-motion: reduce)")).to.equal("0s");

		// The jump-to-recent disc keeps style.css's own 0.2s: its fill changes on hover too.
		for (const selector of [
			...GLASS_SURFACES,
			...SOLID_SURFACES.filter((s) => s !== ".scroll-down-arrow"),
		]) {
			const transition = valueOf(selector, "transition") ?? "";

			for (const property of ["background-color", "color", "border-color"]) {
				expect(transition, `${selector} ${property}`).to.include(
					`${property} var(--ps-flip)`
				);
			}
		}
	});
});

/**
 * The chrome's own floors (spec §11): text at 4.5:1, marks and faint text
 * (placeholders, icons) at 3:1. The floors test (test/scenes/ps/legibility.ts)
 * holds the generated glass colours; this holds every other colour the chrome
 * draws, outside the message column, on the ground it draws it on: the solid
 * panels, the fields and washes on them, and the glass over the sparse sweep's
 * grounds — the sky, the bodies and the plains — by day at each surface's
 * computed tint over the brightened backdrop (the luminous glass,
 * client/js/scenes/ps/glass.ts), at night at the declared tint (a row's
 * selected or hovered wash, or a field, composited on top where one is).
 */
describe("the ps theme's chrome keeps its floors on the solid panels and on the glass (spec §6, §11)", function () {
	this.timeout(60000);

	const TEXT = 4.5;
	const MARK = 3;

	type Ground =
		| "solid"
		| "field"
		| "highlight"
		| "glass"
		| "glass+selected"
		| "glass+hover"
		| "glass+field"
		| "glass+tint-soft"
		| "glass+tint-strong";

	/**
	 * Where each wash's colour comes from: the token, read on the surface that
	 * paints it (a glass surface may restate a token for itself; the solid
	 * panels read the palette's).
	 */
	const WASH: Record<Exclude<Ground, "solid" | "glass">, [string, string]> = {
		field: ["", "--composer-bg"],
		highlight: ["", "--highlight-bg-color"],
		"glass+selected": ["#sidebar", "--rail-item-active-bg"],
		"glass+hover": ["#sidebar", "--rail-item-hover-bg"],
		"glass+field": ["#sidebar", "--rail-input-bg"],
		// The composer's reply, upload and connection bars (coffee.css #form .compose-bar…).
		"glass+tint-soft": ["#form", "--tint-soft"],
		// A hovered or keyboard-selected user in the list (coffee.css #chat .userlist .user.active).
		"glass+tint-strong": ["#chat .userlist", "--tint-strong"],
	};

	/** `value` resolved on `surface`: the palette, then what the surface's own rules restate. */
	function resolveOn(light: Light, surface: string, value: string): string {
		const p = paletteOf(light);

		if (surface) {
			const own = [...declsOf(surface)];

			if (light === "night") {
				own.push(...declsOf(`${NIGHT} ${surface}`));
			}

			for (const [name, v] of own) {
				if (name.startsWith("--")) {
					p.set(name, v);
				}
			}
		}

		return resolve(p, value);
	}

	const glassCache = new Map<Light, string[]>();

	/**
	 * The generated blocks' headers, whose pinned moments (their worst grounds,
	 * found by the dense sweep, and the Review Focus pins) join the sparse sweep,
	 * so the worst ground is always among the grounds checked.
	 */
	const headers = ["message-palette", "glass-palette"]
		.map((name) => css.slice(css.indexOf(`/* ps:${name}:start`)))
		.map((block) => block.slice(0, block.indexOf("*/")))
		.join("\n");

	/**
	 * The glass's grounds in one light over the sparse sweep and the pinned
	 * moments, one per colour. By day, the luminous glass as the scene draws
	 * it: each surface's grounds through the brightened backdrop at the tint
	 * that surface takes then (dayGlassGrounds; the declared tint is only the
	 * fallback without the scene, which the legibility test holds). At night,
	 * the declared tint.
	 */
	function glassGrounds(light: Light): string[] {
		if (!glassCache.has(light)) {
			const alpha = Number(resolve(paletteOf(light), "var(--ps-g-tint-a)"));
			const hexes =
				light === "day"
					? dayGlassGrounds("sparse", headers).map((g) => g.hex)
					: withPinned(checkedGrounds("sparse"), headers).glass[light].map((g) =>
							glassGround(g.hex, light, alpha)
					  );
			glassCache.set(light, [...new Set(hexes)]);
		}

		return glassCache.get(light)!;
	}

	function groundsOf(light: Light, ground: Ground): string[] {
		const solid = resolve(paletteOf(light), "var(--ps-g-solid)");

		if (ground === "solid") {
			return [solid];
		}

		if (ground === "glass") {
			return glassGrounds(light);
		}

		const [surface, token] = WASH[ground];
		const wash = resolveOn(light, surface, `var(${token})`);
		return ground === "field" || ground === "highlight"
			? [over(wash, solid)]
			: glassGrounds(light).map((g) => over(wash, g));
	}

	/** What the chrome draws in each token, and on what; coffee.css and style.css name the rules. */
	const USES: Array<{token: string; on: Ground[]; floor: number; what: string}> = [
		{token: "--rail-fg", on: ["glass"], floor: TEXT, what: "a channel's name"},
		{token: "--rail-fg-strong", on: ["glass"], floor: TEXT, what: "the lobby, a mentioned row"},
		{
			token: "--rail-fg-active",
			on: ["glass+selected", "glass+hover", "glass+field"],
			floor: TEXT,
			what: "the open row, a hovered one, the jump-to search",
		},
		{
			token: "--rail-fg-muted",
			on: ["glass", "glass+selected", "glass+hover"],
			floor: TEXT,
			what: "the lobby's nick (style.css .lobby-nick), also the footer's icons",
		},
		// The spec's accent itself (--ps-g-accent, --rail-accent) draws only what no
		// floor covers: the open row's marker, exempt as a redundant cue beside the
		// selected wash and the full ink (ruling, 2026-09-24), the caret and the
		// focus ring's glow. Every accent that has to read is the text accent.
		{
			token: "--ps-g-accent-text",
			on: ["glass", "glass+selected", "glass+hover"],
			floor: MARK,
			what: "the connecting icon (also on the open or hovered lobby row), a chip's focus border",
		},
		{
			token: "--event-quit",
			on: ["glass", "glass+selected", "glass+hover", "solid"],
			floor: TEXT,
			what: "a disconnected or parted row (also open or hovered); a settings error",
		},
		{
			token: "--event-join",
			on: ["glass", "glass+selected", "glass+hover"],
			floor: MARK,
			what: "the connected icon and the subscribed bell (also on the open lobby row), the typing pulse",
		},
		{token: "--event-join", on: ["solid"], floor: TEXT, what: "settings' success note"},
		{
			token: "--nick-default",
			on: ["glass", "glass+tint-strong", "solid", "highlight"],
			floor: TEXT,
			what: "a nick with no colour class (also a hovered one in the list)",
		},
		{
			token: "--body-color",
			on: ["glass", "glass+tint-soft", "solid", "field"],
			floor: TEXT,
			what: "the title, the composer and its bars, panel text, a field",
		},
		{
			token: "--body-color-muted",
			on: ["glass", "glass+tint-soft", "solid"],
			floor: TEXT,
			what: "the topic, the mode headings, the typing strip, the composer's bars, panel notes",
		},
		{token: "--chat-fg", on: ["highlight"], floor: TEXT, what: "a mention in the popover"},
		{
			token: "--chat-fg-faint",
			on: ["glass", "field"],
			floor: MARK,
			what: "placeholders, the user count's icon",
		},
		{token: "--window-heading-color", on: ["solid"], floor: TEXT, what: "a window's headings"},
		{
			token: "--link-color",
			on: ["glass", "solid"],
			floor: TEXT,
			what: "a link in the topic, in Help",
		},
		{
			token: "--button-color",
			on: ["glass", "solid"],
			floor: TEXT,
			what: "a button's label: the sidebar's Join, the panels' buttons",
		},
		{
			token: "--chat-accent",
			on: ["glass", "glass+tint-soft"],
			floor: MARK,
			what: "the send button, the reply bar's rule",
		},
		...[
			"--tok-comment",
			"--tok-keyword",
			"--tok-string",
			"--tok-number",
			"--tok-function",
			"--tok-operator",
			"--tok-punctuation",
			"--tok-tag",
			"--tok-attr",
		].map((token) => ({
			token,
			on: ["field"] as Ground[],
			floor: TEXT,
			what: "code in the Mentions popover",
		})),
	];

	/** Text on an opaque fill of its own. */
	const FILLS: Array<[string, string, string]> = [
		["--rail-badge-fg", "--rail-badge-bg", "the unread and the mention badge"],
		["--button-text-color-hover", "--button-color", "a hovered button"],
		["--note-fg", "--note-bg", "a note"],
		["--warn-fg", "--warn-bg", "a warning"],
		["--error-fg", "--error-bg", "an error"],
		["--ok-fg", "--ok-bg", "a success"],
	];

	for (const light of ["day", "night"] as const) {
		it(`holds every chrome colour on its grounds, ${
			light === "day" ? "by day" : "at night"
		}`, function () {
			const p = paletteOf(light);
			const failures: string[] = [];

			for (const use of USES) {
				const colour = resolve(p, `var(${use.token})`);

				for (const ground of use.on) {
					let worst = {ratio: Infinity, on: ""};

					for (const g of groundsOf(light, ground)) {
						const ratio = contrast(colour, g);

						if (ratio < worst.ratio) {
							worst = {ratio, on: g};
						}
					}

					if (worst.ratio < use.floor) {
						failures.push(
							`${use.token} ${colour} (${use.what}) on ${ground} ${
								worst.on
							}: ${worst.ratio.toFixed(2)} < ${use.floor}`
						);
					}
				}
			}

			// The glass block's nick sweep, on a hovered or keyboard-selected user in the list.
			const block = css.slice(
				css.indexOf("/* ps:glass-palette:start"),
				css.indexOf("/* ps:glass-palette:end */")
			);
			const prefix = light === "day" ? "" : `${NIGHT} `.replace(/[[\]]/g, "\\$&");
			const sweep = [
				...block.matchAll(
					new RegExp(
						`^${prefix}\\.user\\.color-(\\d+) \\{ color: (#[0-9a-f]{6}); \\}`,
						"gm"
					)
				),
			];
			expect(sweep, `the ${light} glass sweep`).to.have.length(32);
			const hovered = groundsOf(light, "glass+tint-strong");

			for (const [, n, hex] of sweep) {
				const ratio = Math.min(...hovered.map((g) => contrast(hex, g)));

				if (ratio < TEXT) {
					failures.push(
						`glass nick color-${n} ${hex} on glass+tint-strong (a hovered user): ${ratio.toFixed(
							2
						)} < ${TEXT}`
					);
				}
			}

			for (const [fg, bg, what] of FILLS) {
				const [f, b] = [resolve(p, `var(${fg})`), resolve(p, `var(${bg})`)];
				const ratio = contrast(f, b);

				if (ratio < TEXT) {
					failures.push(
						`${fg} ${f} on ${bg} ${b} (${what}): ${ratio.toFixed(2)} < ${TEXT}`
					);
				}
			}

			expect(failures, failures.join("\n")).to.deep.equal([]);
		});
	}

	it("solves the day glass's tint for the lightest colours written on it: the soft ink at 4.6, the join green's marks at 3.1, and nothing on the glass lighter", function () {
		const p = paletteOf("day");
		expect(
			resolve(p, "var(--ps-g-soft)"),
			"glass.ts's text is the generated soft ink"
		).to.equal(DAY_GLASS_TEXT);
		expect(resolve(p, "var(--event-join)"), "glass.ts's mark is the join green").to.equal(
			DAY_GLASS_MARK
		);

		/** The lowest ground luminance at which `hex` clears `solve` over a lighter ground. */
		const need = (hex: string, solve: number) => solve * (luminance(hex) + 0.05) - 0.05;
		const solved = Math.max(need(DAY_GLASS_TEXT, TEXT_SOLVE), need(DAY_GLASS_MARK, MARK_SOLVE));
		const block = css.slice(
			css.indexOf("/* ps:glass-palette:start"),
			css.indexOf("/* ps:glass-palette:end */")
		);
		const written: Array<[string, string, number]> = [
			...USES.filter((u) => u.on.some((g) => g.startsWith("glass"))).map(
				(u): [string, string, number] => [
					u.token,
					resolve(p, `var(${u.token})`),
					u.floor === TEXT ? TEXT_SOLVE : MARK_SOLVE,
				]
			),
			["the chips' ink", resolve(p, "var(--ps-g-ink)"), TEXT_SOLVE],
			...[...block.matchAll(/^\.user\.color-(\d+) \{ color: (#[0-9a-f]{6}); \}/gm)].map(
				([, n, hex]): [string, string, number] => [`nick color-${n}`, hex, TEXT_SOLVE]
			),
		];
		expect(written.length).to.be.at.least(32 + 10);

		for (const [what, hex, solve] of written) {
			expect(need(hex, solve), `${what} ${hex} at ${solve}`).to.be.at.most(solved);
		}
	});

	it("keeps every night wash on the glass at least as visible as it measures over plan 3's grounds, and never under 1.02 over the darkest ground", function () {
		// The contrast between the washed and the bare glass over the sparse sweep:
		// its median at least each wash's own, and its lowest above 1.02. A wash
		// toward the glass's own navy measured 1.000 over the darkest sky: it did
		// not show at all. Plan 2 chose each black as visible as the white it
		// replaced (white 11 / 6 / 4 / 8 %: medians 1.41 / 1.21 / 1.14 / 1.28)
		// over the sky and the bodies alone, the sun counted under the horizon and
		// no veil. Over plan 3's grounds — the plains' dark night land, the veil,
		// the sun hidden under the horizon — the same washes measure 1.30 / 1.15 /
		// 1.10 / 1.21, and parity with the white would take 91 / 38 / 24 / 54 %
		// black (task 5 report, a question for the user). Held here at what they
		// measure now, so they never grow fainter.
		const floors: Array<[Exclude<Ground, "solid" | "glass">, number]> = [
			["glass+selected", 1.3],
			["glass+hover", 1.15],
			["glass+tint-soft", 1.1],
			["glass+tint-strong", 1.21],
		];
		const bare = groundsOf("night", "glass");

		for (const [ground, median] of floors) {
			const washed = groundsOf("night", ground);
			const seen = bare.map((g, i) => contrast(g, washed[i])).sort((a, b) => a - b);
			expect(seen[Math.floor(seen.length / 2)], `${ground}, the median`).to.be.at.least(
				median
			);
			expect(seen[0], `${ground}, over the darkest ground`).to.be.at.least(1.02);
		}
	});

	it("carries the glass block's two nick sweeps, 32 each, and they read on the solid and on the Mentions popover's wash", function () {
		const block = css.slice(
			css.indexOf("/* ps:glass-palette:start"),
			css.indexOf("/* ps:glass-palette:end */")
		);

		for (const light of ["day", "night"] as const) {
			const prefix = light === "day" ? "" : `${NIGHT} `.replace(/[[\]]/g, "\\$&");
			const slots = [
				...block.matchAll(
					new RegExp(
						`^${prefix}\\.user\\.color-(\\d+) \\{ color: (#[0-9a-f]{6}); \\}`,
						"gm"
					)
				),
			];
			expect(
				slots.map((m) => Number(m[1])),
				`the glass block's ${light} sweep`
			).to.deep.equal(Array.from({length: 32}, (_, i) => i + 1));

			for (const ground of ["solid", "highlight"] as const) {
				const [g] = groundsOf(light, ground);

				for (const [, n, hex] of slots) {
					expect(contrast(hex, g), `${light} color-${n} on ${ground}`).to.be.at.least(
						TEXT
					);
				}
			}
		}
	});
});

describe("the ps theme's type", function () {
	const fontsBlock = css.slice(
		css.indexOf("/* ps:fonts:start"),
		css.indexOf("/* ps:fonts:end */")
	);

	it("bundles Mulish (upright and italic) and Fraunces, Latin, Latin Extended and Vietnamese, as files that exist", function () {
		const faces = [...fontsBlock.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => m[1]);
		const has = (family: string, style: string) =>
			faces.filter(
				(f) => f.includes(`font-family: ${family}`) && f.includes(`font-style: ${style}`)
			);

		/** Which subset a face is, by its unicode-range as Google serves it. */
		const subsetOf = (face: string) => {
			const range = face.match(/unicode-range:\s*([^;]+);/)?.[1].split(/,\s*/) ?? [];

			return range[0] === "U+0000-00FF"
				? "latin"
				: range[0] === "U+0100-02BA"
				? "latin-ext"
				: range.includes("U+1EA0-1EF9") // ạ … ỹ: "Nguyễn" needs this file
				? "vietnamese"
				: `unknown (${range[0]})`;
		};

		for (const [family, style] of [
			["Mulish", "normal"],
			["Mulish", "italic"],
			["Fraunces", "normal"],
		]) {
			const set = has(family, style);
			// Vietnamese first: where the ranges overlap, the face defined last is
			// tried first, so the Latin files keep drawing what they drew before.
			expect(set.map(subsetOf), `${family} ${style}`).to.deep.equal([
				"vietnamese",
				"latin",
				"latin-ext",
			]);

			for (const face of set) {
				const file = face.match(/url\("ps\/([^"]+\.woff2)"\)/)?.[1];
				expect(file, `${family} ${style} src`).to.be.a("string");
				expect(file, `${family} ${style} file name`).to.match(
					new RegExp(`-${subsetOf(face)}\\.woff2$`)
				);
				expect(fs.existsSync(path.resolve(__dirname, "../../client/themes/ps", file!))).to
					.be.true;
			}
		}

		expect(fs.existsSync(path.resolve(__dirname, "../../client/themes/ps/OFL-Mulish.txt"))).to
			.be.true;
		expect(fs.existsSync(path.resolve(__dirname, "../../client/themes/ps/OFL-Fraunces.txt"))).to
			.be.true;
	});

	it("no longer carries Nunito or Baloo 2", function () {
		expect(css).to.not.match(/Nunito|Baloo/);

		for (const f of [
			"nunito-variable.woff2",
			"nunito-variable-italic.woff2",
			"baloo2-variable.woff2",
			"OFL-Nunito.txt",
			"OFL-Baloo2.txt",
		]) {
			expect(fs.existsSync(path.resolve(__dirname, "../../client/themes/ps", f)), f).to.be
				.false;
		}
	});

	it("sets words in Mulish 500 with 800 for bold, and names in Fraunces 700", function () {
		expect(css).to.match(/font-family:\s*Mulish,[^;]*;\s*font-weight:\s*500;/);
		expect(css).to.match(/font-weight:\s*800;/);
		expect(css).to.match(/font-family:\s*Fraunces,[^;]*;\s*font-weight:\s*700;/);
	});
});

describe("the ps theme's motion", function () {
	it("fades messages in, raises the chrome, glows a mention, and stands down under reduced motion", function () {
		expect(css).to.include("@keyframes ps-fade");
		expect(css).to.match(/#chat \.msg \{[^}]*animation: ps-fade 340ms ease-out backwards/);
		expect(css).to.match(/#chat \.msg\.pending \{[^}]*animation-name: none/);
		expect(css).to.include("@keyframes ps-rise");
		expect(css).to.include("@keyframes ps-glow");
	});

	it("settles an own message up from where its pending copy stood, never through nothing", function () {
		// The echo replaces the pending copy as a new row; fading it in from 0
		// blinked every sent line out and back. It starts at style.css's
		// pending opacity instead, so the row only brightens.
		const style = fs.readFileSync(path.resolve(__dirname, "../../client/css/style.css"), "utf8");
		const pending = /#chat \.msg\.pending \{[^}]*opacity: ([\d.]+);/.exec(style)?.[1];
		expect(pending, "style.css's pending opacity").to.equal("0.55");
		const settle = /@keyframes ps-settle \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "";
		expect(settle).to.include(`from { opacity: ${pending}; }`);
		expect(settle).to.include("to { opacity: 1; }");
		expect(css).to.match(/#chat \.msg\.self:not\(\.pending\) \{[^}]*animation-name: ps-settle;/);
	});

	it("keeps the rest of its motion", function () {
		expect(css).to.include("@keyframes ps-rise");
		expect(css).to.include("@keyframes ps-glow");
		expect(css).to.match(
			/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*animation: none !important/
		);
	});
});

describe("the ps theme has no glitter", function () {
	// The <3 theme burst sparks, hearts and stars off an own message and a
	// reaction's arrival. ps is peace on the plains: the bursts are gone and
	// nothing has replaced them yet (docs/projects/ps-theme.md).
	it("hangs nothing off a message, a reaction or an enter class", function () {
		expect(css, "no burst tokens").to.not.match(/--ps-burst-/);
		expect(css, "no sparkle keyframes").to.not.match(/@keyframes [\w-]*sparkle/);
		expect(css, "no send burst").to.not.match(/\.msg\.self:last-child/);
		expect(css, "no pseudo-element on a message").to.not.match(
			/\.msg\b[^{},]*::(before|after)/
		);
		expect(css, "no pseudo-element on a reaction").to.not.match(
			/msg-reaction[^{},]*::(before|after)/
		);
		expect(css, "no pseudo-element on an enter class").to.not.match(
			/enter-active[^{},]*::(before|after)/
		);
	});

	it("leaves the reaction pop to style.css, restating neither enter class", function () {
		// MessageReactions.vue's Transition wrappers and style.css's 160 ms
		// reaction-pop serve every theme; the <3 theme restated them to hold the
		// class open for its burst (heart-hold), which ps does not need.
		expect(css).to.not.include(".reaction-enter-active");
		expect(css).to.not.include(".reactions-enter-active");
		expect(css, "no do-nothing hold animation").to.not.match(/@keyframes [\w-]*hold\b/);
	});
});

describe("the ps theme's scene", function () {
	const style = fs.readFileSync(path.resolve(__dirname, "../../client/css/style.css"), "utf8");

	it("is hidden by style.css for every theme, and shown by ps", function () {
		expect(style).to.match(/#theme-scene\s*\{\s*display:\s*none;\s*\}/);
		expect(css).to.match(/#theme-scene\s*\{[^}]*display:\s*block;/);
	});

	it("paints daylight when the scene is absent: sky and canvas from the midday stop, and a halo, outside any state selector", function () {
		expect(css).to.match(/#theme-scene\s*\{[^}]*var\(--ps-sky-top,\s*#3f8fe6\)/);
		const root = css.match(/:root\s*\{[^}]*--canvas-bg-color:\s*#3f8fe6;[^}]*\}/);
		expect(root, "a :root block defines the daylight canvas").to.not.equal(null);
		expect(css).to.match(/--ps-halo:\s*#ebf5fd;/);
		expect(css).to.not.match(/\[data-ps-(light|text)[^\]]*\][^{]*\{[^}]*--canvas-bg-color/);
	});

	it("stops every scene animation while paused and under reduced motion", function () {
		expect(css).to.match(
			/#theme-scene\.ps-paused \*\s*\{\s*animation-play-state:\s*paused !important;/
		);
		const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
		expect(reduced).to.match(/#theme-scene \*[^{]*\{\s*animation:\s*none !important;/);
	});

	it("no longer paints a meadow on the message area or reads the channel seed", function () {
		expect(css).to.not.include("--channel-seed");
		expect(css).to.not.include("data-scene");
		expect(css).to.not.include("ps-rainbow");
		expect(css).to.not.include("ps-clouds");
	});
});

describe("the ps theme's words over the plains (spec §7)", function () {
	/** The eight-way ring of offsets `o` (rem) at `pct` % black, blurred 0.0625rem. */
	const ring = (o: string, pct: number) =>
		[
			[o, "0"],
			[`-${o}`, "0"],
			["0", o],
			["0", `-${o}`],
			[o, o],
			[`-${o}`, o],
			[o, `-${o}`],
			[`-${o}`, `-${o}`],
		].map(([x, y]) => `${x} ${y} 0.0625rem rgb(0 0 0 / ${pct}%)`);

	it("draws white words over the soft shadow, the user's B (eight 1px offsets at 78 %) and under it the faint wider ring (eight 2px offsets at 28 %, the user's pick 2026-09-25), in that order: the first shadow paints on top", function () {
		const shadow = valueOf(':root[data-ps-text="light"] #chat .chat .msg', "text-shadow");
		expect(shadow, "the light treatment's text-shadow").to.not.equal(undefined);
		expect(shadow!.split(/,\s*(?![^()]*\))/)).to.deep.equal([
			"0 0.0625rem 0.094rem rgb(0 0 0 / 70%)",
			"0 0 0.1875rem rgb(0 0 0 / 45%)",
			"0 0.0625rem 0.625rem rgb(0 0 0 / 35%)",
			...ring("0.0625rem", 78),
			...ring("0.125rem", 28),
		]);

		for (const other of [
			':root[data-ps-text="light"] #chat .chat .show-more',
			':root[data-ps-text="light"] #chat .chat .search-status',
			':root[data-ps-text="light"] #chat .chat .search-scope-note',
		]) {
			expect(valueOf(other, "text-shadow"), other).to.equal(shadow);
		}
	});
});

describe("the ps theme's plains (plan 3: the land, the river, the near grass, the fireflies)", function () {
	const S = "#theme-scene";

	it("makes the scene a size container, so what travels across it moves in cqw/cqh", function () {
		expect(valueOf(S, "container-type")).to.equal("size");
	});

	it("fills every land area from the colour the palette publishes for it", function () {
		const AREAS: Record<string, string> = {
			"ps-l-mount2": "var(--ps-mount2)",
			"ps-l-mount": "var(--ps-mount)",
			"ps-l-far": "var(--ps-far)",
			"ps-l-shrub": "var(--ps-shrub)",
			"ps-l-riverbed": "var(--ps-riverbed)",
			"ps-l-bedstone": "var(--ps-bedstone)",
			"ps-l-hill2": "var(--ps-hill2)",
			"ps-l-tuft2": "var(--ps-tuft2)",
			"ps-l-tree": "var(--ps-tree)",
			"ps-l-trunk": "var(--ps-trunk)",
			"ps-l-hill1": "var(--ps-hill1)",
			"ps-l-tuft1": "var(--ps-tuft1)",
			"ps-l-tuft-lit": "var(--ps-tuft-lit)",
			"ps-l-grass": "var(--ps-grass)",
		};

		for (const [name, fill] of Object.entries(AREAS)) {
			expect(valueOf(`${S} .${name}`, "fill"), name).to.equal(fill);
		}

		expect(valueOf(`${S} .ps-blades path`, "fill")).to.equal("var(--ps-blade)");
		// The river's sky is its own fill attribute (plains.ts); a class fill would cover it.
		expect(valueOf(`${S} .ps-l-river`, "fill")).to.equal(undefined);
	});

	it("mixes no area colour in CSS: color-mix is left to the lines (the rims, the river's glint)", function () {
		const LINES = [`${S} .ps-l-rim`, `${S} .ps-l-river-hi`];
		const areas = rules.filter((r) =>
			r.selectors.some(
				(sel) =>
					/^#theme-scene \.(ps-l-|ps-blades|ps-ground|ps-fireflies)/.test(sel) &&
					!LINES.includes(sel)
			)
		);
		expect(areas.length, "the land's rules").to.be.at.least(15);

		for (const r of areas) {
			for (const [p, v] of r.decls) {
				expect(v, `${r.selectors.join(", ")} { ${p} }`).to.not.include("color-mix");
			}
		}
	});

	it("runs the river by the season: the water's opacity is --ps-water and the stones' its complement", function () {
		expect(valueOf(`${S} .ps-l-river`, "opacity")).to.match(/^var\(--ps-water(, 1)?\)$/);
		expect(valueOf(`${S} .ps-l-bedstone`, "opacity")).to.match(
			/^calc\(1 - var\(--ps-water(, 1)?\)\)$/
		);
		expect(valueOf(`${S} .ps-l-river-hi`, "opacity")).to.include("var(--ps-water");
		expect(valueOf(`${S} .ps-l-river-hi`, "stroke")).to.equal("var(--ps-river-hi)");
	});

	it("lights the far tufts and the rims from the published levels", function () {
		expect(valueOf(`${S} .ps-l-tuft-lit`, "opacity")).to.equal("var(--ps-tuft-lit-op)");
		expect(valueOf(`${S} .ps-l-rim`, "stroke")).to.equal("var(--ps-glow)");
		expect(valueOf(`${S} .ps-l-rim`, "opacity")).to.include("var(--ps-glow-op");
	});

	it("puts the land on the window's lower 56 % and the near grass on its lower 19 %", function () {
		expect(valueOf(`${S} .ps-land`, "bottom")).to.equal("0");
		expect(valueOf(`${S} .ps-land`, "height")).to.equal("56%");
		expect(valueOf(`${S} .ps-land`, "width")).to.equal("100%");
		expect(valueOf(`${S} .ps-blades`, "bottom")).to.equal("0");
		expect(valueOf(`${S} .ps-blades`, "height")).to.equal("19%");
		expect(valueOf(`${S} .ps-blades`, "width")).to.equal("100%");
	});

	it("keeps the ground group whole and positions what is inside it", function () {
		expect(valueOf(`${S} .ps-ground`, "inset")).to.equal("0");
		expect(valueOf(`${S} .ps-ground > *`, "position")).to.equal("absolute");
	});

	it("fades the flowers by the season and the dark", function () {
		const opacity = valueOf(`${S} .ps-blades circle`, "opacity") ?? "";
		expect(opacity).to.match(/var\(--ps-flowers(, 1)?\)/);
		expect(opacity).to.include("var(--ps-dark)");
	});

	it("sways the blades by the weather's angle with its own keyframes", function () {
		expect(valueOf(`${S} .ps-blades .ps-sway`, "animation")).to.match(/^ps-sway /);
		const frames = css.match(/@keyframes ps-sway\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
		expect(frames).to.include("skewX(");
		expect(frames).to.include("var(--ps-sway");
		expect(css.match(/@keyframes ps-sway\b/g), "one ps-sway").to.have.length(1);
		expect(css, "no bare sway keyframes").to.not.match(/@keyframes sway\b/);
	});

	it("shows the fireflies by the published level, small and drifting in rem", function () {
		expect(valueOf(`${S} .ps-fireflies`, "opacity")).to.match(/^var\(--ps-ff-op(, 0)?\)$/);
		const fly = declsOf(`${S} .ps-fireflies i`);
		expect(fly.length).to.be.greaterThan(0);

		for (const [p, v] of fly) {
			expect(v, `.ps-fireflies i { ${p} }`).to.not.match(/\d px|\dpx/);
		}

		expect(css).to.match(/@keyframes ps-ffdrift\b/);
		expect(css).to.match(/@keyframes ps-ffblink\b/);
	});
});

describe("the ps theme's yurt and its smoke (plan 3, spec §5.3)", function () {
	const S = "#theme-scene";
	const YURT = `${S} .ps-yurt`;
	const SMOKE = `${S} .ps-smoke`;
	/**
	 * The place: what scene.ts measured (yurt.ts clamps it so the whole yurt
	 * is on screen); before that, 70 % of the scene clamped the same way. The
	 * yurt is 21 % of the scene's height tall, so half its width is
	 * 21cqh × 120/170.
	 */
	const PLACE =
		"var(--ps-yurt-left, clamp(calc(21cqh * 120 / 170), 70%, calc(100% - 21cqh * 120 / 170)))";

	it("stands on the ground band at the place the scene measures, 70 % before it has one", function () {
		expect(valueOf(YURT, "left")).to.equal(PLACE);
		expect(valueOf(YURT, "bottom")).to.equal("17%");
		expect(valueOf(YURT, "height")).to.equal("21%");
		expect(valueOf(YURT, "aspect-ratio")).to.equal("240 / 170");
		expect(valueOf(YURT, "transform")).to.equal("translateX(-50%)");
	});

	it("puts the smoke at the pipe, on the same place: the yurt's top plus 22/170 of its height", function () {
		expect(valueOf(SMOKE, "left")).to.equal(PLACE);
		expect(valueOf(SMOKE, "bottom")).to.equal("calc(17% + 21% * 148 / 170)");
		expect(valueOf(SMOKE, "opacity")).to.match(/^var\(--ps-smoke-op(, 0)?\)$/);
	});

	it("never transitions its place: the yurt and the smoke transition opacity only", function () {
		for (const sel of [YURT, SMOKE]) {
			const all = rules.filter((r) => r.selectors.some((s) => s.startsWith(sel)));
			const transitions = all.flatMap((r) =>
				r.decls.filter(([p]) => p.startsWith("transition")).map(([p, v]) => `${p}: ${v}`)
			);
			expect(valueOf(sel, "transition"), sel).to.match(/^opacity [\d.]+s/);

			for (const t of transitions) {
				if (t === "transition: none !important") {
					continue; // reduced motion
				}

				expect(t, sel).to.not.match(/\b(left|transform|inset|all|bottom|translate)\b/);
				expect(t, sel).to.match(/^transition: opacity\b/);
			}

			// Nor may an animation carry it.
			expect(valueOf(sel, "animation"), sel).to.equal(undefined);
		}
	});

	it("hides the yurt and its smoke while it moves (ps-yurt-moving)", function () {
		expect(valueOf(`${S}.ps-yurt-moving .ps-yurt`, "opacity")).to.equal("0");
		expect(valueOf(`${S}.ps-yurt-moving .ps-smoke`, "opacity")).to.equal("0");
	});

	it("fills the felt, roof, band, door and the rest from the colours the palette publishes", function () {
		const PAINT: Array<[string, string, string]> = [
			["ps-y-felt-l", "stop-color", "var(--ps-felt-shade)"],
			["ps-y-felt-c", "stop-color", "var(--ps-felt)"],
			["ps-y-roof-t", "stop-color", "var(--ps-roof-top)"],
			["ps-y-roof-b", "stop-color", "var(--ps-roof-bottom)"],
			["ps-y-band", "fill", "var(--ps-band)"],
			["ps-y-roof", "stroke", "var(--ps-roof-stroke)"],
			["ps-y-band-mark", "fill", "var(--ps-band-mark)"],
			["ps-y-rope", "stroke", "var(--ps-rope)"],
			["ps-y-rib", "stroke", "var(--ps-rib)"],
			["ps-y-door", "fill", "var(--ps-door)"],
			["ps-y-door-orn", "stroke", "var(--ps-door-orn)"],
			["ps-y-crown", "fill", "var(--ps-crown)"],
			["ps-y-pipe", "fill", "var(--ps-pipe)"],
			["ps-y-stone", "fill", "var(--ps-stone)"],
			["ps-y-wood", "fill", "var(--ps-wood)"],
		];

		for (const [name, property, value] of PAINT) {
			expect(valueOf(`${S} .${name}`, property), name).to.equal(value);
		}
	});

	it("mixes no colour in CSS: every yurt and smoke colour is published", function () {
		const own = rules.filter((r) =>
			r.selectors.some((sel) =>
				/^#theme-scene(\.ps-yurt-moving)? \.(ps-yurt|ps-y-|ps-smoke)/.test(sel)
			)
		);
		expect(own.length, "the yurt's rules").to.be.at.least(18);

		for (const r of own) {
			for (const [p, v] of r.decls) {
				expect(v, `${r.selectors.join(", ")} { ${p} }`).to.not.include("color-mix");
			}
		}
	});

	it("snows on the roof by --ps-snowcap and glows at night by --ps-night-glow", function () {
		expect(valueOf(`${S} .ps-y-snow`, "opacity")).to.match(/^var\(--ps-snowcap(, 0)?\)$/);
		expect(valueOf(`${S} .ps-y-lit`, "opacity")).to.match(/^var\(--ps-night-glow(, 0)?\)$/);
		expect(valueOf(`${S} .ps-y-spill`, "opacity")).to.equal(undefined);
	});

	it("lights a pool at the door by --ps-night-glow, the only light before the door (the user's pick, 2026-09-25)", function () {
		expect(valueOf(`${S} .ps-y-pool`, "opacity")).to.match(/^var\(--ps-night-glow(, 0)?\)$/);
	});

	it("draws no worn path to the door, by day or night: nothing reads as a beam (the user, 2026-09-25)", function () {
		// "there is still a beam of light visible from the door, even in the day. there
		// shouldnt be a hard beam, I want the soft glow at the door, and not in the day."
		expect(css).to.not.include("ps-y-path");
		expect(css).to.not.include("--ps-path");
	});

	it("keeps the pool dark by day and lit at night", function () {
		const glowAt = (minute: number) => {
			const m = momentFor({
				minute,
				doy: 270,
				dayNumber: 20723,
				epochDays: 20723,
				weather: "clear",
			});
			return Number(sceneVars(m, paletteAt(m))["--ps-night-glow"]);
		};

		const {rise, set} = sunTimes(270);
		// The pool's opacity is the published glow itself.
		expect(glowAt((rise + set) / 2), "noon").to.equal(0);
		expect(glowAt(30), "midnight").to.be.greaterThan(0.9);
	});

	it("raises the smoke in rem from the published smoke colour", function () {
		const puff = declsOf(`${S} .ps-smoke i`);
		expect(puff.length).to.be.greaterThan(0);
		expect(valueOf(`${S} .ps-smoke i`, "background")).to.include("var(--ps-smoke)");
		// Its own name: the chrome's message entrance is already ps-rise.
		expect(valueOf(`${S} .ps-smoke i`, "animation")).to.match(/^ps-smoke-rise /);
		expect(css.match(/@keyframes ps-smoke-rise\b/g), "one ps-smoke-rise").to.have.length(1);

		for (const [p, v] of puff) {
			expect(v, `.ps-smoke i { ${p} }`).to.not.match(/\dpx/);
		}

		const frames = css.match(/@keyframes ps-smoke-rise\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
		expect(frames).to.include("translate(calc(-50% + 2.125rem), -6rem) scale(3.1)");
		expect(frames).to.not.match(/\dpx/);
	});
});

describe("the ps theme's clouds and weather (plan 3 task 4, spec §5.1, §5.5)", function () {
	const S = "#theme-scene";
	/** Every rule of the clouds, the veil and the weather layer, plain or under a root class. */
	const WEATHER_RULE =
		/^#theme-scene(\.ps-(windy|storm|hot))? \.(ps-cloud|ps-veil|ps-weather|ps-rain|ps-snow|ps-seeds|ps-flash|ps-heatband|ps-heat-haze)\b/;
	const own = rules.filter((r) => r.selectors.some((sel) => WEATHER_RULE.test(sel)));
	const frames = (name: string) =>
		css.match(new RegExp(`@keyframes ${name}\\s*\\{([\\s\\S]*?)\\n\\}`))?.[1] ?? "";

	it("bends the ground with the heat haze only on a hot day, and leaves the near grass out of it", function () {
		expect(valueOf(`${S}.ps-hot .ps-ground`, "filter")).to.equal('url("#ps-heat")');
		expect(valueOf(`${S} .ps-ground`, "filter")).to.equal(undefined);
		// Nothing else takes the haze, and nothing filters the blades.
		const hazed = rules.filter((r) => r.decls.some(([, v]) => v.includes("#ps-heat")));
		expect(hazed.map((r) => r.selectors)).to.deep.equal([[`${S}.ps-hot .ps-ground`]]);
		const blades = rules.filter((r) => r.selectors.some((sel) => sel.includes(".ps-blades")));
		expect(blades.flatMap((r) => r.decls).filter(([p]) => p === "filter")).to.deep.equal([]);
	});

	it("keeps the haze's svg in the page but out of sight: no size, never display: none", function () {
		const decls = declsOf(`${S} .ps-heat-haze`);
		expect(decls.length).to.be.greaterThan(0);
		expect(valueOf(`${S} .ps-heat-haze`, "width")).to.equal("0");
		expect(valueOf(`${S} .ps-heat-haze`, "height")).to.equal("0");
		expect(decls.filter(([p]) => p === "display")).to.deep.equal([]);
	});

	it("speeds the blades to 2.4 s and the clouds to 0.4 of their time on a windy day", function () {
		expect(valueOf(`${S}.ps-windy .ps-blades .ps-sway`, "animation-duration")).to.equal("2.4s");
		expect(valueOf(`${S}.ps-windy .ps-cloud`, "animation-duration")).to.equal(
			"calc(var(--cd) * 0.4)"
		);
	});

	it("drifts each cloud across the scene at its own height, in cqw", function () {
		expect(valueOf(`${S} .ps-cloud-field`, "inset")).to.equal("0");
		expect(valueOf(`${S} .ps-cloud`, "position")).to.equal("absolute");
		expect(valueOf(`${S} .ps-cloud`, "top")).to.equal("var(--cy)");
		expect(valueOf(`${S} .ps-cloud`, "width")).to.equal("var(--cw)");
		expect(valueOf(`${S} .ps-cloud`, "height")).to.equal("calc(var(--cw) * 0.42)");
		expect(valueOf(`${S} .ps-cloud`, "animation")).to.equal(
			"ps-drift var(--cd) linear var(--cdl) infinite"
		);
		// A cloud stands at left: 0, so it enters and leaves out of sight only
		// if the loop starts a whole cloud (and its blur) past the left edge
		// and ends past the right one: starting at -30% put 70% of it on the
		// screen at once, and every loop popped it in.
		const drift = frames("ps-drift");
		expect(drift).to.include("from { transform: translateX(calc(-100% - 0.25rem)); }");
		expect(drift).to.include("to { transform: translateX(calc(100cqw + 0.25rem)); }");
	});

	it("paints the clouds from the published cloud colours, greyed by the weather in the palette", function () {
		expect(valueOf(`${S} .ps-cloud i`, "background")).to.equal(
			"linear-gradient(180deg, var(--ps-cloud) 40%, var(--ps-cloud-under) 100%)"
		);
	});

	it("veils the scene in the weather's colour and opacity, --ps-veil-c and --ps-veil", function () {
		expect(valueOf(`${S} .ps-veil`, "inset")).to.equal("0");
		expect(valueOf(`${S} .ps-veil`, "background")).to.match(/^var\(--ps-veil-c(, #5a6478)?\)$/);
		expect(valueOf(`${S} .ps-veil`, "opacity")).to.match(/^var\(--ps-veil(, 0)?\)$/);
	});

	it("shows each weather's particles at the weather's own level", function () {
		expect(valueOf(`${S} .ps-rain`, "opacity")).to.match(/^var\(--ps-rain-op(, 0)?\)$/);
		expect(valueOf(`${S} .ps-snow`, "opacity")).to.match(/^var\(--ps-snow-op(, 0)?\)$/);
		expect(valueOf(`${S} .ps-seeds`, "opacity")).to.match(/^var\(--ps-wind-op(, 0)?\)$/);
		expect(valueOf(`${S} .ps-heatband`, "opacity")).to.match(/^var\(--ps-heat-op(, 0)?\)$/);
	});

	it("flashes the lightning only under .ps-storm, the mockup's 9 s", function () {
		expect(valueOf(`${S} .ps-flash`, "animation")).to.equal(undefined);
		expect(valueOf(`${S} .ps-flash`, "opacity")).to.equal("0");
		expect(valueOf(`${S}.ps-storm .ps-flash`, "animation")).to.equal(
			"ps-flash 9s linear infinite"
		);
		const flash = frames("ps-flash");
		expect(flash).to.match(/0%,\s*90%,\s*100%\s*\{\s*opacity:\s*0;/);
		expect(flash).to.match(/91%\s*\{\s*opacity:\s*0\.5;/);
	});

	it("moves the rain, the snow and the seeds in cqw/cqh from the mockup's 1180 × 700 window", function () {
		expect(valueOf(`${S} .ps-rain i`, "animation")).to.equal(
			"ps-drop var(--rd) linear var(--rdl) infinite"
		);
		expect(frames("ps-drop")).to.include("translate(-3.9cqw, 118cqh)");
		expect(valueOf(`${S} .ps-snow i`, "animation")).to.equal(
			"ps-flake var(--fd) linear var(--fdl) infinite"
		);
		expect(frames("ps-flake")).to.include("translate(var(--fx), 114.3cqh)");
		expect(valueOf(`${S} .ps-seeds i`, "animation")).to.equal(
			"ps-seed var(--sd) linear var(--sdl) infinite"
		);
		expect(frames("ps-seed")).to.include("translate(111.9cqw, var(--sy))");
	});

	it("puts no px in a translate of these rules or their keyframes: travel in cqw/cqh, marks in rem", function () {
		expect(own.length, "the clouds' and the weather's rules").to.be.at.least(14);

		for (const r of own) {
			for (const [p, v] of r.decls) {
				expect(v, `${r.selectors.join(", ")} { ${p} }`).to.not.match(/\dpx/);
			}
		}

		for (const name of [
			"ps-drift",
			"ps-drop",
			"ps-flake",
			"ps-seed",
			"ps-shimmer",
			"ps-flash",
		]) {
			const body = frames(name);
			expect(body, name).to.not.equal("");
			expect(body, name).to.not.match(/\dpx/);

			for (const t of body.match(/translate[XY]?\([^;]*\)/g) ?? []) {
				expect(t, name).to.match(/cq[wh]|%|\b0\b|var\(/);
			}
		}
	});

	it("mixes no area colour in CSS: the clouds and the veil are published colours", function () {
		expect(own.length, "the clouds' and the weather's rules").to.be.at.least(14);

		for (const r of own) {
			for (const [p, v] of r.decls) {
				expect(v, `${r.selectors.join(", ")} { ${p} }`).to.not.include("color-mix");
			}
		}
	});

	it("keeps its keyframes' names its own, once each", function () {
		for (const name of [
			"ps-drift",
			"ps-drop",
			"ps-flake",
			"ps-seed",
			"ps-shimmer",
			"ps-flash",
		]) {
			expect(css.match(new RegExp(`@keyframes ${name}\\b`, "g")), name).to.have.length(1);
		}
	});
});

describe("the ps theme's birds (plan 3 task 6, spec §5.4: the user's N2, D1 buzzard and D2 larks)", function () {
	const S = "#theme-scene";
	/** Every rule of the birds, plain or under a root class. */
	const BIRD_RULE =
		/^#theme-scene(\.ps-west)? \.(ps-skeins|ps-bird-defs|ps-flock|ps-skein|ps-skein-sway|ps-bird|ps-daybirds|ps-buzzard|ps-lark|ps-lark-track|ps-lark-bird)\b/;
	const own = rules.filter((r) => r.selectors.some((sel) => BIRD_RULE.test(sel)));
	const FRAMES = [
		"ps-skein-fly",
		"ps-skein-west",
		"ps-skein-sway",
		"ps-bird-wander",
		"ps-buzz-drift",
		"ps-lark-fly",
		"ps-lark-fl",
		"ps-lark-ch",
		"ps-lark-cl",
	];
	const frames = (name: string) =>
		css.match(new RegExp(`@keyframes ${name}\\s*\\{([\\s\\S]*?)\\n\\}`))?.[1] ?? "";

	it("shows the skeins' layer at the published level, on the sky above the land, fading over 1.4 s", function () {
		expect(valueOf(`${S} .ps-skeins`, "inset")).to.equal("0 0 45%");
		expect(valueOf(`${S} .ps-skeins`, "opacity")).to.equal("var(--ps-skeins-op, 0)");
		expect(valueOf(`${S} .ps-skeins`, "transition")).to.equal("opacity 1.4s ease");
	});

	it("keeps the belly gradient's svg in the page but of no size, never display: none", function () {
		expect(valueOf(`${S} .ps-bird-defs`, "width")).to.equal("0");
		expect(valueOf(`${S} .ps-bird-defs`, "height")).to.equal("0");
		expect(declsOf(`${S} .ps-bird-defs`).filter(([p]) => p === "display")).to.deep.equal([]);
	});

	it("flies the first --ps-skein-count flocks, a rem box each, across the scene in cqw", function () {
		expect(valueOf(`${S} .ps-flock`, "top")).to.equal("var(--fy)");
		expect(valueOf(`${S} .ps-flock`, "width")).to.equal("12.5rem");
		expect(valueOf(`${S} .ps-flock`, "height")).to.equal("5.625rem");
		expect(valueOf(`${S} .ps-flock`, "opacity")).to.equal(
			"clamp(0, var(--ps-skein-count, 0) - var(--fi), 1)"
		);
		expect(valueOf(`${S} .ps-flock`, "transition")).to.equal("opacity 1.8s ease");
		expect(valueOf(`${S} .ps-flock`, "animation")).to.equal(
			"ps-skein-fly var(--fd) linear var(--fdl) infinite"
		);
		// The mockup's −240 → 1340 px of its 1180 px window: its 200 px box
		// and 40 px (3.4cqw) more off the left edge, 160 px (13.6cqw) past the right.
		const fly = frames("ps-skein-fly");
		expect(fly).to.match(/from\s*\{\s*transform:\s*translateX\(calc\(-100% - 3\.4cqw\)\);/);
		expect(fly).to.match(/to\s*\{\s*transform:\s*translateX\(113\.6cqw\);/);
	});

	it("mirrors the whole flock to fly west under ps-west, over the same track the other way", function () {
		expect(valueOf(`${S}.ps-west .ps-flock`, "animation-name")).to.equal("ps-skein-west");
		const west = frames("ps-skein-west");
		expect(west).to.match(/from\s*\{\s*transform:\s*translateX\(113\.6cqw\) scaleX\(-1\);/);
		expect(west).to.match(
			/to\s*\{\s*transform:\s*translateX\(calc\(-100% - 3\.4cqw\)\) scaleX\(-1\);/
		);
	});

	it("rests a flock where its flight starts, off the scene's edge, so a stopped flock is never parked on the sky", function () {
		expect(valueOf(`${S} .ps-flock`, "transform")).to.equal("translateX(calc(-100% - 3.4cqw))");
		expect(valueOf(`${S}.ps-west .ps-flock`, "transform")).to.equal(
			"translateX(113.6cqw) scaleX(-1)"
		);
	});

	it("scales and pales each skein from its leader's end, and sways it with keyframes of its own", function () {
		expect(valueOf(`${S} .ps-skein`, "transform")).to.equal("scale(var(--fs, 1))");
		expect(valueOf(`${S} .ps-skein`, "transform-origin")).to.equal("100% 50%");
		expect(valueOf(`${S} .ps-skein`, "opacity")).to.equal("var(--fo, 1)");
		expect(valueOf(`${S} .ps-skein-sway`, "animation")).to.equal(
			"ps-skein-sway var(--sd) ease-in-out var(--sdl) infinite alternate"
		);
		expect(frames("ps-skein-sway")).to.include("translateY(-0.3125rem) rotate(-1.4deg)");
		expect(frames("ps-skein-sway")).to.include("translateY(0.375rem) rotate(1.2deg)");
		// Not the grass's: the approved mockup named these `sway` and the later one won.
		expect(own.flatMap((r) => r.decls).filter(([, v]) => /\bps-sway\b/.test(v))).to.deep.equal(
			[]
		);
	});

	it("paints the skeins in the moonlit colours scene.ts publishes, the alpha on the whole bird", function () {
		expect(valueOf(`${S} .ps-bird svg`, "opacity")).to.equal("var(--ps-bird-alpha, 0.8)");
		expect(valueOf(`${S} .ps-bird svg`, "overflow")).to.equal("visible");
		expect(valueOf(`${S} .ps-bird .ps-b-far`, "fill")).to.equal("var(--ps-bird-wing)");
		expect(valueOf(`${S} .ps-bird .ps-b-far`, "opacity")).to.equal("0.55");
		expect(valueOf(`${S} .ps-bird .ps-b-near`, "fill")).to.equal("var(--ps-bird-wing)");
		expect(valueOf(`${S} .ps-bird .ps-b-body`, "fill")).to.equal('url("#ps-b-belly")');
		expect(valueOf(`${S} .ps-bird`, "animation")).to.equal(
			"ps-bird-wander var(--wd) ease-in-out var(--wdl) infinite alternate"
		);
	});

	it("inks the day birds from --ps-db-ink, each shown by its own published switch", function () {
		expect(valueOf(`${S} .ps-daybirds svg`, "fill")).to.equal("var(--ps-db-ink)");
		expect(valueOf(`${S} .ps-daybirds .ps-b-far`, "opacity")).to.equal("0.55");
		expect(valueOf(`${S} .ps-daybirds > div`, "transition")).to.equal("opacity 1.4s ease");
		expect(valueOf(`${S} .ps-buzzard`, "opacity")).to.equal("var(--ps-buzzard-op, 0)");
		expect(valueOf(`${S} .ps-lark`, "opacity")).to.equal("var(--ps-lark-op, 0)");
	});

	it("circles the buzzard at the mockup's place and size, drifting with the wind in cqw/cqh", function () {
		expect(valueOf(`${S} .ps-buzzard`, "left")).to.equal("29%");
		expect(valueOf(`${S} .ps-buzzard`, "top")).to.equal("17%");
		expect(valueOf(`${S} .ps-buzzard`, "width")).to.equal("8.125rem");
		expect(valueOf(`${S} .ps-buzzard`, "height")).to.equal("4.375rem");
		expect(valueOf(`${S} .ps-buzzard`, "animation")).to.equal(
			"ps-buzz-drift 170s ease-in-out -70s infinite alternate"
		);
		expect(frames("ps-buzz-drift")).to.include("translate(-5.08cqw, 1.14cqh)");
		expect(frames("ps-buzz-drift")).to.include("translate(5.93cqw, -1.43cqh)");
	});

	it("raises the larks up their own track and rests them hidden, so a stopped lark is never left in the grass", function () {
		expect(valueOf(`${S} .ps-lark`, "top")).to.equal("24%");
		expect(valueOf(`${S} .ps-lark`, "height")).to.equal("62%");
		expect(valueOf(`${S} .ps-lark`, "width")).to.equal("0.75rem");
		expect(valueOf(`${S} .ps-lark-track`, "opacity")).to.equal("0");
		expect(valueOf(`${S} .ps-lark-track`, "animation")).to.equal(
			"ps-lark-fly var(--ld) ease-in-out var(--ldl) infinite"
		);
		expect(valueOf(`${S} .ps-lark-bird`, "width")).to.equal("0.8125rem");
		expect(valueOf(`${S} .ps-lark-bird`, "height")).to.equal("0.5688rem");
		const fly = frames("ps-lark-fly");
		expect(fly).to.include("translate(0.375rem, -24%)");
		expect(fly).to.include("translate(-0.6875rem, -94%)");

		for (const set of ["fl", "ch", "cl"]) {
			expect(valueOf(`${S} .ps-lark .ps-lark-${set}`, "animation"), set).to.equal(
				`ps-lark-${set} var(--ld) steps(1, end) var(--ldl) infinite`
			);
		}
	});

	it("puts no px in the birds' rules or their keyframes: travel in cqw/cqh or %, marks in rem", function () {
		expect(own.length, "the birds' rules").to.be.at.least(18);

		for (const r of own) {
			for (const [p, v] of r.decls) {
				expect(v, `${r.selectors.join(", ")} { ${p} }`).to.not.match(/\dpx/);
				expect(v, `${r.selectors.join(", ")} { ${p} }`).to.not.include("color-mix");
			}
		}

		for (const name of FRAMES) {
			const body = frames(name);
			expect(body, name).to.not.equal("");
			expect(body, name).to.not.match(/\dpx/);

			for (const t of body.match(/translate[XY]?\([^;]*\)/g) ?? []) {
				expect(t, name).to.match(/cq[wh]|%|rem|\b0\b|var\(/);
			}
		}
	});

	it("keeps its keyframes' names its own, once each", function () {
		for (const name of FRAMES) {
			expect(css.match(new RegExp(`@keyframes ${name}\\b`, "g")), name).to.have.length(1);
		}
	});
});

describe("the ps theme's animals", function () {
	/** The cast (tools/heart/README.md); the teddy and the dolphin are held. */
	const CAST = ["horse", "deer", "puppy", "bunny", "kitten", "frog", "ladybug", "bird"];

	it("declares the eight animals' files, and every file it names exists", function () {
		for (const animal of CAST) {
			expect(css).to.include(`--ps-${animal}: url("ps/${animal}.svg");`);
			expect(css).to.include(`--ps-${animal}-far: url("ps/${animal}-far.svg");`);
			expect(css, `--ps-${animal}-h`).to.match(new RegExp(`--ps-${animal}-h: \\d*\\.\\d+;`));
		}

		for (const [, file] of css.matchAll(/url\("(ps\/[^"]+\.svg)"\)/g)) {
			expect(
				fs.existsSync(path.resolve(__dirname, "../../client/themes/", file)),
				`${file} exists`
			).to.be.true;
		}

		// The teddy bear and the dolphin were held: their rigs stay, their
		// files are gone (test/tools/heart/files.ts), and the theme must not
		// reach for either. Tokens and urls, not the bare word — the docs may
		// well end up explaining in a comment here why neither is cast.
		for (const held of ["teddy", "dolphin"]) {
			expect(css, `no --ps-${held} token`).to.not.include(`--ps-${held}`);
			expect(css, `no ps/${held} file`).to.not.include(`url("ps/${held}`);
		}
	});
});

describe("the ps theme's animals, switched off in the scene's animal layer", function () {
	it("casts a horse and a bunny near and a deer far off", function () {
		const root = css.match(/:root\s*\{[^}]*--ps-slot-a:[^}]*\}/)?.[0] ?? "";
		expect(root).to.include("--ps-slot-a: var(--ps-horse);");
		expect(root).to.include("--ps-slot-b: var(--ps-bunny);");
		expect(root).to.include("--ps-slot-f: var(--ps-deer-far);");
	});

	it("paints the three slots as the animal layer's background layers", function () {
		const layer = css.match(/#theme-scene \.ps-animals\s*\{[^}]*\}/)?.[0] ?? "";
		expect(layer).to.match(
			/background-image:\s*var\(--ps-slot-b\),\s*var\(--ps-slot-a\),\s*var\(--ps-slot-f\);/
		);
	});

	it("empties every slot with one block after the cast, which nothing after it undoes", function () {
		const off =
			/#theme-scene \.ps-animals\s*\{\s*--ps-slot-a:\s*none;\s*--ps-slot-b:\s*none;\s*--ps-slot-f:\s*none;\s*\}/g;
		const matches = [...css.matchAll(off)];
		expect(matches, "exactly one off block").to.have.length(1);
		const after = css.slice(matches[0].index! + matches[0][0].length);
		expect(after).to.not.match(/--ps-slot-[abf]:\s*var\(/);
	});
});

/**
 * The rig-to-CSS coupling, from the rigs' side.
 *
 * An animal's size and travel on screen are four numbers that have to move
 * together: the rig's `viewBox.h` and `stage.aspect`, the theme's
 * `--ps-<animal>-h`, and the far slot the cast gives it. The generator's
 * audit can see the two in the rig and nothing at all in the stylesheet, and
 * that gap has already cost a round — four boxes grew to stop clipping their
 * animals (`lib/build.mjs` `boxOverflow`) and every one of them needed a
 * hand-made edit here that nothing would have missed if it had been skipped.
 *
 * So each cast rig records what the theme must say (`theme` in
 * `tools/heart/rigs/<animal>.mjs`) and this block derives the expectation
 * from it rather than restating it: grow a box, forget the token, and the
 * failure names the number to write.
 */
describe("the ps theme's animals are the size their rigs say", function () {
	/** The cast, by the name its tokens and files use. */
	const RIGS: Record<string, any> = {horse, deer, puppy, bunny, kitten, frog, ladybug, bird};

	/** A distant visitor is 0.7 of its animal (the animal tokens' comment in ps.css). */
	const FAR_RATIO = 0.7;

	/** The :root block that casts the scene's animal layer. */
	const cast = () => {
		const block = css.match(/:root\s*\{[^}]*--ps-slot-a:[^}]*\}/);
		expect(block, "the cast's :root block").to.not.equal(null);
		return block![0];
	};

	for (const [name, def] of Object.entries(RIGS)) {
		describe(name, function () {
			it("was sized against the box the rig still has", function () {
				expect(def.theme, `${name}'s rig declares no theme block`).to.be.an("object");
				const {height, box} = def.theme;
				const now = def.rig.viewBox.h;
				expect(
					box,
					`${name}'s box is ${now} but --ps-${name}-h (${height}) was picked ` +
						`against ${box}: scale the token by ${now}/${box} to ` +
						`${Number(((height * now) / box).toFixed(4))}, scale stage.aspect by ` +
						`${box}/${now}, and set theme.box to ${now}`
				).to.equal(now);
			});

			it("is the height in ps.css that its rig says it is", function () {
				expect(css, `--ps-${name}-h`).to.include(`--ps-${name}-h: ${def.theme.height};`);
			});

			it("crosses the stage width its rig says it does", function () {
				const width = def.sequence.stage.aspect * def.rig.viewBox.h;
				expect(
					Math.abs(width - def.theme.stageWidth) / def.theme.stageWidth,
					`${name}'s stage is aspect ${def.sequence.stage.aspect} × box ` +
						`${def.rig.viewBox.h} = ${width.toFixed(1)} rig units, not the ` +
						`${def.theme.stageWidth} it was drawn for: scale stage.aspect to ` +
						`${Number((def.theme.stageWidth / def.rig.viewBox.h).toFixed(4))}`
				).to.be.below(0.001);
			});
		});
	}

	it("gives each near slot the height token of the animal in it", function () {
		const body = cast();

		for (const slot of ["a", "b"]) {
			const animal = body.match(new RegExp(`--ps-slot-${slot}: var\\(--ps-([a-z]+)\\);`));
			expect(animal, `slot ${slot} casts an animal`).to.not.equal(null);
			expect(body, `slot ${slot} is a ${animal![1]}`).to.include(
				`--ps-slot-${slot}-h: var(--ps-${animal![1]}-h);`
			);
		}
	});

	it("derives the distant visitor's height from its animal's own token", function () {
		const body = cast();
		const animal = body.match(/--ps-slot-f: var\(--ps-([a-z]+)-far\);/);
		expect(animal, "slot f casts a distant visitor").to.not.equal(null);
		expect(body, `the visitor is a ${animal![1]}`).to.include(
			`--ps-slot-f-h: calc(${FAR_RATIO} * var(--ps-${animal![1]}-h));`
		);
	});
});
