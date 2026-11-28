/**
 * The yurt's room as one static picture (docs/projects/ps-yurt.md §5, plan 1
 * task 4): every piece of the approved mockup
 * (docs/resources/themes/ps-yurt/mockup.html, `interior` and `PIECES`) drawn
 * through yurt.ts's camera into the design frame, coloured by class
 * (indoor.ts `roomCss` shades them by the minute) and the windows by the
 * plains' own custom properties. What the mockup did with masks, blend-mode
 * rectangles and a brightened copy of the stove is left out: the classes'
 * night mix does it. The light (the glows, the low sun, the stars,
 * the moon) is drawn once and driven by opacity from the minute's levels; the
 * fire, the lamp's flame and the night screen are the only literal colours
 * (`ps-yt-lit`). The windows' weather is a slot (`.ps-yt-weather`) the scene
 * fills for the day (task 5). Pure and Vue-free: mocha loads it directly.
 */
import {rainTiles} from "../psng/rain";
import {WEATHERS, type Weather} from "./engine";
import {FLAME_CORE, FLAME_LAYERS, FLAME_POSES, FLAME_SPACE, flameShape, flameSvg} from "./flames";
import {FIREBOX_BURNING, type RoomColour} from "./indoor";
import {rangesIn} from "./peaks";
import {
	abox,
	arc,
	box,
	circle3,
	cylinderSide,
	DESIGN_FRAME,
	depthOf,
	fill,
	freeFrame,
	line3,
	n,
	onWall,
	poly3,
	polyRuns,
	project,
	pts,
	quadratic,
	roundedOutline,
	roofHeightAt,
	ROOM_GEOMETRY,
	softBox,
	sprite,
	strokeAt,
	surface,
	wallFrame,
	wallPt,
	type Frame,
	type P3,
	type Painter,
} from "./yurt";

const {
	radius: R,
	wallHeight: WALL_H,
	crownHeight: CROWN_H,
	crownRadius: CROWN_R,
	near: NEAR,
} = ROOM_GEOMETRY;
const FOCAL = ROOM_GEOMETRY.focal;

/** The pieces along the wall, by angle from the back (0°), + to the right. */
const ROOM: ReadonlyArray<readonly [Piece, number]> = [
	["hooks", -120],
	["washstand", -102],
	["closet", -82],
	["desk", -60],
	["chests", -38],
	["bed", 45],
	["kitchen", 86],
];
const SIDE_WINDOWS = [-60, 69] as const;
const RUG_R = 2.5;
/** The dining table (the user, 2026-11-27): at the middle of the big rug, a little behind the posts. */
export const TABLE = [0, 0.8] as const;
/**
 * Its two chairs, on the table's far side either way, facing it, so the eye sees their seats and backs
 * between the posts (beside them, the posts hid the chairs).
 */
export const CHAIRS = [
	{x: -0.45, z: 1.35, nx: 0.45, nz: -0.55},
	{x: 0.45, z: 1.35, nx: -0.45, nz: -0.55},
] as const;
/** A low bench where the table stood, on the rug, facing the room's middle. */
export const BENCH = {x: -1.45, z: -0.35, length: 1.1, nx: 1, nz: 0.35} as const;
/**
 * The wood basket, beside the stove toward the middle, on the rug, off the hearth plate; left of the
 * stove on screen as well, since the stove is drawn again over its glow and would cover it.
 */
export const BASKET = [0.95, 0.5] as const;
/** The back window: 3.1 m wide, from 0.45 m to 1.9 m, flat in the curved wall. */
const WX = 1.55;
const WY0 = 0.45;
const WY1 = 1.9;
const FR = 0.08;
const ZW = Math.sqrt(R * R - WX * WX) - 0.02;

/**
 * The back curtains' rod (the user, 2026-11-19: it floated): across the curtains' heads, under the
 * lattice's top on screen, a finial just past each curtain, on two brackets to the wall. The wall curves
 * forward of the window's plane past the window, so the rod stands forward enough to clear it there.
 */
export const CURTAIN_ROD = {height: 1.95, end: 1.95, depth: 3.45} as const;
/**
 * The stove (the user, 2026-11-27): on the right, between the bed and the kitchen, as the outside yurt's
 * pipe stands on its roof's right slope; on its hearth plate wholly on the big rug (the user's rule for
 * the table, 2026-11-14), so as far right as that allows. Its pipe rises through the roof, not the crown.
 */
export const STOVE = {x: 1.75, z: 0.5, r: 0.38, plate: 0.6} as const;
/** The way the stove faces: toward the eye, so its door and fire show. */
const STOVE_FACE = Math.atan2(ROOM_GEOMETRY.eye[2] - STOVE.z, ROOM_GEOMETRY.eye[0] - STOVE.x);
/** A point on the stove: `a` to its right as the eye sees it, `b` toward the eye, at height `y`. */
const onStove = (a: number, y: number, b: number): P3 => [
	STOVE.x - a * Math.sin(STOVE_FACE) + b * Math.cos(STOVE_FACE),
	y,
	STOVE.z + a * Math.cos(STOVE_FACE) + b * Math.sin(STOVE_FACE),
];
/** The bed's half-length along the wall. */
const BED_L = 1.08;
/**
 * The bed's measures (2026-11-27/28): a four-poster's head posts over its headboard; the wall rug centred
 * over it; a slim mattress, the quilt resting on it and the pillows lying on it; the quilt's pattern
 * centred on the part that shows, between the turned-down sheet at the head and the throw at the foot.
 */
export const BED = {
	headPost: 1.52,
	headPeak: 1.42,
	rugOffset: 0,
	mattressBottom: 0.36,
	mattressTop: 0.54,
	quiltTop: 0.575,
	pillowBottom: 0.54,
	sheetEnd: -BED_L + 0.64,
	throwStart: BED_L - 0.44,
	patternCentre: (-BED_L + 0.64 + BED_L - 0.44) / 2,
} as const;
/**
 * The stove's four feet, turned with it: two either side of its door, two behind (they stood at the
 * angles they had facing the door from the middle, so its base and its door faced different ways).
 */
export const STOVE_FEET: ReadonlyArray<readonly [number, number]> = [-2.4, -0.75, 0.9, 2.55].map(
	(a) => {
		const t = a + STOVE_FACE + Math.PI / 2;
		return [STOVE.x + Math.cos(t) * 0.3, STOVE.z + Math.sin(t) * 0.3] as const;
	}
);
/** The stove's pipe: a little behind its middle, rising to the roof above it. */
export const PIPE = {x: onStove(0, 0, -0.1)[0], z: onStove(0, 0, -0.1)[2]} as const;

/** The clips of the three windows' panes, which the windows' weather (task 5) is clipped to. */
export const WINDOW_CLIPS = ["ps-yt-win-back", "ps-yt-win-left", "ps-yt-win-right"] as const;

type Piece = "closet" | "bed" | "chests" | "desk" | "kitchen" | "washstand" | "hooks";

/** Every piece's class, in the markup as `ps-yt-p-<name>`. */
export const ROOM_PIECES: readonly string[] = [
	"closet",
	"desk",
	"chests",
	"bed",
	"kitchen",
	"washstand",
	"hooks",
	"stove",
	"table",
	"chair",
	"bench",
	"rug",
	"crown",
	"window-back",
	"window-left",
	"window-right",
	"curtains",
].map((p) => `ps-yt-p-${p}`);

/** A class for a fill colour, a stroke colour, or both, and any further classes. */
function cls(fillKey?: RoomColour, strokeKey?: RoomColour, more = ""): string {
	return `class="${[fillKey && `ps-yt-c-${fillKey}`, strokeKey && `ps-yt-s-${strokeKey}`, more]
		.filter(Boolean)
		.join(" ")}"`;
}

const piece = (name: string, body: string) => `<g class="ps-yt-p-${name}">${body}</g>`;
const LIT = 'class="ps-yt-lit"';

/* ---------- small round things, drawn flat at their place ---------- */
const PLANT = {
	pot: "M-9,0 L-7,-12 L7,-12 L9,0 Z",
	leaves: "M0,-12 C-12,-20 -14,-30 -6,-34 C-2,-26 0,-20 0,-12 C2,-24 8,-32 14,-30 C12,-22 6,-16 0,-12",
};
const SPR = {
	lamp: `<rect x="-9" y="-6" width="18" height="6" rx="2" ${cls(
		"gold"
	)}/><path d="M-6,-6 C-10,-16 -8,-26 0,-32 C8,-26 10,-16 6,-6 Z" ${cls(
		"chimney"
	)} opacity=".55"/>`,
	flame: `<path d="M0,-26 C-5,-18 -5,-12 0,-9 C5,-12 5,-18 0,-26 Z" fill="#ffe7a0" ${LIT}/>`,
	bowl: `<path d="M-8,-5 a8,5 0 0 0 16,0 Z" ${cls("china")}/>`,
	mug: `<rect x="-7" y="-14" width="14" height="14" rx="2" ${cls(
		"cream"
	)}/><path d="M7,-11 a4,4 0 0 1 0,8" fill="none" ${cls(
		undefined,
		"cream"
	)} stroke-width="2.4"/>`,
	plant: `<path d="${PLANT.pot}" ${cls("clay")}/><path d="${PLANT.leaves}" ${cls("leaf")}/>`,
	jarA: `<rect x="-7" y="-22" width="14" height="22" rx="3" ${cls(
		"jarAmber"
	)}/><rect x="-8" y="-25" width="16" height="4" rx="1" ${cls("woodD")}/>`,
	jarB: `<rect x="-6" y="-16" width="12" height="16" rx="3" ${cls(
		"jarGreen"
	)}/><rect x="-7" y="-19" width="14" height="4" rx="1" ${cls("woodD")}/>`,
	bowls: `<path d="M-12,-10 h24 l-3,10 h-18 Z" ${cls(
		"china"
	)}/><path d="M-9,-18 h18 l-2,8 h-14 Z" ${cls("chinaB")}/>`,
	cups: `<rect x="-8" y="-14" width="16" height="14" rx="3" ${cls(
		"blue"
	)}/><rect x="10" y="-14" width="16" height="14" rx="3" ${cls(
		"cream"
	)}/><rect x="28" y="-14" width="14" height="14" rx="3" ${cls("green")}/>`,
	thermos: `<rect x="-8" y="-38" width="16" height="38" rx="5" ${cls(
		"thermos"
	)}/><path d="M-8,-24 h16 M-8,-14 h16" ${cls(
		undefined,
		"gold"
	)} stroke-width="2"/><rect x="-5" y="-44" width="10" height="7" rx="2" ${cls("iron")}/>`,
	basin: `<path d="M-22,-12 h44 l-6,12 h-32 Z" ${cls(
		"tin"
	)}/><ellipse cx="0" cy="-12" rx="22" ry="4" ${cls("tinL")}/>`,
	jug: `<path d="M-7,0 L-9,-20 Q0,-26 9,-20 L7,0 Z" ${cls(
		"cream"
	)}/><path d="M9,-18 q7,4 0,12" ${cls(undefined, "cream")} stroke-width="2.5" fill="none"/>`,
	finial: `<circle cx="0" cy="-6" r="6" ${cls("gold")}/><circle cx="-2" cy="-8" r="2" ${cls(
		"white"
	)} opacity=".4"/>`,
	kettle: `<g transform="translate(0,-15)"><path d="M18,-2 C30,-6 34,-14 38,-16 L36,-12 C32,-6 26,2 18,4 Z" ${cls(
		"copper"
	)}/><ellipse cx="0" cy="0" rx="23" ry="15" ${cls(
		"copper"
	)}/><ellipse cx="-6" cy="-5" rx="10" ry="4" ${cls(
		"white"
	)} opacity=".2"/><ellipse cx="0" cy="-13" rx="11" ry="3.5" ${cls(
		"copperD"
	)}/><circle cx="0" cy="-17" r="3" ${cls(
		"iron"
	)}/><path d="M-16,-8 Q0,-34 16,-8" fill="none" ${cls(
		undefined,
		"iron"
	)} stroke-width="2.5"/></g>`,
	pot: `<g transform="translate(0,-28)"><rect x="-24" y="0" width="48" height="28" rx="4" ${cls(
		"potIron"
	)}/><rect x="-24" y="3" width="48" height="3" ${cls(
		"white"
	)} opacity=".12"/><ellipse cx="0" cy="0" rx="25" ry="5" ${cls(
		"potIronL"
	)}/><rect x="-31" y="6" width="7" height="4" rx="2" ${cls(
		"potIron"
	)}/><rect x="24" y="6" width="7" height="4" rx="2" ${cls("potIron")}/></g>`,
	steam: `<g fill="none" ${cls(
		undefined,
		"white"
	)} stroke-width="2" stroke-linecap="round" opacity=".45"><path d="M-6,-34 q-6,-12 2,-22 q8,-10 0,-22"/><path d="M6,-36 q6,-12 -2,-22 q-6,-9 2,-18"/></g>`,
	teapot: `<g transform="translate(0,-11)"><path d="M12,-4 C20,-6 24,-14 27,-15" ${cls(
		undefined,
		"blue"
	)} stroke-width="3.5" fill="none" stroke-linecap="round"/><path d="M-12,-6 a7,8 0 0 0 0,12" ${cls(
		undefined,
		"blue"
	)} stroke-width="3" fill="none"/><ellipse cx="0" cy="0" rx="14" ry="11" ${cls(
		"blue"
	)}/><ellipse cx="-4" cy="-4" rx="6" ry="3" ${cls(
		"white"
	)} opacity=".25"/><ellipse cx="0" cy="-10" rx="7" ry="2.5" ${cls(
		"blueD"
	)}/><circle cx="0" cy="-13" r="2.4" ${cls("cream")}/></g>`,
	dumplings:
		`<g transform="translate(0,-3)"><ellipse cx="0" cy="0" rx="24" ry="6" ${cls("dough")}/>` +
		[
			[-9, -3],
			[2, -4],
			[12, -3],
			[-3, -7],
			[8, -7],
		]
			.map(
				([x, y]) =>
					`<ellipse cx="${x}" cy="${y}" rx="6" ry="3.5" ${cls("doughL", "doughEdge")}/>`
			)
			.join("") +
		`<path d="M-4,-14 q-4,-8 2,-14 M6,-14 q4,-8 -2,-14" ${cls(
			undefined,
			"white"
		)} stroke-width="1.8" fill="none" opacity=".5"/></g>`,
	tbowl: `<g transform="translate(0,-3)"><path d="M-10,-4 a10,7 0 0 0 20,0 Z" ${cls(
		"china"
	)}/><path d="M-10,-4 h20" ${cls(undefined, "blue")} stroke-width="2"/></g>`,
	basket:
		`<g transform="rotate(-18)"><rect x="-8" y="-74" width="13" height="66" rx="5" ${cls(
			"log"
		)}/></g>` +
		[
			[-18, -42, 10, 6],
			[2, -48, 11, 7],
			[20, -42, 9, 5.5],
		]
			.map(
				([x, y, r, e]) =>
					`<circle cx="${x}" cy="${y}" r="${r}" ${cls(
						"log"
					)}/><circle cx="${x}" cy="${y}" r="${e}" ${cls("logEnd")}/>`
			)
			.join("") +
		`<path d="M-36,-40 L36,-40 L30,0 L-30,0 Z" ${cls("wicker")}/>` +
		`<path d="M-35,-31 Q0,-27 35,-31 M-33,-20 Q0,-16 33,-20 M-31,-9 Q0,-5 31,-9" ${cls(
			undefined,
			"wickerD"
		)} stroke-width="2" fill="none"/>` +
		`<path d="M-20,-40 L-18,0 M0,-40 L0,0 M20,-40 L18,0" ${cls(
			undefined,
			"wickerD"
		)} stroke-width="1.6"/>`,
};

