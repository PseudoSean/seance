// The <3 theme's ladybug (tools/heart/README.md): the cast's insect, and the
// rig that introduces the **ramp cycle** (README § The pipeline) — a gait
// played once whose root channel travels one way across the whole segment,
// which is how the flight climbs and descends. Facing right, ground y = 100.
//
// Drawn at the same unit scale as every other animal — a 54-unit dome, 52
// units of standing silhouette, a 98-unit box — because `n`, `fillet` and
// the audit's outline rules are tuned for a body that size. Its tiny size on
// screen comes entirely from `--heart-ladybug-h` in the theme, not from the
// drawing.
//
// Rotation sign: paper.js rotates clockwise on screen for a positive angle
// (y points down), so a part drawn hanging straight down swings *backward*
// for a positive angle, and a part drawn pointing backward swings *up*.
// Every table below is written against that.
//
// A ladybug reads by four things: a near-circular domed back, a small head
// low and forward of it, thin legs under it, and — only in flight — wings
// above the dome. Three constraints hold the whole rig together:
//
//   1. **The wings vanish when folded.** Each is drawn lying forward inside
//      the shell from a pivot at the dome's apex and rotates up and back out
//      of it, so at `wing = 0` the near wing contributes nothing to the union
//      (measured: the union's area with it and without it differ by
//      0.000000 of 2117.7) and the far wing — its own outline, painted before
//      the near one — lies wholly inside it (0.0000 of its 323.4 outside the
//      emitted near outline). Walking, the ladybug is a plain dome. Anything
//      that moves a wing pivot, lengthens a blade or lowers the shell has to
//      re-measure both.
//   2. **The body stands 13 units off the ground, and that is not styling.**
//      A swinging foot has to clear `lib/travel.mjs`'s 6-unit plant
//      tolerance or the stance measurement reads the whole swing as planted;
//      it also has to stay clear of the belly, because a leg that leaves the
//      body and comes back to graze it encloses a pocket `largest()` drops
//      (the frog's foot, the teddy's arm). Usable lift is roughly
//      `clearance − 4`, so 13 units of clearance buys the 7.5-unit lift the
//      probe wants and little more. Lowering the shell costs both at once.
//   3. **Each leg crosses the body's boundary exactly once.** The femur's
//      top is buried, the knee sits at or just below the belly line and the
//      shin only ever goes further out and down. No leg tucks under the
//      body, in flight included — the legs simply dangle in their standing
//      splay and ride up with it.

import {P, Circle, Ellipse, scaled} from "../lib/outline.mjs";

const GROUND = 100;

