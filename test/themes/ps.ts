import {expect} from "chai";
import fs from "fs";
import path from "path";
import {contrast, hexRgb, rgbHex} from "../../client/js/scenes/ps/colour";
import {checkedGrounds, glassGround, type Light} from "../../tools/ps/legibility";
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

const TINT_DAY = "rgb(255 251 244 / var(--ps-g-tint-a))";
const TINT_NIGHT = "rgb(12 17 32 / var(--ps-g-tint-a))";

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
				"--ps-g-selected": "rgb(255 255 255 / 11%)",
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
		const PHONE =
			"@media (max-width: 768px), (max-height: 500px) and (hover: none) and (pointer: coarse)";
		const style = fs.readFileSync(
			path.resolve(__dirname, "../../client/css/style.css"),
			"utf8"
		);
		expect(style, "style.css's phone block, the same list").to.include(`${PHONE} {`);
		expect(valueOf("#sidebar-overlay", "inset-inline-start", PHONE)).to.equal(
			"var(--sidebar-width)"
		);
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
				expect(valueOf(selector, property), property).to.include("blur(0.625rem)");
			}
		});
	}

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

	it("clears the user list's count row, and veils its sticky headings with the tint instead of the window colour", function () {
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
 * sky and bodies at the declared tint (a row's selected or hovered wash, or a
 * field, composited on top where one is).
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
		| "glass+field";

	/** Where each ground's colour comes from, over what. */
	const WASH: Record<Exclude<Ground, "solid" | "glass">, string> = {
		field: "--composer-bg",
		highlight: "--highlight-bg-color",
		"glass+selected": "--rail-item-active-bg",
		"glass+hover": "--rail-item-hover-bg",
		"glass+field": "--rail-input-bg",
	};

	const glassCache = new Map<Light, string[]>();

	/** The glass's grounds in one light: the sparse sweep under the declared tint, one per colour. */
	function glassGrounds(light: Light): string[] {
		if (!glassCache.has(light)) {
			const alpha = Number(resolve(paletteOf(light), "var(--ps-g-tint-a)"));
			const hexes = checkedGrounds("sparse").glass[light].map((g) =>
				glassGround(g.hex, light, alpha)
			);
			glassCache.set(light, [...new Set(hexes)]);
		}

		return glassCache.get(light)!;
	}

	function groundsOf(light: Light, ground: Ground): string[] {
		const p = paletteOf(light);
		const solid = resolve(p, "var(--ps-g-solid)");

		switch (ground) {
			case "solid":
				return [solid];
			case "field":
			case "highlight":
				return [over(resolve(p, `var(${WASH[ground]})`), solid)];
			case "glass":
				return glassGrounds(light);
			default:
				return glassGrounds(light).map((g) => over(resolve(p, `var(${WASH[ground]})`), g));
		}
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
		{token: "--rail-fg-muted", on: ["glass"], floor: MARK, what: "the footer's icons"},
		// The spec's accent itself (--ps-g-accent, --rail-accent) draws only what no
		// floor covers: the open row's marker, exempt as a redundant cue beside the
		// selected wash and the full ink (ruling, 2026-09-24), the caret and the
		// focus ring's glow. Every accent that has to read is the text accent.
		{
			token: "--ps-g-accent-text",
			on: ["glass"],
			floor: MARK,
			what: "the connecting icon, a chip's hover and focus border",
		},
		{
			token: "--event-quit",
			on: ["glass", "solid"],
			floor: TEXT,
			what: "a disconnected or parted row; a settings error",
		},
		{token: "--event-join", on: ["glass"], floor: MARK, what: "the connected and typing icons"},
		{token: "--event-join", on: ["solid"], floor: TEXT, what: "settings' success note"},
		{
			token: "--nick-default",
			on: ["glass", "solid", "highlight"],
			floor: TEXT,
			what: "a nick with no colour class",
		},
		{
			token: "--body-color",
			on: ["glass", "solid", "field"],
			floor: TEXT,
			what: "the title, the composer, panel text, a field",
		},
		{
			token: "--body-color-muted",
			on: ["glass", "solid"],
			floor: TEXT,
			what: "the topic, the mode headings, the typing strip, panel notes",
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
		{token: "--chat-accent", on: ["glass"], floor: MARK, what: "the send button"},
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

	it("bundles Mulish (upright and italic) and Fraunces, Latin and Latin Extended, as files that exist", function () {
		const faces = [...fontsBlock.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => m[1]);
		const has = (family: string, style: string) =>
			faces.filter(
				(f) => f.includes(`font-family: ${family}`) && f.includes(`font-style: ${style}`)
			);

		for (const [family, style] of [
			["Mulish", "normal"],
			["Mulish", "italic"],
			["Fraunces", "normal"],
		]) {
			const set = has(family, style);
			expect(set, `${family} ${style}`).to.have.length(2); // latin + latin-ext

			for (const face of set) {
				expect(face).to.match(/unicode-range:\s*U\+/);
				const file = face.match(/url\("ps\/([^"]+\.woff2)"\)/)?.[1];
				expect(file, `${family} ${style} src`).to.be.a("string");
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