/** Where the lit things stand, found while the pieces are drawn. */
interface Lights {
	lamp?: P3;
	screen?: P3;
	flame?: string;
	/** Where the lamp's flame sprite stands (plan 2: its moving copy is placed there). */
	flameAt?: P3;
	screenFace?: string;
}

/** A chair in a frame turned toward what it serves (b toward it): legs, seat, and a back away from it. */
type Span = readonly [number, number];

/** A part of a piece built of boxes in its own frame: along it (a), toward where it faces (b), up (c). */
interface Part {
	part: string;
	a: Span;
	b: Span;
	c: Span;
	colour: RoomColour;
}

/**
 * The parts drawn from the ground up, by the height each starts at (the legs, then the seat, then what
 * stands on it), and far to near among those that start alike, so the nearer covers the farther and
 * nothing that stands on a part is hidden under it.
 */
function partsInFrame(fr: Frame, parts: readonly Part[]): string {
	const mid = (q: Span) => (q[0] + q[1]) / 2;
	const depth = (p: Part) => depthOf(fr.pt(mid(p.a), mid(p.b), mid(p.c)));
	return [...parts]
		.sort((p, q) => p.c[0] - q.c[0] || depth(q) - depth(p))
		.map((p) => box(fr, p.a, p.b, p.c, p.colour))
		.join("");
}

/**
 * A chair, whole (the user, 2026-11-27: "the backs of chairs missing"): four legs, a seat with its
 * thickness, a back of two posts, a top rail and two slats, its back away from where it faces.
 */
export const CHAIR_PARTS: readonly Part[] = [
	...(
		[
			[-0.19, -0.19],
			[0.15, -0.19],
			[-0.19, 0.15],
			[0.15, 0.15],
		] as const
	).map(
		([a, b]): Part => ({
			part: "leg",
			a: [a, a + 0.04],
			b: [b, b + 0.04],
			c: [0, 0.45],
			colour: "wood",
		})
	),
	{part: "seat", a: [-0.21, 0.21], b: [-0.21, 0.21], c: [0.45, 0.495], colour: "woodL"},
	{part: "post", a: [-0.2, -0.16], b: [-0.21, -0.17], c: [0.495, 0.97], colour: "wood"},
	{part: "post", a: [0.16, 0.2], b: [-0.21, -0.17], c: [0.495, 0.97], colour: "wood"},
	{part: "rail", a: [-0.16, 0.16], b: [-0.205, -0.175], c: [0.86, 0.95], colour: "woodL"},
	{part: "slat", a: [-0.09, -0.05], b: [-0.2, -0.18], c: [0.495, 0.86], colour: "wood"},
	{part: "slat", a: [0.05, 0.09], b: [-0.2, -0.18], c: [0.495, 0.86], colour: "wood"},
];

function chair(fr: Frame): string {
	return piece("chair", partsInFrame(fr, CHAIR_PARTS));
}

/** A low wooden bench with a cushion. */
const BENCH_PARTS: readonly Part[] = [
	...(
		[
			[-0.5, -0.14],
			[0.46, -0.14],
			[-0.5, 0.1],
			[0.46, 0.1],
		] as const
	).map(
		([a, b]): Part => ({
			part: "leg",
			a: [a, a + 0.05],
			b: [b, b + 0.05],
			c: [0, 0.38],
			colour: "wood",
		})
	),
	{part: "seat", a: [-0.55, 0.55], b: [-0.17, 0.17], c: [0.38, 0.43], colour: "woodL"},
	{part: "cushion", a: [-0.48, 0.48], b: [-0.14, 0.14], c: [0.43, 0.49], colour: "curtain"},
];

/**
 * The painted furniture's medallion (the user, 2026-11-27: the plain blue discs read as nonsense): a blue
 * lozenge edged in cream, a cream lozenge inside it with a gold heart, and a cream dot past each side tip.
 */
function paintedMedallion(S: Painter, s0: number, t0: number, r: number): string {
	return (
		S.diamond(
			s0,
			t0,
			r * 0.95,
			r * 1.3,
			`${cls("blue", "cream")} stroke-width="${strokeAt(S, s0, t0, 0.012)}"`
		) +
		S.diamond(s0, t0, r * 0.42, r * 0.6, cls("cream")) +
		S.circle(s0, t0, r * 0.14, cls("gold")) +
		S.circle(s0 - r * 1.35, t0, r * 0.16, cls("cream")) +
		S.circle(s0 + r * 1.35, t0, r * 0.16, cls("cream"))
	);
}