// ── the parts ────────────────────────────────────────────────────────────
const D = {};
// The domed back: one ellipse 50 × 36, its underside 13 above the ground.
// A second, smaller ellipse pushed forward and up gives the pronotum's
// shoulder, so the back line rises from the head instead of leaving it as a
// bump stuck on a circle.
D.shell = [Ellipse(43, 68, 27, 19), Ellipse(57, 74, 13, 12)];
// The head: smaller, forward and low, clearing the shell by 6.5 units.
D.head = [Ellipse(70, 83, 8, 7)];
// Femur (top buried in the body) and its knee cap; the cap is wider than the
// bar it caps, per the rig rules.
D.femur = [P("M-3,-5 C-3.4,1 -3,7 -2.6,12 L2.6,12 C3,7 3.4,1 3,-5 Z"), Circle(0, 12, 3.2)];
// Shin, ending in a rounded tarsus rather than a disc — a bug's foot is a
// point, and a foot cap here would be the widest thing under the belly at
// mid-swing, which is exactly what must not touch it.
D.shin = [P("M-2.6,0 C-2.8,5 -2.3,10 -1.8,14 C-0.6,15.1 0.6,15.1 1.8,14 C2.3,10 2.8,5 2.6,0 Z")];
// Both antennae on one node, as two prongs that diverge: drawn from inside
// the head so their roots can never detach from it.
D.ant = [
	P("M-2,3.5 C-0.2,-2 2.4,-6.6 5.6,-10.8 L8.4,-8.8 C5.4,-4.8 3.2,-0.6 2,3.8 Z"),
	P("M-1,5.4 C2.4,1.4 6.2,-1.4 10.8,-3.6 L11.8,-0.4 C7.8,1.4 4.4,3.8 1.6,7 Z"),
];
// A wing: a 34-unit blade drawn lying **forward** and 20° down from a pivot
// at the dome's apex, so that at `wing = 0` it is folded away inside the
// shell. Opening rotates it *counter-clockwise* (negative) up through
// vertical and back over the abdomen — never through "pointing down", which
// is the frog's tongue lesson. Rooting it at the apex rather than at the
// front is what makes it read as a wing instead of an ear: the blade rises
// out of the middle of the back with the pronotum and the head clearly in
// front of it, and 24 of its 34 units are outside the dome at every angle
// the beat visits, so the outline's length barely moves while it beats.
D.wing = [
	P(
		"M-0.4,-4 C6,-2.6 12,-0.4 18,4.2 C24,8 32,11.6 34.5,15.5 " +
			"C35.8,17.8 34.4,20.4 32.1,20.1 C27,19.4 19,15.6 13.5,12.6 " +
			"C7.6,9.6 1.2,5.4 -3.6,2 C-5.6,0.4 -3,-3.6 -0.4,-4 Z"
	),
];

// ── the leg chain ────────────────────────────────────────────────────────
const L1 = 12; // hip → knee
const L2 = 14; // knee → tarsus (the contact point)
/** Near hips, rear to front; each is buried 4–5 units inside the shell. */
const HIP = [
	[33, 80],
	[47, 82],
	[62, 80],
];
/** Far hips: 3 back and 2 up, per the rig rules. */
const FAR_HIP = [
	[30, 78],
	[44, 80],
	[59, 78],
];
/** Where each near foot's stance is centred. */
const CONTACT = [29, 47, 65];
const STRIDE = 12; // how far a planted foot tracks back, in units
/**
 * How high a swinging foot rises. It is bounded on both sides and there is
 * not much room between them: below 6 it is inside `lib/travel.mjs`'s plant
 * tolerance and the animal drags, and every unit of it costs outline. A
 * tripod puts all three near legs at full stretch twice a cycle and folds
 * two of them at the quarters, so the near outline's length swings by very
 * nearly `4 × LIFT` units on a ~270-unit perimeter, once per half-cycle —
 * 9 units of lift measured 6.2 % between frames against the audit's 5 %
 * limit, and it is not a sampling artefact (a 1 % sweep of the cycle shows
 * one smooth slide, the union's child count pinned at 1, so a finer frame
 * rate does help). 7.5 with a 13-frame cycle sits at 4.55 %, and still
 * clears the tolerance for a fifth of the cycle.
 */
const LIFT = 7.5;
/** The knee's fold direction per leg: back, back, forward — a beetle's sprawl. */
const KNEE = [-1, -1, 1];

/**
 * The two-link solution putting leg `i`'s tarsus on `(tx, ty)`: the femur's
 * angle from straight-down and the shin's angle from the femur, in degrees.
 * Every stance key in the crawl comes from here rather than from taste, so
 * the planted foot tracks back at exactly the rate the sequence pins and
 * never slips. Unreachable targets are clamped to just inside full reach.
 */
function ik(i, tx, ty) {
	const [px, py] = HIP[i];
	const dx = tx - px;
	const dy = ty - py;
	const r = Math.min(Math.hypot(dx, dy), L1 + L2 - 0.05);
	const th = Math.atan2(-dx, dy);
	const cb = Math.max(-1, Math.min(1, (r * r - L1 * L1 - L2 * L2) / (2 * L1 * L2)));
	const b = KNEE[i] * Math.acos(cb);
	const a = th - Math.atan2(L2 * Math.sin(b), L1 + L2 * Math.cos(b));
	const deg = (x) => Math.round((x * 1800) / Math.PI) / 10;
	return [deg(a), deg(b)];
}

