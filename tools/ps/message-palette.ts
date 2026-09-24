/* eslint-disable no-console */
/**
 * The ps theme's message palette (docs/projects/ps-theme.md §7, §11): every
 * text colour the message column reads, in both treatments, generated so that
 * each clears its floor on the worst ground its treatment can meet.
 *
 *   npx tsx tools/ps/message-palette.ts           print the block and the two worst grounds
 *   npx tsx tools/ps/message-palette.ts --write   write the block into client/themes/ps.css
 *
 * Run from the repository root. A colour keeps its base's OKLCH hue and
 * chroma, and only its lightness is solved: for ink (daylight), the lightest
 * that still clears FLOOR on the darkest daytime ground; for light (while the
 * light changes, and all night), the darkest that clears it on the brightest.
 * The grounds are tools/ps/legibility.ts's, the same ones the floors test
 * (test/scenes/ps/legibility.ts) holds the written block to. Nothing here is
 * random, so a second --write changes nothing.
 */
import {readFileSync, writeFileSync} from "node:fs";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {contrast} from "../../client/js/scenes/ps/colour";
import {checkedGrounds, type CheckedGround} from "./legibility";
import {hexToOklch, oklchToHex} from "./oklch";

type Treatment = "ink" | "light";

export const CSS_PATH = resolve("client/themes/ps.css");
const START = "/* ps:message-palette:start";
const END = "/* ps:message-palette:end */";
/** Where the block goes the first time: the end of the scene section. */
const FIRST_ANCHOR = "/* ---- animals ---- */";

/** 4.5:1 and 0.1 of margin, so rounding to a hex byte never lands under the floor. */
const FLOOR = 4.6;
const ITERATIONS = 40;

/**
 * The message column's semantic tokens, by the base each is solved from.
 * coffee.css maps TheLounge's names onto these (--link-color: var(--chat-accent)
 * and so on) on :root, where they resolve once; so every alias the message
 * column reads is restated here by name, or it would keep :root's colour.
 */
const SEMANTIC: Array<{names: string[]; base: string}> = [
	{names: ["--chat-fg-muted", "--body-color-muted", "--date-marker-color"], base: "#536a8e"},
	{
		names: [
			"--chat-accent",
			"--link-color",
			"--unread-marker-color",
			"--highlight-border-color",
			"--button-color",
			"--action-color",
		],
		base: "#b9376b",
	},
	{names: ["--event-join", "--channel-typing-color"], base: "#1f7354"},
	{names: ["--event-quit"], base: "#b8362a"},
	{names: ["--notice-color"], base: "#0e7676"},
	{names: ["--nick-default", "--channel-activity-color"], base: "#2160c8"},
];

/** The spec's own colours (§7), never solved: the floors test holds them as they are. */
const FIXED: Record<Treatment, Record<string, string>> = {
	ink: {
		"--chat-fg": "#1b2638",
		"--body-color": "#1b2638",
		"--md-code-color": "#1b2638",
		"--chat-fg-faint": "#4c5a72",
	},
	light: {
		"--chat-fg": "#ffffff",
		"--body-color": "#ffffff",
		"--md-code-color": "#ffffff",
		"--chat-fg-faint": "rgb(255 255 255 / 80%)",
	},
};

/**
 * The code highlighter's tokens, solved for the light treatment only. By day a
 * code block keeps its paper box and :root's token colours with it; at night
 * the box goes dark (the rule after the block), where those colours fall to
 * about 3:1, so they get light ones. Their bases are :root's own values.
 */
function codeTokens(css: string): Array<{names: string[]; base: string}> {
	const tokens = css.slice(0, css.indexOf("/* ---- nick palette ---- */"));
	const out = [...tokens.matchAll(/^\t(--tok-[a-z]+): (#[0-9a-f]{6});$/gm)].map((m) => ({
		names: [m[1]],
		base: m[2],
	}));

	if (out.length === 0) {
		throw new Error("no --tok-* tokens in ps.css's :root");
	}

	return out;
}