/* ---------- the furniture along the round wall: each gives how far it stands out, and its markup ---------- */
const PIECES: Record<Piece, (fr: Frame, lights: Lights) => {d: number; svg: string}> = {
	closet(fr) {
		const front = (S: Painter) => {
			const orn = (s: number) => paintedMedallion(S, s, 1.08, 0.1);
			return (
				S.rect(-0.4, 0.42, -0.02, 1.74, cls("furnL")) +
				S.rect(0.02, 0.42, 0.4, 1.74, cls("furnL")) +
				orn(-0.21) +
				orn(0.21) +
				[
					[-0.36, -0.06],
					[0.06, 0.36],
				]
					.map(
						([a, b]) =>
							S.rect(a, 1.65, b, 1.675, cls("green")) +
							S.rect(a, 0.5, b, 0.525, cls("green"))
					)
					.join("") +
				S.circle(-0.05, 1.0, 0.018, cls("gold")) +
				S.circle(0.05, 1.0, 0.018, cls("gold")) +
				S.rect(-0.38, 0.14, 0.38, 0.34, cls("furnL")) +
				S.rect(-0.07, 0.23, 0.07, 0.255, cls("gold"))
			);
		};
		return {
			d: 0.62,
			svg:
				box(fr, [-0.42, 0.42], [0.04, 0.52], [0, 0.08], "furnD") +
				box(fr, [-0.45, 0.45], [0, 0.58], [0.08, 1.82], "furn", {front}) +
				box(fr, [-0.48, 0.48], [0, 0.62], [1.82, 1.9], "furnD"),
		};
	},

	/* A painted four-poster: shaped head- and footboards with thickness, turned posts with brass
	 * finials, the head posts over the headboard, an orange frame with cream line-work; the bedding as
	 * solids in its own colours (2026-11-28) — a slim mattress, two pillows lying at the head, a blue
	 * quilt resting on the mattress with its sheet turned down at the head and its pattern centred, and
	 * a mustard throw across the foot; the rug on the wall above it, centred, below the roof line. */
	bed(fr) {
		const Wl = surface((s, t) => onWall(fr, s, t));
		const kw = Wl.px(0, 1.4);
		// The wall rug, centred over the bed (hung toward its head it read as an offset pattern, 2026-11-28).
		const RA = BED.rugOffset;
		let s =
			Wl.rect(RA - 0.7, 0.98, RA + 0.7, 1.8, cls("rug"), 8) +
			Wl.rect(
				RA - 0.63,
				1.05,
				RA + 0.63,
				1.73,
				`fill="none" ${cls(undefined, "rugB")} stroke-width="${n(0.028 * kw)}"`,
				8
			) +
			Wl.diamond(RA, 1.39, 0.18, 0.26, cls("rugP")) +
			Wl.diamond(RA, 1.39, 0.1, 0.15, cls("rugB")) +
			[
				[-0.48, 1.18],
				[0.48, 1.18],
				[-0.48, 1.6],
				[0.48, 1.6],
			]
				.map(([a, c]) => Wl.diamond(RA + a, c, 0.06, 0.09, cls("rugB")))
				.join("");

		for (let a = RA - 0.65; a <= RA + 0.66; a += 0.1) {
			s += Wl.line(
				[
					[a, 0.98],
					[a, 0.92],
				],
				`${cls(undefined, "rugB")} stroke-width="${n(0.012 * kw)}"`
			);
		}

		const L = BED_L;
		const D = 1.42;
		const HEAD = -L;
		const FOOT = L;
		const T = 0.07;
		const eye = ROOM_GEOMETRY.eye;
		const across = (A: number) => surface((b, c) => fr.pt(A, b, c));
		const seesPlus = (A: number) => {
			const p = fr.pt(A, D / 2, 0.6);
			return fr.u[0] * (eye[0] - p[0]) + fr.u[2] * (eye[2] - p[2]) > 0;
		};
		const archOutline = (
			s0: number,
			s1: number,
			t0: number,
			tSide: number,
			tPeak: number,
			k = 18
		) => {
			const l: Array<[number, number]> = [
				[s0, t0],
				[s1, t0],
				[s1, tSide],
			];

			for (let i = 1; i < k; i++) {
				l.push([
					s1 + ((s0 - s1) * i) / k,
					tSide + (tPeak - tSide) * Math.sin((Math.PI * i) / k),
				]);
			}

			l.push([s0, tSide]);
			return l;
		};
		/** A shaped board across the bed: its far face as a rim, then the near face painted. */
		const board = (
			A0: number,
			A1: number,
			outline: Array<[number, number]>,
			inset: Array<[number, number]>,
			orn: (S: Painter) => string
		) => {
			const [far, near] = seesPlus(A1) ? [A0, A1] : [A1, A0];
			const N = across(near);
			return (
				across(far).poly(outline, fill("furn", "side")) +
				N.poly(outline, fill("furn")) +
				N.poly(
					inset,
					`${cls("furnL", "cream")} stroke-width="${strokeAt(N, D / 2, 0.6, 0.014)}"`
				) +
				orn(N)
			);
		};
		/** A corner post to the floor with a brass finial: four of them, at the wall and at the front; they are its legs. */
		const post = (a0: number, a1: number, b0: number, h: number) => {
			// Turned round (the user, 2026-11-27: the square posts read as flat slabs), with two rings.
			const [px, , pz] = fr.pt((a0 + a1) / 2, b0 + 0.05, 0);
			return (
				`<g class="ps-yt-bedpost">` +
				cylinderSide(px, pz, 0.048, 0, h, 'fill="url(#ps-yt-wood)"') +
				cylinderSide(px, pz, 0.062, h * 0.32, h * 0.32 + 0.05, cls("furnD")) +
				cylinderSide(px, pz, 0.06, h - 0.1, h - 0.06, cls("furnD")) +
				sprite(fr.pt((a0 + a1) / 2, b0 + 0.05, h), SPR.finial, 0.008) +
				`</g>`
			);
		};
		const headboard =
			board(
				HEAD - T,
				HEAD,
				archOutline(0, D, 0, 1.12, BED.headPeak),
				archOutline(0.12, D - 0.12, 0.64, 1.04, 1.28),
				// Above the pillows' tops (0.96), where it shows whole (it sat behind them, its discs peeking out).
				(S) => paintedMedallion(S, D / 2, 1.12, 0.085)
			) +
			post(HEAD - 0.09, HEAD + 0.02, 0, BED.headPost) +
			post(HEAD - 0.09, HEAD + 0.02, D - 0.1, BED.headPost);
		const footboard =
			// A plain panel with a straight top (2026-11-28): seen nearly edge-on from here, the arch and its
			// medallion read lopsided.
			board(
				FOOT,
				FOOT + T,
				[
					[0, 0],
					[D, 0],
					[D, 0.7],
					[0, 0.7],
				],
				[
					[0.12, 0.2],
					[D - 0.12, 0.2],
					[D - 0.12, 0.6],
					[0.12, 0.6],
				],
				() => ""
			) +
			post(FOOT - 0.02, FOOT + 0.09, 0, 0.86) +
			post(FOOT - 0.02, FOOT + 0.09, D - 0.1, 0.86);
		// Seen from the side the bed faces, a board is behind the bedding; seen from beyond it, in front.
		const headBehind = seesPlus(HEAD);
		const footBehind = !seesPlus(FOOT + T);

		if (headBehind) {
			s += headboard;
		}

		if (footBehind) {
			s += footboard;
		}

		// The frame between the posts, which are its legs (two leg boxes beside the posts stood out as stubs).
		s += box(fr, [HEAD, FOOT], [0.02, D], [0.16, BED.mattressBottom], "furn", {
			front: (S) =>
				S.rect(
					HEAD + 0.07,
					0.19,
					FOOT - 0.07,
					0.33,
					`fill="none" ${cls(undefined, "cream")} stroke-width="${strokeAt(
						S,
						0,
						0.26,
						0.012
					)}"`
				),
		});
		// The bedding, as solids that rest on one another (2026-11-28: the tilted cards read in a perspective
		// of their own): a slim mattress; two pillows lying on it at the head (the upright cushion read as a
		// book standing on the bed); the quilt on the mattress, its sheet turned down at the head; the throw across the foot.
		s += softBox(
			fr,
			[HEAD + 0.02, FOOT - 0.02],
			[0.04, D - 0.02],
			[BED.mattressBottom, BED.mattressTop],
			"mattress",
			0.04
		);

		for (const [b0, b1] of [
			[0.1, 0.68],
			[0.74, 1.32],
		]) {
			s += softBox(
				fr,
				[HEAD + 0.08, HEAD + 0.46],
				[b0, b1],
				[BED.pillowBottom, BED.pillowBottom + 0.14],
				"pillow",
				0.065
			);
		}

		const QA = HEAD + 0.5;
		const QF = FOOT - 0.03;
		const QB = D + 0.03;
		const QT = BED.quiltTop;
		const HEM = 0.33;
		const PC = BED.patternCentre;
		const MB = (0.02 + QB) / 2;
		const QR = 0.04;
		s += softBox(fr, [QA, QF], [0.02, QB], [HEM, QT], "blue", QR, {
			top: (S) =>
				S.poly(roundedOutline(QA, 0.02, QF, QB, QR), cls("quiltTop")) +
				S.poly(roundedOutline(QA, 0.02, BED.sheetEnd, QB, QR), cls("sheet")) +
				S.poly(
					roundedOutline(PC - 0.42, 0.18, PC + 0.42, QB - 0.16, 0.05),
					`fill="none" ${cls(undefined, "cream")} stroke-width="${strokeAt(
						S,
						PC,
						MB,
						0.016
					)}"`
				) +
				S.diamond(PC, MB, 0.1, 0.18, cls("gold")) +
				[
					[-0.26, -0.32],
					[0.26, -0.32],
					[-0.26, 0.32],
					[0.26, 0.32],
				]
					.map(([da, db]) => S.circle(PC + da, MB + db, 0.035, cls("gold")))
					.join(""),
			front: (S) =>
				S.poly(roundedOutline(QA, HEM, BED.sheetEnd, QT, QR), cls("sheetSide")) +
				S.line(
					[
						[BED.sheetEnd, HEM + 0.05],
						[QF, HEM + 0.05],
					],
					`${cls(undefined, "cream")} stroke-width="${strokeAt(S, 0, HEM + 0.05, 0.014)}"`
				),
		});
		const TA = BED.throwStart;
		const TB = FOOT - 0.12;
		const stripes = (S: Painter, t0: number, t1: number) =>
			S.rect(TA + 0.06, t0, TA + 0.1, t1, cls("rug")) +
			S.rect(TB - 0.1, t0, TB - 0.06, t1, cls("rug"));
		s += softBox(fr, [TA, TB], [0, QB + 0.02], [HEM + 0.04, QT + 0.02], "gold", 0.015, {
			top: (S) => stripes(S, 0, QB + 0.02),
			front(S) {
				let fringe = stripes(S, HEM + 0.04, QT + 0.02);

				for (let a = TA + 0.02; a < TB; a += 0.035) {
					fringe += S.line(
						[
							[a, HEM + 0.04],
							[a, HEM],
						],
						`${cls(undefined, "gold")} stroke-width="${strokeAt(
							S,
							a,
							HEM + 0.02,
							0.008
						)}"`
					);
				}

				return fringe;
			},
		});

		if (!headBehind) {
			s += headboard;
		}

		if (!footBehind) {
			s += footboard;
		}

		return {d: D + 0.06, svg: s};
	},

	chests(fr, lights) {
		const deco = (w: number, c0: number, h: number) => (S: Painter) => {
			const k = S.px(0, c0 + h / 2);
			const m = c0 + h / 2;
			const scroll = (a: number) =>
				S.line(
					[
						[a, m],
						[a + 0.04, m + 0.05],
						[a + 0.08, m + 0.065],
						[a + 0.12, m + 0.05],
						[a + 0.16, m],
					],
					`${cls(undefined, "green")} stroke-width="${n(0.022 * k)}"`
				);
			return (
				S.rect(
					-w + 0.05,
					c0 + 0.05,
					w - 0.05,
					c0 + h - 0.05,
					`fill="none" ${cls(undefined, "cream")} stroke-width="${n(0.012 * k)}"`
				) +
				paintedMedallion(S, 0, m, h * 0.24) +
				scroll(-w + 0.1) +
				scroll(w - 0.26)
			);
		};
		let s = box(fr, [-0.48, 0.48], [0.02, 0.5], [0, 0.06], "furnD");
		s += box(fr, [-0.5, 0.5], [0, 0.52], [0.06, 0.6], "furn", {front: deco(0.5, 0.06, 0.54)});
		s += box(fr, [-0.45, 0.45], [0, 0.46], [0.6, 1.05], "furn", {front: deco(0.45, 0.6, 0.45)});
		s += box(fr, [0.08, 0.32], [0.05, 0.08], [1.05, 1.34], "woodD", {
			front: (S) =>
				S.rect(0.1, 1.08, 0.3, 1.31, cls("photoSky")) +
				S.poly(
					[
						[0.1, 1.11],
						[0.16, 1.21],
						[0.2, 1.16],
						[0.24, 1.2],
						[0.3, 1.11],
					],
					cls("photoHill")
				) +
				S.rect(0.1, 1.08, 0.3, 1.11, cls("photoGrass")),
		});
		const lampAt = fr.pt(-0.25, 0.24, 1.05);
		s += sprite(lampAt, SPR.lamp) + sprite(fr.pt(0.36, 0.3, 1.05), SPR.bowl);
		lights.lamp = fr.pt(-0.25, 0.24, 1.25);
		lights.flame = sprite(lampAt, SPR.flame);
		lights.flameAt = lampAt;
		return {d: 0.52, svg: s};
	},

	desk(fr, lights) {
		const screen = (S: Painter, attrs: string) => S.rect(-0.29, 0.95, 0.29, 1.27, attrs);
		let s = box(fr, [0.56, 0.62], [0.04, 0.1], [0, 0.71], "wood");
		s += box(fr, [-0.62, -0.22], [0.02, 0.6], [0.02, 0.71], "woodL", {
			front: (S) =>
				S.rect(-0.58, 0.4, -0.26, 0.66, cls("wood")) +
				S.rect(-0.58, 0.08, -0.26, 0.34, cls("wood")) +
				S.circle(-0.42, 0.53, 0.016, cls("gold")) +
				S.circle(-0.42, 0.21, 0.016, cls("gold")),
		});
		s += box(fr, [0.56, 0.62], [0.52, 0.6], [0, 0.71], "wood");
		s += box(fr, [-0.65, 0.65], [0, 0.62], [0.71, 0.75], "wood");
		s +=
			box(fr, [-0.12, 0.12], [0.12, 0.3], [0.75, 0.77], "stand") +
			box(fr, [-0.03, 0.03], [0.18, 0.22], [0.77, 0.95], "stand");
		s += box(fr, [-0.32, 0.32], [0.16, 0.2], [0.92, 1.3], "monitor", {
			front: (S) =>
				screen(S, cls("screenDay")) +
				S.rect(-0.26, 0.98, -0.15, 1.24, `${cls("black")} opacity=".12"`) +
				[1.2, 1.15, 1.1]
					.map((c, i) =>
						S.rect(
							-0.12,
							c,
							[0.12, 0.06, 0.18][i],
							c + 0.025,
							`${cls("black")} opacity=".2"`
						)
					)
					.join("") +
				S.rect(-0.12, 0.99, 0.24, 1.03, `${cls("black")} opacity=".14"`),
		});
		s += box(fr, [-0.22, 0.12], [0.36, 0.5], [0.75, 0.765], "keys");
		s += sprite(fr.pt(0.36, 0.42, 0.75), SPR.mug) + sprite(fr.pt(0.53, 0.14, 0.75), SPR.plant);
		// The chair, pushed in: its back is to the room.
		const seat = fr.pt(0.02, 0.95, 0);
		s += chair(freeFrame(seat[0], seat[2], -fr.n[0], -fr.n[2]));
		lights.screen = fr.pt(0, 0.2, 1.11);
		lights.screenFace = screen(
			surface((a, c) => fr.pt(a, 0.201, c)),
			`fill="#a9c6ff" class="ps-yt-lit" opacity=".85"`
		);
		return {d: 1.14, svg: s};
	},

	kitchen(fr) {
		let s =
			box(fr, [-0.575, -0.545], [0, 0.32], [0.9, 1.9], "wood") +
			box(fr, [0.545, 0.575], [0, 0.32], [0.9, 1.9], "wood");

		for (const c of [1.24, 1.56]) {
			s += box(fr, [-0.545, 0.545], [0, 0.3], [c, c + 0.03], "wood");
		}

		s += box(fr, [-0.575, 0.575], [0, 0.34], [1.87, 1.9], "woodD");

		// Three plates stood on the shelf against the wall, facing the room: china discs with a rim and a well.
		const Rack = surface((a, c) => fr.pt(a, 0.05, c));

		for (let i = 0; i < 3; i++) {
			const a = -0.42 + i * 0.16;
			s +=
				Rack.circle(
					a,
					1.665,
					0.075,
					`${cls("china", "chinaB")} stroke-width="${strokeAt(Rack, a, 1.665, 0.008)}"`
				) + Rack.circle(a, 1.665, 0.042, cls("chinaB"));
		}

		s += sprite(fr.pt(0.22, 0.14, 1.59), SPR.jarA) + sprite(fr.pt(0.4, 0.14, 1.59), SPR.jarB);
		s +=
			sprite(fr.pt(-0.32, 0.15, 1.27), SPR.bowls) + sprite(fr.pt(0.05, 0.15, 1.27), SPR.cups);
		s += box(fr, [-0.55, 0.55], [0.02, 0.56], [0, 0.06], "furnD");
		// Two doors, each a raised panel in its frame, with a brass pull by the meeting edge.
		s += box(fr, [-0.575, 0.575], [0, 0.58], [0.06, 0.86], "furn", {
			front(S) {
				return (
					S.rect(-0.53, 0.12, -0.03, 0.8, cls("furnL")) +
					S.rect(0.03, 0.12, 0.53, 0.8, cls("furnL")) +
					S.rect(-0.47, 0.18, -0.09, 0.74, cls("furn")) +
					S.rect(0.09, 0.18, 0.47, 0.74, cls("furn")) +
					S.rect(-0.075, 0.4, -0.055, 0.54, cls("handle")) +
					S.rect(0.055, 0.4, 0.075, 0.54, cls("handle"))
				);
			},
		});
		// The counter, its top thick and overhanging the doors, the basin set into it.
		s += box(fr, [-0.6, 0.6], [0, 0.63], [0.86, 0.91], "woodL");
		const Top = surface((a, b) => fr.pt(a, b, 0.911));
		s +=
			Top.ellipse(
				0.22,
				0.34,
				0.18,
				0.14,
				`${cls("china", "chinaB")} stroke-width="${strokeAt(Top, 0.22, 0.34, 0.01)}"`
			) + Top.ellipse(0.22, 0.34, 0.14, 0.1, cls("chinaB"));
		s += sprite(fr.pt(-0.3, 0.3, 0.91), SPR.thermos);
		return {d: 0.62, svg: s};
	},

	washstand(fr) {
		const Wl = surface((s, t) => onWall(fr, s, t));
		let s =
			Wl.circle(0, 1.38, 0.24, cls("wood")) +
			Wl.circle(0, 1.38, 0.2, cls("mirror")) +
			Wl.poly(
				[
					[-0.1, 1.3],
					[-0.02, 1.52],
					[0.04, 1.5],
					[-0.04, 1.28],
				],
				`${cls("white")} opacity=".35"`
			);
		s += box(fr, [-0.3, 0.3], [0.02, 0.43], [0, 0.06], "furnD");
		s += box(fr, [-0.32, 0.32], [0, 0.45], [0.06, 0.78], "furn", {
			front: (S) =>
				S.rect(-0.26, 0.14, 0.26, 0.72, cls("furnL")) +
				paintedMedallion(S, 0, 0.43, 0.09) +
				S.rect(0.19, 0.38, 0.21, 0.5, cls("handle")),
		});
		s += box(fr, [-0.35, 0.35], [0, 0.48], [0.78, 0.82], "woodL");
		s +=
			sprite(fr.pt(-0.06, 0.24, 0.82), SPR.basin, 0.009) +
			sprite(fr.pt(0.24, 0.2, 0.82), SPR.jug, 0.009);
		return {d: 0.48, svg: s};
	},

	hooks(fr) {
		const Wl = surface((s, t) => onWall(fr, s, t));
		const robe: Array<[number, number]> = [
			[-0.38, 1.62],
			[-0.22, 1.62],
			[0.0, 1.5],
			[-0.04, 1.36],
			[-0.12, 1.42],
			[-0.08, 0.5],
			[-0.52, 0.5],
			[-0.48, 1.42],
			[-0.56, 1.36],
			[-0.6, 1.5],
		];
		let s = Wl.rect(-0.6, 1.62, 0.5, 1.68, cls("wood"), 6);
		s +=
			Wl.poly(robe, cls("blue")) +
			Wl.rect(-0.5, 1.02, -0.1, 1.09, cls("gold"), 3) +
			Wl.line(
				[
					[-0.36, 1.6],
					[-0.18, 1.3],
				],
				`${cls(undefined, "cream")} stroke-width="${strokeAt(Wl, -0.3, 1.4, 0.014)}"`
			);
		s +=
			Wl.ellipse(0.2, 1.52, 0.15, 0.09, cls("rug")) +
			Wl.rect(0.03, 1.47, 0.37, 1.5, cls("gold"), 3);
		s +=
			box(fr, [0.0, 0.13], [0.05, 0.36], [0, 0.32], "boots") +
			box(fr, [0.17, 0.3], [0.05, 0.36], [0, 0.32], "boots");
		return {d: 0.36, svg: s};
	},
};