/** Where leg `i`'s tarsus should be at cycle phase `p` (0–100). */
function contactAt(i, p) {
	const cx = CONTACT[i];
	if (p <= 50) {
		// Stance: straight back at a constant rate — this is the pinned speed.
		return [cx + STRIDE / 2 - (STRIDE * p) / 50, GROUND];
	}
	const u = (p - 50) / 50;
	const x = cx - STRIDE / 2 + STRIDE * (3 * u * u - 2 * u * u * u);
	return [x, GROUND - LIFT * Math.sin(Math.PI * u)];
}

/** Leg `i`'s two key tables, solved by `ik` — stance linear, swing eased. */
function legKeys(i) {
	const up = [];
	const shin = [];
	const at = (p, ease) => {
		const [tx, ty] = contactAt(i, p);
		const [a, b] = ik(i, tx, ty);
		up.push(ease ? [p, a, ease] : [p, a]);
		shin.push(ease ? [p, b, ease] : [p, b]);
	};
	for (let p = 0; p < 50; p += 5) at(p, "linear");
	for (const p of [50, 58, 66, 74, 82, 90, 100]) at(p);
	return {up, shin};
}

const LEGS = [0, 1, 2].map(legKeys);
/** The standing pose: the middle of stance, which is also where a hold sits. */
const STANDING = [0, 1, 2].map((i) => ik(i, ...contactAt(i, 25)));
const hold = (v) => [
	[0, v],
	[100, v],
];

/**
 * One leg: hip (femur → knee) → shin (tarsus). The shin carries both the
 * resample `marker` and the `foot` the travel is measured from.
 */
function leg(side, i) {
	const [px, py] = side === "far" ? FAR_HIP[i] : HIP[i];
	const thin = side === "far" ? 0.85 : 1;
	const len = side === "far" ? 0.95 : 1;
	const k = (c) => `leg.${side}.${i + 1}.${c}`;
	return {
		pivot: [px, py],
		rot: k("up"),
		layer: side,
		shapes: scaled(D.femur, thin, len),
		children: [
			{
				pivot: [0, L1 * len],
				rot: k("shin"),
				layer: side,
				shapes: scaled(D.shin, thin, len),
				marker: [0, L2 * len],
				foot: [0, L2 * len],
			},
		],
	};
}

/**
 * One wing on its own channel; the far one a little shorter and set back,
 * per the rig rules, and on the far layer — **its lighter tint is what makes
 * the pair read as wings.** United into one near outline the two blades
 * still diverge into a V, but a V of two same-coloured prongs above a round
 * body is a pair of ears; the pale one behind the coral one is a wing. It
 * costs a fourth far outline — nine emitted points on every one of the 98
 * stored frames, about 11 KB of the 100 KB row — which is bought back on the
 * far paths' emitted stride and on the flight's frame rate.
 */
function wing(side) {
	const scale = side === "far" ? 0.94 : 1;
	return {
		pivot: side === "far" ? [31, 61] : [34, 60],
		rot: `wing.${side}`,
		layer: side,
		shapes: scaled(D.wing, scale, scale),
		marker: [33.3 * scale, 17.8 * scale],
	};
}

// ── the gaits ────────────────────────────────────────────────────────────
/**
 * Two alternating tripods: near 1 and 3 with far 2 move together, near 2
 * with far 1 and 3 against them. Every gait carries the same table, so
 * `channels()` resolves the same phases whichever one is playing.
 */
const TRIPOD = {"near.1": 0, "near.2": 0.5, "near.3": 0, "far.1": 0.5, "far.2": 0, "far.3": 0.5};

