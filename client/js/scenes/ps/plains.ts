/**
 * The ps theme's plains (docs/projects/ps-theme.md §5.1, §5.5): the land with
 * its river, the near grass along the foot of the window, and the fireflies
 * in the far fields. The approved mockup is the drawing
 * (docs/resources/themes/ps-plains/mockup.html): its land SVG, its blade and
 * flower generator, and its firefly generator, ported with their geometry and
 * counts, `ps-` names, and engine.ts's `rng` at the mockup's seeds in place of
 * its LCG (so the scatter differs from the mockup's; the drawing does not).
 *
 * Pure: strings in, strings out, the same every call. No colour lives here:
 * every fill is a class that ps.css paints from the palette's published
 * custom properties (scene.ts `sceneVars`). Nothing user-supplied is ever
 * written into this markup.
 */
import {rng} from "./engine";

/** Fireflies over the far fields: the mockup's 34. A phone gets half (scene.ts). */
export const FIREFLIES = 34;

/** A coordinate to two decimals, trailing zeros dropped: sub-pixel at any window size. */
const n = (v: number) => String(Number(v.toFixed(2)));

/* The land's outlines, the mockup's own. A hill's rim is its top edge alone;
 * the riverbed and the river are one shape (the water over the stones). */
const HILL2_EDGE =
	"M0,190 C120,170 260,160 400,172 C520,182 600,200 740,188 C880,176 1000,160 1200,176";
const HILL1_EDGE =
	"M0,250 C150,226 300,214 470,226 C620,236 740,258 900,246 C1030,236 1120,226 1200,232";
const RIVER =
	"M318,127 C350,132 370,138 350,146 C320,156 290,164 340,176 C400,190 500,196 530,214 C552,228 500,238 450,250 L530,250 C580,238 630,226 604,210 C578,194 470,186 414,172 C370,161 390,152 422,144 C446,137 406,131 350,127 Z";
const TO_FOOT = " L1200,400 L0,400 Z";

/** One tuft: two blades from one root, the mockup's `tuft`. */
function tuft(x: number, y: number, h: number, cls: string): string {
	return (
		`<path class="${cls}" d="M${n(x - 2)},${n(y)} q1,${n(-h * 0.6)} 2,${n(-h)} q1,${n(
			h * 0.5
		)} 2,${n(h)} z ` +
		`M${n(x + 1)},${n(y)} q2,${n(-h * 0.5)} 5,${n(-h * 0.8)} q-1,${n(h * 0.45)} -2,${n(
			h * 0.8
		)} z"/>`
	);
}

/**
 * The land: mountains, the far plain with its shrubs, the river (or its dry
 * bed), two hills with their rims, tufts and trees, and the grass band, back
 * to front on the mockup's 1200 × 400 box, stretched to whatever box ps.css
 * gives it. Also the defs the ground uses: the river's sky gradient and the
 * heat haze (applied to the ground group on hot days).
 */
export function landSvg(): string {
	// One stream, as the mockup's: the shrubs, then the far tufts, then the near.
	const r = rng(777);
	let shrubs = "";

	for (let i = 0; i < 40; i++) {
		const x = r() * 1200;
		const y = 130 + r() * 10;
		const w = 3 + r() * 6;
		shrubs += `<ellipse class="ps-l-shrub" cx="${x.toFixed(0)}" cy="${y.toFixed(
			1
		)}" rx="${w.toFixed(1)}" ry="${(w * 0.45).toFixed(1)}"/>`;
	}

	let far = "";

	for (let i = 0; i < 160; i++) {
		const x = r() * 1200;
		const y = 200 + r() * 40;
		const h = 5 + r() * 5;
		far += tuft(x, y, h, "ps-l-tuft2");
	}

	let near = "";

	for (let i = 0; i < 240; i++) {
		const x = r() * 1200;
		const y = 250 + r() * 44;
		const h = 7 + r() * 8;
		near += tuft(x, y, h, r() > 0.75 ? "ps-l-tuft-lit" : "ps-l-tuft1");
	}

	return (
		`<svg class="ps-land" viewBox="0 0 1200 400" preserveAspectRatio="none" aria-hidden="true">` +
		`<defs>` +
		`<filter id="ps-heat" x="0" y="-5%" width="100%" height="110%">` +
		`<feTurbulence type="turbulence" baseFrequency="0.007 0.05" numOctaves="2" seed="4" result="h">` +
		`<animate attributeName="baseFrequency" dur="9s" repeatCount="indefinite" values="0.007 0.05;0.009 0.038;0.007 0.05"/>` +
		`</feTurbulence>` +
		`<feDisplacementMap in="SourceGraphic" in2="h" scale="2" xChannelSelector="R" yChannelSelector="G"/>` +
		`</filter>` +
		`<linearGradient id="ps-river-sky" x1="0" y1="0" x2="0" y2="1">` +
		`<stop offset="0" style="stop-color: var(--ps-river-sky-top)"/><stop offset="1" style="stop-color: var(--ps-river-sky-bottom)"/>` +
		`</linearGradient>` +
		`</defs>` +
		`<path class="ps-l-mount2" d="M0,86 C60,70 110,54 170,62 C230,70 260,40 330,44 C400,48 430,76 500,70 C580,62 620,30 700,36 C780,42 820,70 900,64 C980,58 1030,34 1100,42 C1150,48 1180,60 1200,62${TO_FOOT}"/>` +
		`<path class="ps-l-mount" d="M0,112 C80,96 140,84 220,92 C300,100 340,76 420,80 C500,84 560,104 640,98 C720,92 780,72 860,78 C940,84 1000,102 1080,96 C1140,92 1180,98 1200,100${TO_FOOT}"/>` +
		`<path class="ps-l-far" d="M0,128 C200,120 400,132 600,126 C800,120 1000,132 1200,126${TO_FOOT}"/>` +
		shrubs +
		`<path class="ps-l-riverbed" d="${RIVER}"/>` +
		`<g class="ps-l-bedstone"><ellipse cx="352" cy="150" rx="4" ry="1.6"/><ellipse cx="330" cy="167" rx="5" ry="2"/>` +
		`<ellipse cx="402" cy="186" rx="4.5" ry="1.8"/><ellipse cx="468" cy="199" rx="6" ry="2.2"/><ellipse cx="520" cy="222" rx="5" ry="2"/>` +
		`<ellipse cx="496" cy="238" rx="7" ry="2.6"/><ellipse cx="376" cy="178" rx="3" ry="1.3"/></g>` +
		`<path class="ps-l-river" d="${RIVER}" fill="url(#ps-river-sky)"/>` +
		`<path class="ps-l-river-hi" d="M350,146 C320,156 290,164 340,176 C400,190 500,196 530,214"/>` +
		`<path class="ps-l-hill2" d="${HILL2_EDGE}${TO_FOOT}"/>` +
		`<path class="ps-l-rim" d="${HILL2_EDGE}"/>` +
		far +
		`<ellipse class="ps-l-tree" cx="448" cy="160" rx="16" ry="12"/><ellipse class="ps-l-tree" cx="466" cy="163" rx="12" ry="10"/>` +
		`<ellipse class="ps-l-tree" cx="432" cy="166" rx="10" ry="8"/><rect class="ps-l-trunk" x="447" y="168" width="3" height="8"/>` +
		`<ellipse class="ps-l-tree" cx="1008" cy="168" rx="9" ry="7"/><rect class="ps-l-trunk" x="1007" y="173" width="2" height="6"/>` +
		`<path class="ps-l-hill1" d="${HILL1_EDGE}${TO_FOOT}"/>` +
		`<path class="ps-l-rim" d="${HILL1_EDGE}"/>` +
		near +
		`<path class="ps-l-grass" d="M0,300 C200,290 400,296 600,292 C800,288 1000,296 1200,290${TO_FOOT}"/>` +
		`</svg>`
	);
}

