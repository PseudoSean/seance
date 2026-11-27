/**
 * The ps scene's mountains (the user's avatar, 2026-11-26;
 * docs/projects/ps-theme.md §2 and §5.1): three
 * ranges behind the land, far to near, each a lit silhouette, its peaks'
 * shaded right faces and the snow on its high peaks. Their own layer, not
 * the land's: the land is stretched to the window, which would squash peaks
 * into wedges on a phone, so this one keeps its aspect (`xMidYMax slice`).
 * The view is 1600 × 480: the ranges stand in its bottom 300, under empty
 * sky that a wide window's slice crops first. The skyline stays low toward
 * both sides, where the low sun and moon and the dawn's glow stand.
 *
 * Static and pure; ps.css paints every class from the palette.
 */

type Pt = readonly [number, number];

const FOOT = 480;

/** The ranges' silhouettes, left to right, back to front: a few massifs with shoulders far off, lower peaks, then foothills. */
const RANGES: ReadonlyArray<{
	name: "far" | "mid" | "near";
	capAbove: number;
	capDepth: number;
	pts: readonly Pt[];
}> = [
	{
		name: "far",
		capAbove: 300,
		capDepth: 0.44,
		pts: [
			[0, 410],
			[60, 396],
			[120, 402],
			[200, 380],
			[260, 368],
			[300, 350],
			[350, 332],
			[400, 300],
			[430, 308],
			[470, 262],
			[500, 274],
			[540, 250],
			[575, 262],
			[610, 286],
			[650, 262],
			[700, 226],
			[735, 236],
			[770, 196],
			[800, 212],
			[830, 206],
			[870, 240],
			[905, 268],
			[950, 246],
			[990, 226],
			[1030, 214],
			[1060, 230],
			[1100, 262],
			[1140, 250],
			[1180, 276],
			[1230, 300],
			[1280, 318],
			[1310, 334],
			[1360, 348],
			[1420, 366],
			[1480, 358],
			[1540, 378],
			[1600, 396],
		],
	},
	{
		name: "mid",
		capAbove: 320,
		capDepth: 0.36,
		pts: [
			[0, 430],
			[80, 414],
			[150, 422],
			[220, 398],
			[280, 404],
			[330, 380],
			[380, 388],
			[430, 350],
			[470, 360],
			[520, 318],
			[555, 330],
			[600, 300],
			[640, 318],
			[690, 338],
			[740, 316],
			[790, 292],
			[830, 304],
			[870, 330],
			[920, 312],
			[960, 284],
			[1000, 298],
			[1040, 320],
			[1090, 306],
			[1130, 322],
			[1180, 350],
			[1230, 340],
			[1280, 368],
			[1330, 378],
			[1400, 392],
			[1470, 384],
			[1540, 404],
			[1600, 414],
		],
	},
	{
		name: "near",
		capAbove: 380,
		capDepth: 0.28,
		pts: [
			[0, 446],
			[90, 432],
			[170, 440],
			[250, 420],
			[320, 430],
			[400, 404],
			[460, 414],
			[520, 388],
			[570, 398],
			[630, 380],
			[690, 396],
			[760, 410],
			[830, 392],
			[890, 372],
			[940, 384],
			[1000, 400],
			[1060, 386],
			[1120, 370],
			[1170, 382],
			[1230, 404],
			[1300, 398],
			[1370, 416],
			[1450, 410],
			[1530, 428],
			[1600, 440],
		],
	},
];

/**
 * Low foothills on past both edges of the view, from -1600 to 0 and from 1600
 * to 3200, around `base` by up to `amp`: a window wider than 2.65 : 1 keeps the
 * box to the scene's middle (ps.css), and these fill its sides.
 */
function flank(from: number, to: number, base: number, amp: number): Pt[] {
	const WAVE = [0.2, -0.6, 0.1, -1, 0.4, -0.3, 0.8, -0.8, 0, -0.5, 0.6, -0.9, 0.3];
	const out: Pt[] = [];
	const step = (to - from) / WAVE.length;

	for (let k = 0; k < WAVE.length; k++) {
		out.push([from + step * k, base + amp * WAVE[k]]);
	}

	return out;
}