/**
 * The crawl. Half a cycle of stance per leg, so at every instant at least
 * one near tarsus is on the ground sliding back at `STRIDE / (dur / 2)` —
 * 48 units/s, which is what the sequence pins. The far tripod is raised 2
 * units and 5 % shorter, so it never plants below a near foot and never wins
 * `stanceTravel`'s "lowest planted foot": the measurement only ever reads
 * the IK'd near legs.
 */
const crawl = {
	dur: 0.5,
	phases: TRIPOD,
	ch: {
		"leg.1.up": LEGS[0].up,
		"leg.1.shin": LEGS[0].shin,
		"leg.2.up": LEGS[1].up,
		"leg.2.shin": LEGS[1].shin,
		"leg.3.up": LEGS[2].up,
		"leg.3.shin": LEGS[2].shin,
		"wing.near": hold(0),
		"wing.far": hold(0),
		ant: [
			[0, -5],
			[50, 5],
			[100, -5],
		],
		// flat: `ty` moves the root, so a body bob lifts the planted feet too
		// and the IK's "the contact never slips" stops being exactly true.
		// The legs are the animation; a 0.8-unit bob was 0.2 px on screen.
		ty: hold(0),
		pitch: hold(0),
		sx: hold(1),
		sy: hold(1),
	},
};

/**
 * The wingbeat, shared by all three flight gaits: one beat per cycle,
 * written as a full cycle so `flyLevel` can repeat it and the two ramped
 * gaits can hold two of them. It stays between −100° and −134°, so the blade
 * is 24 to 30 of its 34 units outside the dome throughout and the outline's
 * length changes by little more than rigid rotation — the whole beat is
 * 0.86 % of the near outline per stored frame, the cheapest thing in the
 * rig. Only the takeoff and landing blends ever pull a wing back through the
 * shell's surface, and those are the two segments that keep their frame rate.
 */
const beat = (base) => [
	[base + 0, -117],
	[base + 25, -134],
	[base + 50, -117],
	[base + 75, -100],
	[base + 100, -117],
];
/**
 * The same beat `n` times inside one cycle, for the two ramped gaits. Two
 * beats in a 0.5 s cycle is 4 Hz — five stored frames a beat at the 20 fps
 * the flight runs at, which is as few as a sweep this wide can be drawn with
 * before it strobes.
 */
const beats = (n) => {
	const keys = [];
	for (let c = 0; c < n; c++) {
		for (const [p, v] of beat(0)) {
			if (c && p === 0) continue;
			keys.push([Math.round(((p + 100 * c) / n) * 100) / 100, v]);
		}
	}
	return keys;
};
const beats2 = beats(2);
/**
 * The far wing sits 28° short of the near one's sweep, in every gait and
 * every pose, so the pair opens as a V rather than as one thick blade. A
 * *phase* offset would have done it while a beat is running, but folded,
 * both wings sit at 0, and the pair has to read as two the moment they
 * open — which a fixed offset gives and a phase offset does not.
 */
const FAR_WING = 28;
const trail = (keys) => keys.map(([p, v, e]) => (e ? [p, v + FAR_WING, e] : [p, v + FAR_WING]));

/** The legs dangle in their standing splay through every flight gait. */
const dangle = {
	"leg.1.up": hold(STANDING[0][0]),
	"leg.1.shin": hold(STANDING[0][1]),
	"leg.2.up": hold(STANDING[1][0]),
	"leg.2.shin": hold(STANDING[1][1]),
	"leg.3.up": hold(STANDING[2][0]),
	"leg.3.shin": hold(STANDING[2][1]),
	ant: hold(-4),
	sx: hold(1),
	sy: hold(1),
};

/** How far the flight climbs above the ground line. The box holds this. */
const APEX = 16;