/** The flowers' colours, the mockup's five. */
const FLOWER_COLOURS = ["#f3c85a", "#f6f0e4", "#e79a7a", "#c9b0e6", "#f2a65a"];

/**
 * The near grass: one path of blades along the whole foot of the window, in a
 * group that sways (ps.css `ps-sway`), and fifty small flowers among them. On
 * the mockup's 1200 × 120 box, anchored to the bottom and sliced, so a narrow
 * window crops the sides rather than squashing the blades.
 */
export function nearGrass(): string {
	// One stream, as the mockup's: the blades, then the flowers.
	const r = rng(4242);
	let d = "";

	for (let x = -4; x < 1206; x += 3.2 + r() * 2.4) {
		const h = 26 + r() * 46;
		const lean = (r() - 0.5) * 16;
		const w = 1.6 + r() * 1.8;
		d +=
			`M${(x - w).toFixed(1)},120 Q${(x + lean * 0.4).toFixed(1)},${(120 - h * 0.55).toFixed(
				1
			)} ${(x + lean).toFixed(1)},${(120 - h).toFixed(1)} ` +
			`Q${(x + lean * 0.3 + w * 0.4).toFixed(1)},${(120 - h * 0.5).toFixed(1)} ${(
				x + w
			).toFixed(1)},120 Z `;
	}

	let flowers = "";

	for (let i = 0; i < 50; i++) {
		const fill = FLOWER_COLOURS[Math.floor(r() * 5)];
		const cx = (r() * 1200).toFixed(0);
		const cy = (70 + r() * 44).toFixed(0);
		const radius = (1.4 + r() * 1.4).toFixed(1);
		flowers += `<circle cx="${cx}" cy="${cy}" r="${radius}" fill="${fill}"/>`;
	}

	return (
		`<svg class="ps-blades" viewBox="0 0 1200 120" preserveAspectRatio="xMidYMax slice" aria-hidden="true">` +
		`<g class="ps-sway"><path d="${d.trim()}"/></g>${flowers}</svg>`
	);
}

/** A px drift of the mockup's (at its 16 px rem) in rem. */
const rem = (px: string) => `${Number(px) / 16}rem`;

/**
 * `count` fireflies for the far fields, each with its own place, drift and
 * blink (ps.css `ps-ffdrift`, `ps-ffblink`); the mockup's px drift in rem.
 * Seeded, so the phone's half are the first half of the window's.
 */
export function fireflies(count: number): string {
	const r = rng(31337);
	let out = "";

	for (let i = 0; i < count; i++) {
		const left = (r() * 100).toFixed(1);
		const top = (r() * 100).toFixed(1);
		const d = (5 + r() * 6).toFixed(1);
		const dl = (-r() * 6).toFixed(1);
		const dx = rem((r() * 60 - 30).toFixed(0));
		const dy = rem((r() * 26 - 13).toFixed(0));
		const b = (2.6 + r() * 3.2).toFixed(1);
		const bl = (-r() * 5).toFixed(1);
		out += `<i style="left:${left}%;top:${top}%;--d:${d}s;--dl:${dl}s;--dx:${dx};--dy:${dy};--b:${b}s;--bl:${bl}s"></i>`;
	}

	return out;
}