/* ---------- the windows ---------- */
type Quad = Array<[number, number, number]>;
const quadPath = (q: Quad) => "M" + q.map((p) => n(p[0]) + "," + n(p[1])).join(" L") + " Z";

/** `q`'s points pushed `d` design units out from its centre: a clip that overdraws its opening (plan 2). */
function grow(q: ReadonlyArray<readonly number[]>, d: number): number[][] {
	const cx = q.reduce((t, p) => t + p[0], 0) / q.length;
	const cy = q.reduce((t, p) => t + p[1], 0) / q.length;
	return q.map((p) => {
		const l = Math.hypot(p[0] - cx, p[1] - cy) || 1;
		return [p[0] + ((p[0] - cx) / l) * d, p[1] + ((p[1] - cy) / l) * d, ...p.slice(2)];
	});
}

function bbox(q: Quad) {
	const xs = q.map((p) => p[0]);
	const ys = q.map((p) => p[1]);
	return {
		x: Math.min(...xs),
		y: Math.min(...ys),
		w: Math.max(...xs) - Math.min(...xs),
		h: Math.max(...ys) - Math.min(...ys),
	};
}

/** Seeded so every device draws the same stars. */
function rng(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** The moon in the back window: the plains' moon with its own ids; publish.ts sets its phase on every `.ps-m-ell`. */
function windowMoon(cx: number, cy: number, r: number): string {
	const size = (r / 30) * 120;
	return (
		`<g class="ps-yt-moon"><svg x="${n(cx - size / 2)}" y="${n(cy - size / 2)}" width="${n(
			size
		)}" height="${n(size)}" viewBox="-60 -60 120 120">` +
		`<defs><radialGradient id="ps-yt-m-halo"><stop offset="0" stop-color="#e3e9ff" stop-opacity=".42"/><stop offset=".55" stop-color="#c7d2ff" stop-opacity=".12"/><stop offset="1" stop-color="#c7d2ff" stop-opacity="0"/></radialGradient>` +
		`<radialGradient id="ps-yt-m-disc" cx=".42" cy=".4" r=".7"><stop offset="0" stop-color="#fdfaf0"/><stop offset=".62" stop-color="#ece5cf"/><stop offset="1" stop-color="#c9c0a6"/></radialGradient>` +
		`<mask id="ps-yt-m-phase" maskUnits="userSpaceOnUse" x="-60" y="-60" width="120" height="120"><rect x="-60" y="-60" width="120" height="120" fill="#000" ${LIT}/>` +
		`<g class="ps-m-shape"><path d="M0,-30 A30,30 0 0 1 0,30 Z" fill="#fff" ${LIT}/><ellipse class="ps-m-ell ps-yt-lit" rx="0" ry="30" fill="#000"/></g></mask></defs>` +
		`<circle r="60" fill="url(#ps-yt-m-halo)"/><circle r="30" fill="#39426a" opacity=".32" ${LIT}/>` +
		`<g mask="url(#ps-yt-m-phase)"><circle r="30" fill="url(#ps-yt-m-disc)"/></g></svg></g>`
	);
}

/** A small pine in a window's view, in the plains' pine colours: a lit and a shaded half, on a trunk. */
function viewPine(x: number, foot: number, h: number): string {
	const w = h * 0.5;
	const p = (dx: number, dy: number) => `${n(x + dx)},${n(foot - dy)}`;
	let lit = "";
	let shade = `M${p(-h * 0.035, 0)} L${p(h * 0.035, 0)} L${p(h * 0.035, h * 0.12)} L${p(
		-h * 0.035,
		h * 0.12
	)} Z`;

	for (let k = 0; k < 3; k++) {
		const base = h * 0.12 + k * h * 0.24;
		const apex = k === 2 ? h : base + h * 0.42;
		const half = (w / 2) * (1 - k * 0.24);
		lit += `M${p(0, apex)} L${p(-half, base)} L${p(0, base + h * 0.04)} Z`;
		shade += ` M${p(0, apex)} L${p(0, base + h * 0.04)} L${p(half, base)} Z`;
	}

	return `<path class="ps-l-pine-lit" d="${lit}"/><path class="ps-l-pine-sh" d="${shade}"/>`;
}

/** The view out of one window: the sky and the land in the plains' own colours, the stars, and (the back window) the moon and the low sun. */
function windowView(q: Quad, clip: string, side: boolean, seed: number): string {
	const {x: ix, y: iy, w: iw, h: ih} = bbox(q);
	const r = rng(seed);
	let s = `<g clip-path="url(#${clip})"><rect x="${n(ix)}" y="${n(iy)}" width="${n(
		iw
	)}" height="${n(ih)}" fill="url(#ps-yt-sky)"/>`;
	let stars = "";

	for (let i = 0; i < 14; i++) {
		stars += `<circle cx="${n(ix + r() * iw)}" cy="${n(iy + r() * ih * 0.5)}" r="${n(
			0.5 + r() * 0.9
		)}" fill="#fff" opacity="${n(0.5 + r() * 0.5)}" ${LIT}/>`;
	}

	s += `<g class="ps-yt-star">${stars}</g>`;

	// The land outside, as the plains draw it (2026-11-27): low hills on the horizon to the sides and the
	// outside's own three ranges out the back, the far plain with its pines, the near hill.
	const plain = iy + ih * 0.64;
	const hill = `<path style="fill: var(--ps-hill2)" d="M${n(ix)},${n(iy + ih * 0.86)} Q${n(
		ix + iw * 0.5
	)},${n(iy + ih * 0.76)} ${n(ix + iw)},${n(iy + ih * 0.84)} V${n(iy + ih)} H${n(ix)} Z"/>`;
	const far = `<rect x="${n(ix)}" y="${n(plain)}" width="${n(iw)}" height="${n(
		ih - (plain - iy)
	)}" style="fill: var(--ps-far)"/>`;
	const stand = (xs: readonly number[], sizes: readonly number[]) =>
		xs
			.map((fx, k) =>
				viewPine(
					ix + iw * fx,
					plain + ih * (0.05 + 0.04 * (k % 2)),
					ih * sizes[k % sizes.length]
				)
			)
			.join("");

	if (side) {
		const left = clip === WINDOW_CLIPS[1];
		s +=
			`<path class="ps-m-far" d="M${n(ix)},${n(iy + ih * 0.6)} Q${n(ix + iw * 0.3)},${n(
				iy + ih * 0.5
			)} ${n(ix + iw * 0.6)},${n(iy + ih * 0.58)} T${n(ix + iw)},${n(iy + ih * 0.55)} V${n(
				iy + ih
			)} H${n(ix)} Z"/>` +
			far +
			(left
				? // The river, carrying the sky, out to the left as on the plains.
				  `<path class="ps-yt-view-river" fill="url(#ps-yt-sky)" d="M${n(
						ix + iw * 0.55
				  )},${n(plain)} C${n(ix + iw * 0.4)},${n(plain + ih * 0.06)} ${n(
						ix + iw * 0.75
				  )},${n(plain + ih * 0.12)} ${n(ix + iw * 0.45)},${n(iy + ih)} L${n(
						ix + iw * 0.7
				  )},${n(iy + ih)} C${n(ix + iw * 0.95)},${n(plain + ih * 0.12)} ${n(
						ix + iw * 0.55
				  )},${n(plain + ih * 0.06)} ${n(ix + iw * 0.62)},${n(plain)} Z"/>` +
				  stand([0.08, 0.2, 0.3, 0.86], [0.22, 0.3, 0.18])
				: stand([0.12, 0.62, 0.74, 0.88], [0.2, 0.3, 0.24])) +
			hill;
	} else {
		s += windowMoon(ix + iw * 0.24, iy + ih * 0.2, 8);
		s += `<g class="ps-yt-window-sun"><circle cx="${n(ix + iw * 0.78)}" cy="${n(
			iy + ih * 0.5
		)}" r="36" fill="url(#ps-yt-sun-glow)"/><circle cx="${n(ix + iw * 0.78)}" cy="${n(
			iy + ih * 0.5
		)}" r="9" fill="#fff3cf" ${LIT}/></g>`;
		s +=
			rangesIn(ix, plain + ih * 0.02, iw, {from: 200, to: 1400}) +
			far +
			stand([0.1, 0.26, 0.47, 0.66, 0.9], [0.06, 0.09, 0.07]) +
			hill;
	}

	s += `<polygon points="${n(ix + iw * 0.1)},${n(iy)} ${n(ix + iw * 0.32)},${n(iy)} ${n(
		ix + iw * 0.02
	)},${n(iy + ih)} ${n(ix - iw * 0.2)},${n(iy + ih)}" fill="#ffffff" opacity=".07" ${LIT}/>`;
	return s + `</g>`;
}

/** The curtain left of the back window, in the window's plane (metres); the right one is its mirror. */
function curtainOutline(m: number): Array<[number, number]> {
	const o = WX - 1.1;
	const P0: [number, number] = [-1.42 - o, 2.0];
	const P1: [number, number] = [-0.92 - o, 2.0];
	const tieIn: [number, number] = [-1.14 - o, 1.15];
	const botIn: [number, number] = [-1.06 - o, 0.36];
	const botOut: [number, number] = [-1.5 - o, 0.36];
	const tieOut: [number, number] = [-1.3 - o, 1.15];
	const l: Array<[number, number]> = [
		P0,
		P1,
		...quadratic(P1, [-0.98 - o, 1.6], tieIn),
		...quadratic(tieIn, [-1.2 - o, 0.8], botIn),
		botOut,
		...quadratic(botOut, [-1.44 - o, 0.8], tieOut),
		...quadratic(tieOut, [-1.5 - o, 1.6], P0),
	];
	return l.map(([s, t]) => [s * m, t]);
}

/** The back window's pane, projected. */
function backPane(): Quad {
	return (
		[
			[-WX + FR, WY0 + FR],
			[WX - FR, WY0 + FR],
			[WX - FR, WY1 - FR],
			[-WX + FR, WY1 - FR],
		] as const
	).map(([s, t]) => project([s, t, ZW]));
}

/** A side window's pane, projected: 1.06 m wide, from 1.07 m to 1.78 m. */
function sidePane(fr: Frame): Quad {
	return (
		[
			[-0.528, 1.07],
			[0.528, 1.07],
			[0.528, 1.78],
			[-0.528, 1.78],
		] as const
	).map(([a, c]) => project(fr.pt(a, 0.03, c)));
}

/** The panes the weather shows in: the back window's, and each side window's while it is in front of the eye. */
function windowPanes(): Array<{clip: string; inner: Quad}> {
	const out = [{clip: WINDOW_CLIPS[0] as string, inner: backPane()}];

	SIDE_WINDOWS.forEach((th, i) => {
		const fr = wallFrame(th);

		if ([-0.6, 0.6].some((a) => [1.0, 1.85].some((c) => depthOf(fr.pt(a, 0.03, c)) < NEAR))) {
			return;
		}

		out.push({clip: WINDOW_CLIPS[i + 1], inner: sidePane(fr)});
	});

	return out;
}

/** A cloud in the plains' own cloud colour. */
/** A cloud's four ellipses, about its middle: 47 × 23 design units at scale 1. */
const CLOUD_SHAPE =
	'<ellipse cx="0" cy="4" rx="22" ry="6"/><ellipse cx="-8" cy="0" rx="9" ry="7"/><ellipse cx="5" cy="-2" rx="11" ry="9"/><ellipse cx="15" cy="2" rx="8" ry="6"/>';

function cloud(
	x: number,
	y: number,
	k: number,
	style = "fill: var(--ps-cloud)",
	extra = ""
): string {
	return `<g class="ps-yt-cloud${
		extra ? ` ${extra}` : ""
	}" style="${style}" transform="translate(${n(x)},${n(y)}) scale(${
		Math.round(k * 100) / 100
	})">${CLOUD_SHAPE}</g>`;
}

/** How many of a pane's `k` (the back window's count) it draws: by its width, halved on a phone. */
const paneCount = (k: number, width: number, backWidth: number, phone: boolean) =>
	Math.max(1, Math.round(k * (width / backWidth) * (phone ? 0.5 : 1)));

/** The crown's opening, as the eye sees it. */
const crownOpening = () => circle3(0, CROWN_H, 0, CROWN_R - 0.06).map(project);

/** How many clouds the back window shows in each fair weather. */
const FAIR_CLOUDS: Partial<Record<Weather, number>> = {clear: 2, wind: 4, heat: 1};

/**
 * The day's weather in the windows (docs/projects/ps-yurt.md §7), still: the
 * contents of `.ps-yt-weather`, rebuilt when the day's weather changes. Each
 * window is veiled as the plains are on a wet day (their own --ps-veil);
 * counts are the back window's, scaled by each window's width and halved on a
 * phone, from fixed seeds so every device draws the same.
 */
export function windowWeather(weather: Weather, phone: boolean): string {
	const panes = windowPanes();
	const backWidth = bbox(panes[0].inner).w;
	let out = `<g data-weather="${weather}">`;

	panes.forEach((pane, i) => {
		const {x: ix, y: iy, w: iw, h: ih} = bbox(pane.inner);
		const r = rng(211 + i * 17 + WEATHERS.indexOf(weather) * 101);
		const count = (k: number) => paneCount(k, iw, backWidth, phone);
		let s = `<g clip-path="url(#${pane.clip})">`;
		s += `<rect x="${n(ix)}" y="${n(iy)}" width="${n(iw)}" height="${n(
			ih
		)}" style="fill: var(--ps-veil-c); opacity: var(--ps-veil)"/>`;
		const fair = FAIR_CLOUDS[weather];

		if (fair !== undefined) {
			for (let k = 0; k < count(fair); k++) {
				s += cloud(
					ix + iw * (0.15 + 0.7 * r()),
					iy + ih * (0.1 + 0.25 * r()),
					(0.55 + 0.35 * r()) * (iw / backWidth) ** 0.3,
					undefined,
					"ps-yt-still-clouds"
				);
			}
		} else {
			const deck =
				weather === "storm"
					? "color-mix(in oklab, var(--ps-cloud), #000 30%)"
					: weather === "rain"
					? "color-mix(in oklab, var(--ps-cloud), #000 10%)"
					: "color-mix(in oklab, var(--ps-cloud), #fff 30%)";
			s += `<rect class="ps-yt-deck" x="${n(ix)}" y="${n(iy)}" width="${n(iw)}" height="${n(
				ih * 0.4
			)}" style="fill: ${deck}" opacity=".85"/>`;
			s +=
				cloud(ix + iw * 0.25, iy + ih * 0.32, 1.3, `fill: ${deck}`) +
				cloud(ix + iw * 0.7, iy + ih * 0.36, 1.5, `fill: ${deck}`);
		}

		if (weather === "rain" || weather === "storm") {
			for (let k = 0; k < count(weather === "storm" ? 60 : 34); k++) {
				const x = ix + r() * (iw + 10);
				const y = iy + r() * ih;
				s += `<line class="ps-yt-rain ps-yt-still-weather" x1="${n(x)}" y1="${n(
					y
				)}" x2="${n(x - 3)}" y2="${n(
					y + 9
				)}" style="stroke: color-mix(in oklab, var(--ps-sky-hor), #fff 45%)" stroke-width="1" opacity=".6"/>`;
			}

			for (let k = 0; k < count(14); k++) {
				s += `<circle class="ps-yt-drop ps-yt-lit" cx="${n(
					ix + 4 + r() * (iw - 8)
				)}" cy="${n(iy + 4 + r() * (ih - 8))}" r="${n(
					1 + r() * 1.2
				)}" fill="#ffffff" opacity=".32"/>`;
			}
		}

		if (weather === "snow") {
			for (let k = 0; k < count(44); k++) {
				s += `<circle class="ps-yt-flake ps-yt-still-weather" cx="${n(
					ix + r() * iw
				)}" cy="${n(iy + r() * ih)}" r="${n(
					0.7 + r() * 1.2
				)}" style="fill: color-mix(in oklab, var(--ps-cloud), #fff 60%)"/>`;
			}

			s += `<path class="ps-yt-drift" style="fill: color-mix(in oklab, var(--ps-cloud), #fff 70%)" d="M${n(
				ix
			)},${n(iy + ih)} L${n(ix)},${n(iy + ih - 5)} Q${n(ix + iw * 0.2)},${n(iy + ih - 9)} ${n(
				ix + iw * 0.42
			)},${n(iy + ih - 6)} Q${n(ix + iw * 0.7)},${n(iy + ih - 3)} ${n(ix + iw)},${n(
				iy + ih - 8
			)} L${n(ix + iw)},${n(iy + ih)} Z"/>`;
		}

		out += s + `</g>`;
	});

	return out + `</g>`;
}

/**
 * The windows' motion (plan 2, docs/projects/ps-yurt.md §8): one HTML pane over each window and the
 * crown's opening, placed in the room's design frame (room-motion.ts reads --x/--y/--w/--h) and clipped
 * to the glass, holding what moves in the day's weather: the fair weathers' clouds, drifting; the
 * plains' rain tiles (rain.ts); snow; the storm's flash; and stars that twinkle. As many as the still
 * windows draw (windowWeather), halved on a phone; built on the same weather trigger.
 */
export function windowMotion(weather: Weather, phone: boolean): string {
	const windows = windowPanes();
	const backWidth = bbox(windows[0].inner).w;
	const pct = (v: number) => `${(v * 100).toFixed(2)}%`;
	const panes: Array<{name: string; q: ReadonlyArray<readonly number[]>; window: boolean}> = [
		...windows.map((w) => ({name: w.clip.replace("ps-yt-win-", ""), q: w.inner, window: true})),
		{name: "crown", q: crownOpening(), window: false},
	];
	const fair = FAIR_CLOUDS[weather];

	return panes
		.map((pane, i) => {
			const {x, y, w, h} = bbox(pane.q as Quad);
			const r = rng(611 + i * 17 + WEATHERS.indexOf(weather) * 101);
			const count = (k: number) => paneCount(k, w, backWidth, phone);
			const clip = pane.q
				.map((p) => `${pct((p[0] - x) / w)} ${pct((p[1] - y) / h)}`)
				.join(",");
			let s = "";
			// Stars first: the farthest thing in a pane.
			const stars = pane.window ? (pane.name === "back" ? 6 : 4) : 5;
			s += `<div class="ps-ym-stars">`;

			for (let k = 0; k < stars; k++) {
				const tw = 3 + 3 * r();
				s += `<i class="ps-ym-tw" style="left:${pct(r())};top:${pct(
					r() * (pane.window ? 0.55 : 1)
				)};--tw:${tw.toFixed(2)}s;--twl:${(-r() * 6).toFixed(2)}s"></i>`;
			}

			s += `</div>`;

			if (pane.window && fair !== undefined) {
				for (let k = 0; k < count(fair); k++) {
					const kk = (0.55 + 0.35 * r()) * (w / backWidth) ** 0.3;
					const top = 0.1 + 0.25 * r();
					const cd =
						(70 + 30 * r()) * Math.sqrt(w / backWidth) * (weather === "wind" ? 0.5 : 1);
					const d = Number(cd.toFixed(1));
					const dl = Number((-r() * cd).toFixed(1));
					// --cp: where the delay puts it in its loop, its place at rest (plains.ts; the red team's C1).
					s += `<div class="ps-ym-cloud" style="top:${pct(top)};width:${pct(
						(47 * kk) / w
					)};--cd:${d}s;--cdl:${dl}s;--cp:${Number(
						(-dl / d).toFixed(4)
					)}"><svg viewBox="-23 -12 47 23" style="fill: var(--ps-cloud)">${CLOUD_SHAPE}</svg></div>`;
				}
			}

			if (pane.window && (weather === "rain" || weather === "storm")) {
				s += rainTiles(count(weather === "storm" ? 60 : 34), {width: w, height: h});
			}

			if (pane.window && weather === "snow") {
				let flakes = "";

				for (let k = 0; k < count(44); k++) {
					flakes += `<i style="left:${(r() * 105).toFixed(1)}%;--fs:${(
						(2 + 3.4 * r()) /
						16
					).toFixed(3)}rem;--fd:${(3 + 3 * r()).toFixed(2)}s;--fdl:${(-r() * 6).toFixed(
						2
					)}s;--fx:${(-30 + 50 * r()).toFixed(1)}cqw;opacity:${(0.5 + 0.5 * r()).toFixed(
						2
					)}"></i>`;
				}

				s += `<div class="ps-snow">${flakes}</div>`;
			}

			if (pane.window && weather === "storm") {
				s += `<div class="ps-flash"></div>`;
			}

			return `<div class="ps-ym-pane" data-pane="${pane.name}" style="--x:${n(x)};--y:${n(
				y
			)};--w:${n(w)};--h:${n(h)};clip-path:polygon(${clip})">${s}</div>`;
		})
		.join("");
}

/** The room, as the page shows it. */
export function roomMarkup(): string {
	// The walls and the roof.
	const top = arc(WALL_H);
	const base = arc(0);
	const wallPoly = pts([...top, ...base.slice().reverse()]);
	const roofPoly = pts([...top, [top[top.length - 1][0], -9000], [top[0][0], -9000]]);
	const ribbon = (h0: number, h1: number, r: number, attrs: string) =>
		`<polygon points="${pts([...arc(h0, r), ...arc(h1, r).reverse()])}" ${attrs}/>`;
	let lattice = "";

	for (let th0 = -180; th0 < 180; th0 += 5) {
		for (const dir of [1, -1]) {
			const l: P3[] = [];

			for (let k = 0; k <= 10; k++) {
				l.push(wallPt(th0 + (dir * 28.6 * k) / 10, (WALL_H * k) / 10, R - 0.03));
			}

			lattice += polyRuns(l, cls(undefined, "lattice"), 0.028);
		}
	}

	let poles = "";

	for (let th = 0; th < 360; th += 5) {
		poles += line3(
			wallPt(th, WALL_H - 0.02, R - 0.06),
			wallPt(th, CROWN_H - 0.04, CROWN_R + 0.06),
			`${cls(undefined, "pole")} stroke-linecap="round"`,
			0.04,
			7
		);
	}

	let boards = "";

	for (let x = -R; x <= R; x += 0.22) {
		const zz = Math.sqrt(Math.max(0, R * R - x * x));
		boards += line3([x, 0, -zz], [x, 0, zz], cls(undefined, "board"), 0.012);
	}

	// The crown: its ring, the sky through it, its bent ribs.
	const opening = crownOpening();
	const openingPts = pts(opening);
	const openingOut = pts(grow(opening, 2));
	const arch = (f: number, alongX: boolean) => {
		const l: P3[] = [];
		const rr = CROWN_R - 0.06;

		for (let k = 0; k <= 12; k++) {
			const u = -rr + (2 * rr * k) / 12;
			const h = CROWN_H + 0.22 * (1 - (u / rr) ** 2);
			l.push(alongX ? [u, h, f] : [f, h, u]);
		}

		return l;
	};
	const ribs = [arch(-0.28, true), arch(0.28, true), arch(-0.28, false), arch(0.28, false)]
		.map((l) => polyRuns(l, cls(undefined, "crown"), 0.045))
		.join("");
	let crownStars = "";
	const r = rng(31);

	for (let i = 0; i < 7; i++) {
		const a = r() * 2 * Math.PI;
		const d = Math.sqrt(r()) * 0.55;
		const p = project([Math.cos(a) * d, CROWN_H + 0.5, Math.sin(a) * d]);
		crownStars += `<circle cx="${n(p[0])}" cy="${n(p[1])}" r="${n(
			0.8 + r()
		)}" fill="#fff" opacity=".85" ${LIT}/>`;
	}

	// The windows: the wide back one with curtains, and one on each side.
	const W = surface((s, t) => [s, t, ZW]);
	const Cp = surface((s, t) => [s, t, ZW - 0.05]);
	const backInner = backPane();
	const backOuter: Quad = (
		[
			[-WX, WY0],
			[WX, WY0],
			[WX, WY1],
			[-WX, WY1],
		] as const
	).map(([s, t]) => project([s, t, ZW]));
	const views: Array<{inner: Quad; clip: string; side: boolean; seed: number}> = [
		{inner: backInner, clip: WINDOW_CLIPS[0], side: false, seed: 77},
	];
	let back = `<path ${cls("wood")} fill-rule="evenodd" d="${quadPath(backOuter)} ${quadPath(
		backInner
	)}"/>`;

	for (const x of [-WX / 2, 0, WX / 2]) {
		back += W.rect(x - 0.025, WY0 + FR, x + 0.025, WY1 - FR, cls("wood"));
	}

	back += W.rect(-WX + FR, 1.36, WX - FR, 1.41, cls("wood"));
	back += `<polygon points="${pts(backInner)}" fill="none" ${cls(
		undefined,
		"woodD"
	)} stroke-width="1.5"/>`;
	back += abox([-WX - 0.12, WX + 0.12], [WY0 - 0.06, WY0], [ZW - 0.16, ZW + 0.02], "woodL");
	back +=
		sprite([-WX + 0.32, WY0, ZW - 0.08], SPR.plant, 0.0085) +
		sprite([WX - 0.4, WY0, ZW - 0.08], SPR.jug, 0.0075);
	let curtains = "";

	for (const m of [1, -1]) {
		const o = WX - 1.1;
		curtains += Cp.poly(curtainOutline(m), cls("curtain"));
		curtains += (
			[
				[
					[-1.25 - o, 1.98],
					[-1.24 - o, 1.6],
					[-1.22 - o, 1.17],
				],
				[
					[-1.05 - o, 1.98],
					[-1.08 - o, 1.6],
					[-1.18 - o, 1.17],
				],
				[
					[-1.2 - o, 1.13],
					[-1.26 - o, 0.8],
					[-1.3 - o, 0.44],
				],
			] as const
		)
			.map(([a, c, b]) =>
				Cp.line(
					[a, ...quadratic(a, c, b)].map(([x, y]) => [x * m, y] as [number, number]),
					`${cls(undefined, "cream")} stroke-width="${strokeAt(
						Cp,
						(-1.2 - o) * m,
						1.2,
						0.012
					)}" opacity=".55"`
				)
			)
			.join("");
		curtains += Cp.ellipse((-1.22 - o) * m, 1.15, 0.1, 0.04, cls("gold"));
	}

	// The rod, in front of the curtains' heads: its brackets back to the wall, the rod, its finials.
	const {height: RH, end: RE, depth: RZ} = CURTAIN_ROD;
	const Rd = surface((s, t) => [s, t, RZ]);
	curtains +=
		`<g class="ps-yt-rod">` +
		[-1, 1]
			.map((m) =>
				abox(
					[m * 1.9 - 0.015, m * 1.9 + 0.015],
					[RH - 0.035, RH + 0.01],
					[RZ, Math.sqrt(R * R - 1.9 * 1.9)],
					"woodD"
				)
			)
			.join("") +
		line3(
			[-RE, RH, RZ],
			[RE, RH, RZ],
			`${cls(undefined, "woodD")} stroke-linecap="round"`,
			0.035
		) +
		[-1, 1].map((m) => Rd.circle(m * RE, RH, 0.028, cls("gold"))).join("") +
		`</g>`;

	let sideWindows = "";

	SIDE_WINDOWS.forEach((th, i) => {
		const fr = wallFrame(th);
		const S = surface((a, c) => fr.pt(a, 0.03, c));
		const corners: Array<[number, number]> = [
			[-0.6, 1.0],
			[0.6, 1.0],
			[0.6, 1.85],
			[-0.6, 1.85],
		];

		if (corners.some(([a, c]) => depthOf(fr.pt(a, 0.03, c)) < NEAR)) {
			return;
		}

		const innerQ = sidePane(fr);
		const outer: Quad = corners.map(([a, c]) => project(fr.pt(a, 0.03, c)));
		views.push({inner: innerQ, clip: WINDOW_CLIPS[i + 1], side: true, seed: 101 + i});
		sideWindows += piece(
			i === 0 ? "window-left" : "window-right",
			`<path ${cls("wood")} fill-rule="evenodd" d="${quadPath(outer)} ${quadPath(
				innerQ
			)}"/>` +
				S.rect(-0.022, 1.07, 0.022, 1.78, cls("wood")) +
				S.rect(-0.53, 1.42, 0.53, 1.46, cls("wood")) +
				`<polygon points="${pts(innerQ)}" fill="none" ${cls(
					undefined,
					"woodD"
				)} stroke-width="1.2"/>` +
				box(fr, [-0.68, 0.68], [0, 0.12], [0.94, 1.0], "woodL") +
				S.rect(-0.72, 1.86, 0.72, 1.93, cls("curtain")) +
				S.rect(-0.72, 1.86, 0.72, 1.875, cls("rugB"))
		);
	});

	// The round stove and its pipe through the roof.
	const doorMap = (s: number, t: number): P3 => {
		const ph = STOVE_FACE + s / STOVE.r;
		return [
			STOVE.x + (STOVE.r + 0.003) * Math.cos(ph),
			t,
			STOVE.z + (STOVE.r + 0.003) * Math.sin(ph),
		];
	};
	const Dr = surface(doorMap);
	// The pipe stands a little behind the stove's middle and rises to the roof above it.
	const {x: pipeX, z: pipeZ} = PIPE;
	const pipeTop = roofHeightAt(Math.hypot(pipeX, pipeZ));
	// The stove, drawn twice: once in its place among what stands, once over the glows (body, below).
	const stoveBody =
		STOVE_FEET.map(([fx, fz]) =>
			abox([fx - 0.03, fx + 0.03], [0, 0.16], [fz - 0.03, fz + 0.03], "ironD")
		).join("") +
		cylinderSide(STOVE.x, STOVE.z, STOVE.r + 0.02, 0.14, 0.18, cls("ironTop")) +
		cylinderSide(STOVE.x, STOVE.z, STOVE.r, 0.18, 0.72, 'fill="url(#ps-yt-iron)"') +
		cylinderSide(STOVE.x, STOVE.z, STOVE.r + 0.008, 0.22, 0.25, 'fill="url(#ps-yt-brass)"') +
		cylinderSide(STOVE.x, STOVE.z, STOVE.r + 0.008, 0.64, 0.67, 'fill="url(#ps-yt-brass)"') +
		Dr.arched(
			-0.17,
			0.17,
			0.29,
			0.5,
			0.08,
			`${cls("ironD", "doorEdge")} stroke-width="${strokeAt(Dr, 0, 0.4, 0.012)}"`
		) +
		Dr.rect(-0.11, 0.26, 0.11, 0.28, cls("ironD")) +
		Dr.circle(0.148, 0.42, 0.017, cls("gold")) +
		cylinderSide(STOVE.x, STOVE.z, STOVE.r + 0.04, 0.72, 0.76, cls("ironTop")) +
		poly3(circle3(STOVE.x, 0.76, STOVE.z, STOVE.r + 0.04), cls("ironTopL")) +
		poly3(
			circle3(STOVE.x, 0.762, STOVE.z, STOVE.r - 0.06),
			`fill="none" ${cls(undefined, "ironRing")} stroke-width="1.2"`
		) +
		cylinderSide(pipeX, pipeZ, 0.11, 0.76, 0.84, cls("collar")) +
		poly3(circle3(pipeX, 0.84, pipeZ, 0.11, 24), cls("collarTop")) +
		cylinderSide(pipeX, pipeZ, 0.075, 0.84, pipeTop, cls("pipe")) +
		[1.1, 1.6, 2.1]
			.filter((h) => h + 0.04 < pipeTop - 0.1)
			.map((h) => cylinderSide(pipeX, pipeZ, 0.088, h, h + 0.04, cls("pipeBand")))
			.join("") +
		// Where it passes through the roof's felt, a collar.
		cylinderSide(pipeX, pipeZ, 0.13, pipeTop - 0.06, pipeTop, cls("collar")) +
		sprite(onStove(-0.17, 0.76, 0.1), SPR.pot, 0.0055) +
		sprite(onStove(0.18, 0.76, 0.12), SPR.kettle, 0.0055);
	const stove = piece("stove", stoveBody);
	// The pot's still steam, drawn once, over the stove's second drawing: the first is covered by the
	// second, and two .45 strokes read as 0.70 (the red team's D3).
	const potSteam = sprite(
		onStove(-0.17, 0.76, 0.1),
		`<g class="ps-yt-still-steam ps-yt-burn">${SPR.steam}</g>`,
		0.0055
	);
	// The door's opening: its sides, its foot and the arch's rise, on the door's surface; and its outline,
	// the foot sampled as it curves round the stove.
	const OPEN = {s0: -0.125, s1: 0.125, t0: 0.33, t1: 0.48, rise: 0.06};
	const doorOutline: Array<[number, number]> = [];

	for (let i = 0; i <= 4; i++) {
		doorOutline.push([OPEN.s0 + ((OPEN.s1 - OPEN.s0) * i) / 4, OPEN.t0]);
	}

	doorOutline.push([OPEN.s1, OPEN.t1]);

	for (let i = 1; i < 12; i++) {
		const u = i / 12;
		doorOutline.push([
			OPEN.s1 + (OPEN.s0 - OPEN.s1) * u,
			OPEN.t1 + OPEN.rise * Math.sin(Math.PI * u),
		]);
	}

	doorOutline.push([OPEN.s0, OPEN.t1]);
	// The still fire (still, reduced motion, the drawer): one frame of the moving fire (flames.ts), the flat
	// flame space stretched over the opening's box on screen and clipped to the opening.
	const doorOnScreen = doorOutline.map(([s, t]) => project(doorMap(s, t)));
	const doorXs = doorOnScreen.map((q) => q[0]);
	const doorYs = doorOnScreen.map((q) => q[1]);
	const ob = {
		x: Math.min(...doorXs),
		y: Math.min(...doorYs),
		w: Math.max(...doorXs) - Math.min(...doorXs),
		h: Math.max(...doorYs) - Math.min(...doorYs),
	};
	const cb = FLAME_CORE.box;
	const coreStill =
		`<radialGradient id="ps-yt-sfl-core">${FLAME_CORE.stops
			.map(([o, c, op]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${op}"/>`)
			.join("")}</radialGradient>` +
		`<ellipse cx="${(cb.x0 + cb.x1) / 2}" cy="${(cb.y0 + cb.y1) / 2}" rx="${
			(cb.x1 - cb.x0) / 2
		}" ry="${(cb.y1 - cb.y0) / 2}" fill="url(#ps-yt-sfl-core)"/>`;
	const fire =
		`<clipPath id="ps-yt-door"><polygon points="${pts(doorOnScreen)}"/></clipPath>` +
		`<g clip-path="url(#ps-yt-door)"><svg x="${n(ob.x)}" y="${n(ob.y)}" width="${n(
			ob.w
		)}" height="${n(ob.h)}" viewBox="0 0 ${FLAME_SPACE.width} ${
			FLAME_SPACE.height
		}" preserveAspectRatio="none">` +
		FLAME_LAYERS.map(
			(L, li) => (li === 1 ? coreStill : "") + flameShape(L, 0, `ps-yt-sfl-${L.name}`)
		).join("") +
		`</svg></g>`;
	// The firebox behind the door and its coal bed at the foot (§16), room colours the legibility sweep sees
	// (indoor.ts): dull embers, always drawn, the fire burning over them; by day, with the stove out, the dark
	// door and a few embers are all it shows, and by night the hour's shade darkens it behind the flames.
	const embers =
		Dr.arched(OPEN.s0, OPEN.s1, OPEN.t0, OPEN.t1, OPEN.rise, cls("firebox")) +
		Dr.arched(
			OPEN.s0,
			OPEN.s1,
			OPEN.t0,
			OPEN.t1,
			OPEN.rise,
			`fill="${FIREBOX_BURNING}" class="ps-yt-lit ps-yt-cavity"`
		) +
		Dr.rect(-0.12, 0.33, 0.12, 0.356, cls("coalBed")) +
		Dr.circle(-0.075, 0.345, 0.018, `fill="#b5401c" opacity=".75" ${LIT}`) +
		Dr.circle(-0.015, 0.342, 0.022, `fill="#d2582a" opacity=".7" ${LIT}`) +
		Dr.circle(0.045, 0.346, 0.017, `fill="#9c2f1a" opacity=".8" ${LIT}`) +
		Dr.circle(0.09, 0.343, 0.014, `fill="#c04a20" opacity=".7" ${LIT}`);
	const door = project(doorMap(0, 0.42));

	// The dining table on its pedestal and four feet, all of it on the rug: its top with a thick edge.
	const table = () => {
		const [tx, tz] = TABLE;
		const foot = (dx: number, dz: number) =>
			abox(
				dx === 0
					? [tx - 0.04, tx + 0.04]
					: dx > 0
					? [tx + 0.05, tx + 0.32]
					: [tx - 0.32, tx - 0.05],
				[0, 0.06],
				dz === 0
					? [tz - 0.04, tz + 0.04]
					: dz > 0
					? [tz + 0.05, tz + 0.32]
					: [tz - 0.32, tz - 0.05],
				"furnD"
			);
		let s = foot(0, 1) + foot(-1, 0) + foot(1, 0);
		s +=
			cylinderSide(tx, tz, 0.065, 0.06, 0.71, 'fill="url(#ps-yt-wood)"') +
			cylinderSide(tx, tz, 0.1, 0.22, 0.36, 'fill="url(#ps-yt-wood)"') +
			cylinderSide(tx, tz, 0.12, 0.66, 0.7, cls("furnD"));
		s += foot(0, -1);
		s +=
			cylinderSide(tx, tz, 0.52, 0.7, 0.755, cls("furnD")) +
			poly3(circle3(tx, 0.755, tz, 0.52), cls("furn"));
		const T = surface((a, b) => [tx + a, 0.756, tz + b]);
		s +=
			T.ellipse(
				0,
				0,
				0.38,
				0.38,
				`fill="none" ${cls(undefined, "cream")} stroke-width="${strokeAt(T, 0, 0, 0.012)}"`
			) +
			T.ellipse(
				0,
				0,
				0.46,
				0.46,
				`fill="none" ${cls(undefined, "blue")} stroke-width="${strokeAt(
					T,
					0,
					0,
					0.012
				)}" stroke-dasharray="${strokeAt(T, 0, 0, 0.05)} ${strokeAt(T, 0, 0, 0.05)}"`
			);
		s +=
			sprite([tx + 0.08, 0.755, tz + 0.2], SPR.teapot, 0.006) +
			sprite([tx - 0.1, 0.755, tz - 0.05], SPR.dumplings, 0.006) +
			sprite([tx + 0.24, 0.755, tz - 0.14], SPR.tbowl, 0.006);
		return piece("table", s);
	};

	// The pieces along the wall, then everything standing, far to near.
	const lights: Lights = {};
	/** Each piece along the wall: its frame and how far it stands out, for its shadow on the floor. */
	const footprints: Array<{fr: Frame; d: number}> = [];
	const things: Array<{z: number; svg: string}> = ROOM.map(([kind, th]) => {
		const fr = wallFrame(th);
		const p = PIECES[kind](fr, lights);
		footprints.push({fr, d: p.d});
		return {z: depthOf(fr.pt(0, p.d, 0.6)), svg: piece(kind, p.svg)};
	});
	things.push({z: depthOf(onStove(0, 0.4, STOVE.r)), svg: stove});
	things.push({z: depthOf([TABLE[0], 0.4, TABLE[1]]), svg: table()});

	for (const c of CHAIRS) {
		things.push({z: depthOf([c.x, 0.5, c.z]), svg: chair(freeFrame(c.x, c.z, c.nx, c.nz))});
	}

	things.push({
		z: depthOf([BENCH.x, 0.4, BENCH.z]),
		svg: piece(
			"bench",
			partsInFrame(freeFrame(BENCH.x, BENCH.z, BENCH.nx, BENCH.nz), BENCH_PARTS)
		),
	});

	things.push({
		z: depthOf([BASKET[0], 0.3, BASKET[1]]),
		svg: piece("basket", sprite([BASKET[0], 0, BASKET[1]], SPR.basket, 0.0062)),
	});
	const standing = things
		.filter((t) => t.z > NEAR)
		.sort((a, b) => b.z - a.z)
		.map((t) => t.svg)
		.join("");

	// The floor's things: the rug, the hearth, the light that falls there.
	const Fl = surface((a, b) => [a, 0.005, b]);
	// Soft contact shadows under what stands on the floor (2026-11-27): each a soft-edged ellipse on its
	// footprint, the whole set light (a fifth black at most), drawn under the standing pieces.
	const SH = 'fill="url(#ps-yt-shadow)"';
	const Fs = surface((a, b) => [a, 0.006, b]);
	const shadows =
		`<g class="ps-yt-shadows" opacity=".18">` +
		Fs.ellipse(STOVE.x, STOVE.z, STOVE.r + 0.12, STOVE.r + 0.12, SH) +
		Fs.ellipse(TABLE[0], TABLE[1], 0.5, 0.5, SH) +
		CHAIRS.map((c) => Fs.ellipse(c.x, c.z, 0.28, 0.28, SH)).join("") +
		surface((a, b) => freeFrame(BENCH.x, BENCH.z, BENCH.nx, BENCH.nz).pt(a, b, 0.006)).ellipse(
			0,
			0,
			0.62,
			0.24,
			SH
		) +
		Fs.ellipse(BASKET[0], BASKET[1], 0.2, 0.2, SH) +
		footprints
			.map(({fr, d}) =>
				surface((a, b) => fr.pt(a, b, 0.006)).ellipse(0, d / 2, 0.62, d / 2 + 0.08, SH)
			)
			.join("") +
		`</g>`;
	const rug =
		Fl.ellipse(0, 0.1, RUG_R, RUG_R, cls("rug"), 72) +
		Fl.ellipse(
			0,
			0.1,
			RUG_R - 0.14,
			RUG_R - 0.14,
			`fill="none" ${cls(undefined, "rugB")} stroke-width="${strokeAt(Fl, 0, 0.1, 0.05)}"`,
			72
		) +
		Fl.ellipse(
			0,
			0.1,
			RUG_R - 0.64,
			RUG_R - 0.64,
			`fill="none" ${cls(undefined, "rugB")} stroke-width="${strokeAt(Fl, 0, 0.1, 0.015)}"`,
			72
		);
	const lamp = lights.lamp && depthOf(lights.lamp) > NEAR ? project(lights.lamp) : null;
	const screenAt = lights.screen && depthOf(lights.screen) > NEAR ? project(lights.screen) : null;
	const backBox = bbox(backInner);

	const defs =
		`<defs>` +
		`<linearGradient id="ps-yt-roof" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="380"><stop offset="0" ${cls(
			"roofA",
			undefined,
			"ps-yt-stop"
		)}/><stop offset="1" ${cls("roofB", undefined, "ps-yt-stop")}/></linearGradient>` +
		`<linearGradient id="ps-yt-wall" gradientUnits="userSpaceOnUse" x1="0" y1="300" x2="0" y2="700"><stop offset="0" ${cls(
			"wallA",
			undefined,
			"ps-yt-stop"
		)}/><stop offset="1" ${cls("wallB", undefined, "ps-yt-stop")}/></linearGradient>` +
		`<linearGradient id="ps-yt-floor" gradientUnits="userSpaceOnUse" x1="0" y1="470" x2="0" y2="820"><stop offset="0" ${cls(
			"floorA",
			undefined,
			"ps-yt-stop"
		)}/><stop offset="1" ${cls("floorB", undefined, "ps-yt-stop")}/></linearGradient>` +
		`<linearGradient id="ps-yt-iron" x1="0" y1="0" x2="1" y2="0"><stop offset="0" ${cls(
			"ironD",
			undefined,
			"ps-yt-stop"
		)}/><stop offset=".38" ${cls("ironLit", undefined, "ps-yt-stop")}/><stop offset=".62" ${cls(
			"ironMid",
			undefined,
			"ps-yt-stop"
		)}/><stop offset="1" ${cls("ironShadow", undefined, "ps-yt-stop")}/></linearGradient>` +
		`<linearGradient id="ps-yt-brass" x1="0" y1="0" x2="1" y2="0"><stop offset="0" ${cls(
			"brassA",
			undefined,
			"ps-yt-stop"
		)}/><stop offset=".38" ${cls("brassB", undefined, "ps-yt-stop")}/><stop offset=".62" ${cls(
			"brassC",
			undefined,
			"ps-yt-stop"
		)}/><stop offset="1" ${cls("brassD", undefined, "ps-yt-stop")}/></linearGradient>` +
		`<linearGradient id="ps-yt-wood" x1="0" y1="0" x2="1" y2="0"><stop offset="0" ${cls(
			"woodRed",
			undefined,
			"ps-yt-stop"
		)}/><stop offset=".4" ${cls("furnL", undefined, "ps-yt-stop")}/><stop offset="1" ${cls(
			"woodRed",
			undefined,
			"ps-yt-stop"
		)}/></linearGradient>` +
		`<linearGradient id="ps-yt-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color: var(--ps-sky-top)"/><stop offset=".55" style="stop-color: var(--ps-sky-mid)"/><stop offset="1" style="stop-color: var(--ps-sky-hor)"/></linearGradient>` +
		`<radialGradient id="ps-yt-sun-glow"><stop offset="0" stop-color="#ffe2a0" stop-opacity=".9"/><stop offset="1" stop-color="#ffb060" stop-opacity="0"/></radialGradient>` +
		`<radialGradient id="ps-yt-g-fire"><stop offset="0" stop-color="#ffa040" stop-opacity=".85"/><stop offset=".45" stop-color="#ff7a2a" stop-opacity=".32"/><stop offset="1" stop-color="#ff6a20" stop-opacity="0"/></radialGradient>` +
		`<radialGradient id="ps-yt-g-lamp"><stop offset="0" stop-color="#ffd08a" stop-opacity=".8"/><stop offset="1" stop-color="#ffb060" stop-opacity="0"/></radialGradient>` +
		`<radialGradient id="ps-yt-g-screen"><stop offset="0" stop-color="#9fbaff" stop-opacity=".55"/><stop offset="1" stop-color="#7f9fff" stop-opacity="0"/></radialGradient>` +
		`<radialGradient id="ps-yt-shadow"><stop offset="0" stop-color="#000"/><stop offset=".6" stop-color="#000" stop-opacity=".7"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>` +
		`<radialGradient id="ps-yt-g-golden"><stop offset="0" stop-color="#ffb070" stop-opacity=".9"/><stop offset="1" stop-color="#ffb070" stop-opacity="0"/></radialGradient>` +
		`<clipPath id="ps-yt-roof-clip"><polygon points="${roofPoly}"/></clipPath>` +
		`<clipPath id="ps-yt-wall-clip"><polygon points="${wallPoly}"/></clipPath>` +
		// The views out and their weather overdraw their openings by 2 units (the frames cover it).
		views
			.map(
				(v) =>
					`<clipPath id="${v.clip}"><polygon points="${pts(
						grow(v.inner, 2)
					)}"/></clipPath>`
			)
			.join("") +
		`<clipPath id="ps-yt-crown"><polygon points="${openingPts}"/></clipPath>` +
		`<clipPath id="ps-yt-crown-out"><polygon points="${openingOut}"/></clipPath>` +
		// The front's holes: exactly the openings, where the back shows through. A clip, not a mask: a
		// mask re-rasters its whole svg off the pixel grid at a fractional scale.
		`<clipPath id="ps-yt-openings"><path clip-rule="evenodd" d="M-3000,-3000H5000V5000H-3000Z${[
			...views.map((v) => v.inner),
			opening,
		]
			.map((q) => `M${q.map((p) => `${n(p[0])},${n(p[1])}`).join("L")}Z`)
			.join("")}"/></clipPath>` +
		`</defs>`;

	// What is seen through the openings (plan 2, task 2): the views out, their weather (the scene fills
	// it for the day), the crown's sky, its veil and its still stars, each overdrawing its opening.
	const behind =
		views.map((v) => windowView(v.inner, v.clip, v.side, v.seed)).join("") +
		`<g class="ps-yt-weather" data-weather=""></g>` +
		piece(
			"crown",
			`<polygon points="${openingOut}" style="fill: color-mix(in oklab, var(--ps-sky-top), var(--ps-sky-mid) 35%)"/>` +
				`<polygon points="${openingOut}" style="fill: var(--ps-veil-c); opacity: var(--ps-veil)"/>` +
				`<g clip-path="url(#ps-yt-crown-out)"><g class="ps-yt-star">${crownStars}</g></g>`
		);

	// Everything else, with holes at the openings for the back to show through; nothing in it blends.
	const inFront =
		`<g clip-path="url(#ps-yt-openings)">` +
		// The floor first: everything else stands on it or rises from its edge.
		`<rect x="-3000" y="-3000" width="8000" height="8000" fill="url(#ps-yt-floor)"/>` +
		`<g opacity=".5">${boards}</g>` +
		// The roof and its poles, the crown's ring.
		`<polygon points="${roofPoly}" fill="url(#ps-yt-roof)"/>` +
		`<g clip-path="url(#ps-yt-roof-clip)">${poles}</g>` +
		poly3(circle3(0, CROWN_H, 0, CROWN_R + 0.1), cls("crown")) +
		// The wall: lining, lattice, the band under the roof and the skirt.
		`<polygon points="${wallPoly}" fill="url(#ps-yt-wall)"/>` +
		`<g clip-path="url(#ps-yt-wall-clip)" opacity=".9">${lattice}</g>` +
		ribbon(WALL_H - 0.09, WALL_H, R - 0.04, cls("band")) +
		ribbon(0, 0.1, R - 0.04, cls("skirt")) +
		// The wall's foot a little darker above its skirt, where the floor and the wall meet (2026-11-27).
		ribbon(0.1, 0.32, R - 0.045, `${cls("woodD", undefined, "ps-yt-wallfoot")} opacity=".12"`) +
		`</g>` +
		// The crown's bent ribs and its rim, over its sky.
		`<g class="ps-yt-ribs"><g clip-path="url(#ps-yt-crown)">${ribs}</g>` +
		poly3(
			circle3(0, CROWN_H, 0, CROWN_R - 0.03),
			`fill="none" ${cls(undefined, "poleEdge")} stroke-width="2"`
		) +
		`</g>` +
		// The windows' frames.
		piece("window-back", back) +
		piece("curtains", curtains) +
		sideWindows +
		// On the floor: the rug, the hearth, the light that falls there.
		piece("rug", rug) +
		Fl.ellipse(STOVE.x, STOVE.z, STOVE.plate, STOVE.plate, cls("hearth")) +
		Fl.ellipse(STOVE.x, STOVE.z, STOVE.plate - 0.08, STOVE.plate - 0.08, cls("hearthL")) +
		shadows +
		`<g class="ps-yt-golden">${Fl.ellipse(
			0.15,
			2.4,
			0.9,
			0.5,
			`fill="#ffc070" opacity=".6" ${LIT}`
		)}<ellipse cx="${n(backBox.x + backBox.w / 2)}" cy="${n(
			backBox.y + backBox.h / 2
		)}" rx="${n(backBox.w * 0.8)}" ry="${n(
			backBox.h * 1.2
		)}" fill="url(#ps-yt-g-golden)"/></g>` +
		// Everything standing, far to near.
		standing;

	// The glows light the walls, the floor and everything standing: layers of their own that ps.css
	// screen-blends over the room (the mockup's order); the fire's sits in a box that can flicker.
	const fireGlow =
		`<circle class="ps-yt-glow-fire" cx="${n(door[0])}" cy="${n(door[1])}" r="${n(
			(FOCAL * 2.4) / door[2]
		)}" fill="url(#ps-yt-g-fire)"/>` +
		`<g class="ps-yt-glow-fire">${Fl.ellipse(
			onStove(0, 0, 0.5)[0],
			onStove(0, 0, 0.5)[2],
			1.3,
			1.0,
			'fill="url(#ps-yt-g-fire)"'
		)}</g>`;
	const otherGlows =
		(lamp
			? `<circle class="ps-yt-glow-lamp" cx="${n(lamp[0])}" cy="${n(lamp[1])}" r="${n(
					(FOCAL * 0.75) / lamp[2]
			  )}" fill="url(#ps-yt-g-lamp)"/>`
			: "") +
		(screenAt
			? `<circle class="ps-yt-glow-screen" cx="${n(screenAt[0])}" cy="${n(
					screenAt[1]
			  )}" r="${n((FOCAL * 0.45) / screenAt[2])}" fill="url(#ps-yt-g-screen)"/>`
			: "");

	// Over the glows: the stove drawn again, so its iron stays dark against its own glow; and what
	// stays bright in the dark. (The sun's beam through the crown, drawn over everything it crossed,
	// washed the furniture out; it went, with its pool on the floor, 2026-11-27.)
	const over =
		`<g class="ps-yt-stove-over">${stoveBody}${potSteam}</g>` +
		`<g class="ps-yt-embers">${embers}</g>` +
		`<g class="ps-yt-still-hearth ps-yt-burn">${fire}</g>` +
		(lights.flame ? `<g class="ps-yt-glow-lamp ps-yt-still-hearth">${lights.flame}</g>` : "") +
		(lights.screenFace ? `<g class="ps-yt-glow-screen">${lights.screenFace}</g>` : "");

	// What moves over it all (plan 2, task 4; plan 3): the fire's flames in the door, the lamp's flame, and
	// the pot's steam; each in a box in the design frame (room-motion.ts), drawn in its own svg.
	const place = (b: {x: number; y: number; w: number; h: number}) =>
		`--x:${n(b.x)};--y:${n(b.y)};--w:${n(b.w)};--h:${n(b.h)}`;
	const viewBox = (b: {x: number; y: number; w: number; h: number}) =>
		`${n(b.x)} ${n(b.y)} ${n(b.w)} ${n(b.h)}`;
	const fireBox = bbox(
		[doorMap(-0.14, 0.31), doorMap(0.14, 0.31), doorMap(-0.14, 0.57), doorMap(0.14, 0.57)].map(
			project
		) as Quad
	);
	// The door's opening in percent of the box: the flames' clip, sampled finer than the still fire's
	// outline (its foot curves round the stove).
	const inBox = (s: number, t: number) => {
		const [x, y] = project(doorMap(s, t));
		return [((x - fireBox.x) / fireBox.w) * 100, ((y - fireBox.y) / fireBox.h) * 100];
	};
	const clip = doorOutline
		.map(([s, t]) =>
			inBox(s, t)
				.map((v) => `${n(v)}%`)
				.join(" ")
		)
		.join(",");

	// The fire (§16; the user, 2026-11-21: "soft firelight, flowing"): the firebox's glow and the embers'
	// pulse behind three blurred layers of flame, each six poses that fade into one another (room-motion.ts),
	// the white-hot core between the outer flame and the two that add their light to it. The flat flame
	// space is stretched over the opening's box, in percent of the fire's box.
	const corners = doorOutline.map(([s, t]) => inBox(s, t));
	const aL = Math.min(...corners.map((c) => c[0]));
	const aT = Math.min(...corners.map((c) => c[1]));
	const aW = Math.max(...corners.map((c) => c[0])) - aL;
	const aH = Math.max(...corners.map((c) => c[1])) - aT;
	const inSpace = (x0: number, y0: number, x1: number, y1: number) =>
		`left:${n(aL + (aW * x0) / FLAME_SPACE.width)}%;top:${n(
			aT + (aH * y0) / FLAME_SPACE.height
		)}%;width:${n((aW * (x1 - x0)) / FLAME_SPACE.width)}%;height:${n(
			(aH * (y1 - y0)) / FLAME_SPACE.height
		)}%`;
	const whole = inSpace(0, 0, FLAME_SPACE.width, FLAME_SPACE.height);
	const flames =
		`<div class="ps-ym-fback" style="${whole}"></div>` +
		`<div class="ps-ym-fembers" style="${inSpace(
			0,
			45,
			FLAME_SPACE.width,
			FLAME_SPACE.height
		)}"></div>` +
		FLAME_LAYERS.map(
			(L, li) =>
				(li === 1
					? `<div class="ps-ym-hotcore" style="${inSpace(
							cb.x0,
							cb.y0,
							cb.x1,
							cb.y1
					  )}"></div>`
					: "") +
				`<div class="ps-ym-fl ps-ym-fl-${L.name}" style="${whole}">` +
				Array.from(
					{length: FLAME_POSES},
					(_, k) =>
						`<div class="ps-ym-fpose" style="--fk:${k}">${flameSvg(
							L,
							k,
							`ps-yt-fl-${L.name}-${k}`
						)}</div>`
				).join("") +
				`</div>`
		).join("");
	let moving =
		`<div class="ps-ym-fire" style="${place(fireBox)};clip-path:polygon(${clip})">` +
		`<div class="ps-ym-flames">${flames}</div>` +
		`</div>`;

	if (lights.flame && lights.flameAt && depthOf(lights.flameAt) > NEAR) {
		// SPR.flame spans x ±5 and y -26 to -9 at the sprite's unit (0.0115), a margin round it.
		const [fx, fy, fz] = project(lights.flameAt);
		const k = (FOCAL * 0.0115) / fz;
		const flameBox = {x: fx - 6 * k, y: fy - 27 * k, w: 12 * k, h: 19 * k};
		moving += `<div class="ps-ym-lamp" style="${place(
			flameBox
		)}"><div class="ps-ym-flame"><svg viewBox="${viewBox(flameBox)}">${
			lights.flame
		}</svg></div></div>`;
	}

	const potRim = project(onStove(-0.17, 0.84, 0.1));
	moving +=
		`<div class="ps-ym-steam" style="--x:${n(potRim[0])};--y:${n(potRim[1])};--w:0;--h:0">` +
		[0, -1.2, -2.4].map((d) => `<i style="--sd:3.6s;--sdl:${d}s"></i>`).join("") +
		`</div>`;

	const layer = (names: string, content: string) =>
		`<svg class="${names}" viewBox="${DESIGN_FRAME.x} ${DESIGN_FRAME.y} ${DESIGN_FRAME.width} ${DESIGN_FRAME.height}" preserveAspectRatio="xMidYMid slice" aria-hidden="true">${content}</svg>`;

	return (
		`<div class="ps-indoor">` +
		layer("ps-yt", defs + behind) +
		`<div class="ps-ym-panes" data-weather=""></div>` +
		layer("ps-yt ps-yt-front", inFront) +
		`<div class="ps-ym-fireglow">${layer("ps-yt", fireGlow)}</div>` +
		layer("ps-yt ps-yt-glow", otherGlows) +
		layer("ps-yt ps-yt-over", over) +
		`<div class="ps-ym-top">${moving}</div>` +
		`</div>`
	);
}