/**
 * **The ramp cycles.** `flyUp` and `flyDown` are played `cycles: 1, once:
 * true`: their `dur` holds two wingbeats while `ty` and `pitch` travel one
 * way across the whole segment. `once` is what makes that legal — a gait's
 * clip normally closes on its own frame 0 so a repeat is seamless, which for
 * a ramp would replay the climb backwards in the clip's last frame interval
 * (and no audit would see it, since a translate does not change the
 * outline's length). `flyLevel` is an ordinary cyclic gait: `ty` is flat, so
 * it repeats, and the flight's length is bought there rather than in stored
 * frames.
 */
const flyUp = {
	dur: 0.5,
	phases: TRIPOD,
	ch: {
		...dangle,
		"wing.near": beats2,
		"wing.far": trail(beats2),
		ty: [
			[0, 0, "linear"],
			[100, -APEX, "linear"],
		],
		pitch: [
			[0, 0, "linear"],
			[100, -7, "linear"],
		],
	},
};

const flyLevel = {
	dur: 0.25,
	phases: TRIPOD,
	ch: {
		...dangle,
		"wing.near": beat(0),
		"wing.far": trail(beat(0)),
		ty: hold(-APEX),
		pitch: hold(-7),
	},
};

const flyDown = {
	dur: 0.5,
	phases: TRIPOD,
	ch: {
		...dangle,
		"wing.near": beats2,
		"wing.far": trail(beats2),
		ty: [
			[0, -APEX, "linear"],
			[100, 0, "linear"],
		],
		pitch: [
			[0, -7, "linear"],
			[100, 4, "linear"],
		],
	},
};

const gaits = {crawl, flyUp, flyLevel, flyDown};

/**
 * Every gait shares `TRIPOD`, but the argument is still honoured (and
 * defaulted) so the list's order and names are identical in every call —
 * `samplePoses` asks per gait, and the still and every pose ask with none.
 */
function channels(gaitName = "crawl") {
	const phases = gaits[gaitName]?.phases ?? TRIPOD;
	const ch = [];
	for (const side of ["far", "near"]) {
		for (const i of [1, 2, 3]) {
			for (const c of ["up", "shin"]) {
				ch.push({
					name: `leg.${side}.${i}.${c}`,
					key: `leg.${i}.${c}`,
					phase: phases[`${side}.${i}`],
				});
			}
		}
	}
	ch.push({name: "wing.near", key: "wing.near", phase: 0});
	ch.push({name: "wing.far", key: "wing.far", phase: 0});
	for (const [c, rest] of [
		["ant", 0],
		["ty", 0],
		["pitch", 0],
		["sx", 1],
		["sy", 1],
	]) {
		ch.push({name: c, key: c, rest});
	}
	return ch;
}

// ── poses ────────────────────────────────────────────────────────────────
const legsAt = (p) =>
	Object.fromEntries(
		["far", "near"].flatMap((side) =>
			[0, 1, 2].flatMap((i) => {
				const [a, b] = ik(i, ...contactAt(i, p));
				return [
					[`leg.${side}.${i + 1}.up`, a],
					[`leg.${side}.${i + 1}.shin`, b],
				];
			})
		)
	);

/** Standing on all six, wings folded away: the ladybug as a plain dome. */
const walk = {
	...legsAt(25),
	"wing.near": 0,
	"wing.far": 0,
	ant: -4,
	ty: 0,
	pitch: 0,
	sx: 1,
	sy: 1,
};

/** Wings out, still on the ground — the pose the flight starts from. */
const opened = {...walk, "wing.near": -117, "wing.far": -117 + FAR_WING, pitch: -4, ant: -10};

/** Down again, wings still out; they fold on the way back to `walk`. */
const landed = {...opened, pitch: 2, ty: 0};

const poses = {walk, opened, landed};