/** The 32 nick colours of ps.css's own palette: the chrome's, and the bases here. */
function nickBases(css: string): string[] {
	const bases = [...css.matchAll(/^\.user\.color-(\d+) \{ color: (#[0-9a-f]{6}); \}$/gm)];

	if (
		bases.map((m) => Number(m[1])).join() !== Array.from({length: 32}, (_, i) => i + 1).join()
	) {
		throw new Error("ps.css must carry .user.color-1 … -32, in order, one per line");
	}

	return bases.map((m) => m[2]);
}

/** The ground each treatment is solved against: the darkest ink ground, the brightest light one. */
export function worstGrounds(): Record<Treatment, CheckedGround> {
	const {ink, light} = checkedGrounds();
	return {
		ink: ink.reduce((a, b) => (b.lum < a.lum ? b : a)),
		light: light.reduce((a, b) => (b.lum > a.lum ? b : a)),
	};
}

/** The colour at OKLCH lightness L, pulling chroma in until it fits sRGB. */
function at(L: number, C: number, h: number): string {
	for (let c = C; ; c *= 0.92) {
		const hex = oklchToHex(L, c < 1e-6 ? 0 : c, h);

		if (hex) {
			return hex;
		}
	}
}

/** `base` at the lightness that just clears FLOOR on `ground`, darker (ink) or lighter (light) than it. */
export function solve(base: string, text: Treatment, ground: string): string {
	const [, C, h] = hexToOklch(base);
	const passes = (L: number) => contrast(at(L, C, h), ground) >= FLOOR;
	// For ink the search keeps `lo` passing (black always does); for light, `hi` (white always does).
	let [lo, hi] = [0, 1];

	for (let i = 0; i < ITERATIONS; i++) {
		const mid = (lo + hi) / 2;

		if (passes(mid) === (text === "ink")) {
			lo = mid;
		} else {
			hi = mid;
		}
	}

	const hex = at(text === "ink" ? lo : hi, C, h);

	if (contrast(hex, ground) < FLOOR) {
		throw new Error(
			`${base} solved to ${hex}, ${contrast(hex, ground).toFixed(2)}:1 on ${ground}`
		);
	}

	return hex;
}

const declarations = (values: Record<string, string>) =>
	Object.entries(values).map(([name, value]) => `\t${name}: ${value};`);

/** Every name in `list` at its base's solved colour. */
function solveAll(
	list: Array<{names: string[]; base: string}>,
	text: Treatment,
	ground: string
): Record<string, string> {
	const out: Record<string, string> = {};

	for (const {names, base} of list) {
		const hex = solve(base, text, ground);

		for (const name of names) {
			out[name] = hex;
		}
	}

	return out;
}

/** The generated block, markers included. */
export function messagePaletteBlock(css: string): string {
	const worst = worstGrounds();
	const nicks = nickBases(css);
	const semantic = (text: Treatment, list: Array<{names: string[]; base: string}>) =>
		solveAll(list, text, worst[text].hex);
	const ink = {...FIXED.ink, ...semantic("ink", SEMANTIC)};
	const light = {
		...FIXED.light,
		...semantic("light", SEMANTIC),
		...semantic("light", codeTokens(css)),
	};
	const lightRoot = ':root[data-ps-text="light"] #chat .chat';

	return [
		`${START} — generated by`,
		" * `npx tsx tools/ps/message-palette.ts --write`; edit the generator, not",
		" * this block. Daytime colours clear 4.5:1 on the darkest ground a daytime",
		" * message meets, dusk-and-night colours on the brightest, each through its",
		" * treatment at α 0.6 (docs/projects/ps-theme.md §11):",
		` *   darkest daytime ground    ${worst.ink.hex}  ${worst.ink.where}`,
		` *   brightest night ground    ${worst.light.hex}  ${worst.light.where}`,
		" * Six-digit hex throughout: the floors test reads every colour in that form. */",
		"/* stylelint-disable color-hex-length */",
		"#chat .chat {",
		...declarations(ink),
		"",
		"\tcolor: var(--chat-fg);",
		"}",
		"",
		`${lightRoot} {`,
		...declarations(light),
		"}",
		"",
		...nicks.map(
			(base, i) =>
				`#chat .chat .user.color-${i + 1} { color: ${solve(base, "ink", worst.ink.hex)}; }`
		),
		"",
		...nicks.map(
			(base, i) =>
				`${lightRoot} .user.color-${i + 1} { color: ${solve(
					base,
					"light",
					worst.light.hex
				)}; }`
		),
		"/* stylelint-enable color-hex-length */",
		"",
		END,
	].join("\n");
}

/** ps.css with the block in place: replacing the old one, or at the end of the scene section the first time. */
export function withBlock(css: string, block: string): string {
	const start = css.indexOf(START);

	if (start >= 0) {
		const end = css.indexOf(END, start);

		if (end < 0) {
			throw new Error("ps.css has the palette's start marker but not its end");
		}

		return css.slice(0, start) + block + css.slice(end + END.length);
	}

	const anchor = css.indexOf(FIRST_ANCHOR);

	if (anchor < 0) {
		throw new Error(`ps.css has neither the palette block nor ${FIRST_ANCHOR}`);
	}

	return `${css.slice(0, anchor)}${block}\n\n${css.slice(anchor)}`;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
	const css = readFileSync(CSS_PATH, "utf8");
	const block = messagePaletteBlock(css);
	const worst = worstGrounds();

	if (process.argv.includes("--write")) {
		const next = withBlock(css, block);
		writeFileSync(CSS_PATH, next);
		console.log(
			next === css ? "ps.css: the block is already current" : "ps.css: block written"
		);
	} else {
		console.log(block);
	}

	console.log(`darkest daytime ground: ${worst.ink.hex} (${worst.ink.where})`);
	console.log(`brightest dusk-and-night ground: ${worst.light.hex} (${worst.light.where})`);
}