/** A range's whole outline: its foothills past the left edge, the view's own, then those past the right. */
function outline(r: (typeof RANGES)[number]): Pt[] {
	const base = r.name === "far" ? 384 : r.name === "mid" ? 402 : 428;
	const amp = r.name === "near" ? 12 : 18;
	return [
		...flank(-1600, 0, base, amp),
		...r.pts,
		...flank(1600 + 1600 / 13, 3200 + 1600 / 13, base, amp),
	];
}

const n = (v: number) => String(Math.round(v * 100) / 100);
const at = (a: Pt, b: Pt, t: number): Pt => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const poly = (pts: readonly Pt[]) => `M${pts.map(([x, y]) => `${n(x)},${n(y)}`).join(" L")} Z`;

/** The indices of the peaks: vertices higher than both neighbours. */
function summits(pts: readonly Pt[]): number[] {
	const out: number[] = [];

	for (let i = 1; i < pts.length - 1; i++) {
		if (pts[i][1] < pts[i - 1][1] && pts[i][1] < pts[i + 1][1]) {
			out.push(i);
		}
	}

	return out;
}

/**
 * Each peak's right face, a triangle: from the summit down its right flank
 * to the valley, back up a ridge that meets the summit from just right of
 * its foot. It ends a little under the valley, so the faces read as facets,
 * not columns.
 */
function shade(pts: readonly Pt[]): string {
	return summits(pts)
		.map((i) => {
			let j = i + 1;

			while (j + 1 < pts.length && pts[j + 1][1] > pts[j][1]) {
				j++;
			}

			const s = pts[i];
			const v = pts[j];
			const foot: Pt = [s[0] + (v[0] - s[0]) * 0.3, v[1] + (FOOT - v[1]) * 0.3];
			return poly([...pts.slice(i, j + 1), foot]);
		})
		.join(" ");
}

/** The snow on each high peak: down both flanks a share of the way to the valleys, its lower edge jagged and inside the peak. */
function caps(pts: readonly Pt[], above: number, depth: number): string {
	return summits(pts)
		.filter((i) => pts[i][1] < above)
		.map((i) => {
			const s = pts[i];
			const l = at(s, pts[i - 1], depth);
			const r = at(s, pts[i + 1], depth);
			// Between the flank points, alternately under and over their chord, never above the flanks.
			const jag: Pt[] = [1, 2, 3].map((k) => {
				const c = at(l, r, k / 4);
				const dip = (k % 2 === 1 ? 1 : -0.4) * (r[1] - s[1]) * 0.35;
				return [c[0], c[1] + dip];
			});
			return poly([s, r, ...jag.reverse(), l]);
		})
		.join(" ");
}

/**
 * The three ranges' markup on the view's own 1600 × 480 units: each lit outline, its faces and its caps;
 * given a crop, only the vertices within 200 units of it (a window shows a part, and need not carry all).
 */
function rangesBody(crop?: {from: number; to: number}): string {
	let body = "";

	for (const r of RANGES) {
		const pts = outline(r).filter(
			([x]) => !crop || (x >= crop.from - 200 && x <= crop.to + 200)
		);
		body +=
			`<path class="ps-m-${r.name}" d="${poly([
				[pts[0][0], FOOT],
				...pts,
				[pts[pts.length - 1][0], FOOT],
			])}"/>` +
			`<path class="ps-m-${r.name}-sh" d="${shade(pts)}"/>` +
			`<g class="ps-m-snow">${caps(pts, r.capAbove, r.capDepth)
				.split(" M")
				.map((d, k) => `<path d="${k === 0 ? d : `M${d}`}"/>`)
				.join("")}</g>`;
	}

	return body;
}

/**
 * The same ranges for a window of the yurt's room (2026-11-27), so its view shows the outside's own
 * mountains, their light, their caps and their snow: the view's x from `crop.from` to `crop.to` scaled
 * into `w` from `x`, their foot at `foot`, unsquashed. The room clips it to the pane.
 */
export function rangesIn(
	x: number,
	foot: number,
	w: number,
	crop: {from: number; to: number}
): string {
	const k = w / (crop.to - crop.from);
	const kk = String(Math.round(k * 10000) / 10000);
	return `<g transform="translate(${n(x - crop.from * k)},${n(
		foot - FOOT * k
	)}) scale(${kk})">${rangesBody(crop)}</g>`;
}

export function mountainsSvg(): string {
	const body = rangesBody();
	return (
		`<svg class="ps-mountains" viewBox="0 0 1600 480" preserveAspectRatio="xMidYMax slice" aria-hidden="true">` +
		body +
		`</svg>`
	);
}