export const rig = {
	n: 300,
	emitStride: 3,
	// Nine emitted points per far outline, the coarsest in the cast, and the
	// place this rig pays for having four of them: a far leg is a bent stick
	// three or four pixels long at the theme's size and a far wing about ten,
	// while every point of every far outline costs bytes on all 98 stored
	// frames. `nFar` stays high — it is what the fillet runs on, and it costs
	// nothing — and only the emitted stride is coarse.
	nFar: 90,
	emitStrideFar: 10,
	// 8, below the rest of the cast: the antennae and the shins are exactly
	// the features a stronger fillet rounds away.
	fillet: 8,
	viewBox: {x: 8, y: 5, w: 80, h: 98},
	ground: GROUND,
	// 1, not the small animals' 2: `k` is the integer grid the outlines are
	// rounded onto, and the ladybug is the smallest thing in the cast on
	// screen — one rig unit of its 98-unit box is about a third of a pixel at
	// the theme's size, and dropping the grain from 2 to 1 was worth 4 KB.
	k: 1,
	// the far wing, then each far leg's three parts (femur, knee cap, shin)
	farGroups: (items) => [
		items.slice(0, 1),
		items.slice(1, 4),
		items.slice(4, 7),
		items.slice(7, 10),
	],
	root: {
		pivot: [50, GROUND],
		rot: "pitch",
		ty: "ty",
		scale: ["sx", "sy"],
		children: [
			{
				pivot: [-50, -GROUND],
				children: [
					wing("far"),
					leg("far", 0),
					leg("far", 1),
					leg("far", 2),
					{shapes: D.shell},
					{shapes: D.head, marker: [78, 83]},
					{pivot: [73, 80], rot: "ant", shapes: D.ant},
					wing("near"),
					leg("near", 0),
					leg("near", 1),
					leg("near", 2),
				],
			},
		],
	},
	gaits,
	channels,
	poses,
	// `opened`, not `walk`: a folded ladybug is a featureless dome with three
	// sticks, and the wings are what the visit is about.
	still: opened,
};

export default {
	name: "ladybug",
	rig,
	colours: {near: "#d4574e", far: "#eaa9a3"},
	budget: 100 * 1024,
	sequence: {
		first: 8,
		period: 54,
		stage: {aspect: 18},
		// Distance is bought with crawl cycles, which are free in bytes (a
		// gait stores one cycle whatever it repeats) — the flight covers only
		// 324 of the 1684 units the visit has to cross. Both gait seams are
		// ramped rather than stepped, the teddy's fix: a crawl pinned at 48
		// next to a hold pinned at 0 changes the ground speed by the whole 48
		// in one frame. Every hold runs at 5–6 fps because a hold's frames are
		// byte-identical copies of one pose; the two blends that open and fold
		// the wings are the expensive ones and keep their frame rate.
		segments: [
			{gait: "crawl", cycles: 24, fps: 26, travel: 48},
			{pose: "walk", hold: 0, blend: 0.25, fps: 12, travel: [48, 0]},
			{pose: "walk", hold: 0.3, blend: 0, fps: 5, travel: 0},
			{pose: "opened", hold: 0, blend: 0.5, fps: 20, travel: 0},
			{pose: "opened", hold: 0.2, blend: 0, fps: 5, travel: 0},
			{gait: "flyUp", cycles: 1, once: true, fps: 20, travel: [0, 150]},
			{gait: "flyLevel", cycles: 6, fps: 20, travel: 150},
			{gait: "flyDown", cycles: 1, once: true, fps: 20, travel: [150, 0]},
			{pose: "landed", hold: 0, blend: 0.25, fps: 12, travel: 0},
			{pose: "landed", hold: 0.3, blend: 0, fps: 5, travel: 0},
			{pose: "walk", hold: 0, blend: 0.45, fps: 20, travel: 0},
			{pose: "walk", hold: 0.15, blend: 0, fps: 6, travel: 0},
			{blendTo: "crawl", secs: 0.3, fps: 8, travel: [0, 48]},
			{gait: "crawl", cycles: 38, fps: 26, travel: 48},
		],
	},
};
