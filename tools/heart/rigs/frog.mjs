// The <3 theme's frog (tools/heart/README.md): the first rig in the cast
// drawn from scratch rather than derived from an approved one. Facing right,
// ground y = 100. A frog reads by three things and nothing else — a wide body
// lying close to the ground, two eye bumps breaking the top line of the head,
// and the hind legs folded away behind it. Everything here serves one of
// those three, and every proportion below was settled on the contact sheet.
//
// Rotation sign, which every angle depends on: paper.js rotates clockwise on
// screen for a positive angle (y points down), so a part drawn hanging
// straight down swings *backward* for a positive angle — the kitten's note.
// The plan's tables are mirrored against that throughout (its -104° thigh
// points the femur forward, and its tongue tucked at -96° points up out of
// the skull), so none of its numbers survive here. A hind leg hangs from the
// hip: the thigh's 136° at rest carries the knee up and back off the rump as
// the haunch, and the shank's -159.5° folds it down and forward again to an
// ankle behind the belly.
//
// The hind legs move as one pair — one key per side, `hind.*` shared by the
// near and the far leg with 3 % of a cycle between them — which is the one
// thing that separates a frog from every quadruped in this cast.
//
// **The hind foot hangs clear of the belly, and that is not cosmetic.** With
// the foot's top edge tucked *inside* the body outline (the obvious way to
// draw a frog resting on its feet) the two edges run parallel for twenty
// units, so the sliver between them is a closed hole in the union — dropped
// by `largest()` — until the push-off lifts the body one unit too far and the
// hole breaks out to the open air all at once. The near outline's length
// jumped 15 % in that single frame, and at 60 fps it still jumped 11 %: it is
// a topology change, not a sampling artefact, and no frame rate fixes it.
// Raising the body three units and flattening the foot leaves a permanent
// 2-unit gap that only ever widens. Anything later that lowers the body or
// thickens the foot has to re-check `generate.mjs`'s outline figure.

import {P, Circle, Ellipse, scaled} from "../lib/outline.mjs";

const D = {};
// Rump, middle and head as one mass: three ellipses union into a single low
// shape 62 long and 20 tall, tapering to the rear, its underside 8 above the
// ground. The head is the biggest of the three — a frog is front-heavy — and
// the taper is what stops the folded hind leg reading as a second body.
D.body = [Ellipse(38, 85, 15, 7), Ellipse(55, 83, 14, 9), Ellipse(70, 81, 15, 9)];
// The eye bumps sit ON TOP of the head's outline and break its curve: the
// near one big and forward, the far one smaller and behind. Each overlaps the
// head by ~4 units so it can never detach, and the two are drawn all but
// tangent (centres 14.6 apart against radii summing to 14.6) — any closer and
// the valley between them fills in and the pair reads as one dome, which is
// the difference between a frog and a newt.
D.eyeNear = [Circle(70, 67.5, 8.2)];
D.eyeFar = [Circle(56, 71.5, 6.4)];
// Hind leg: the thigh is a rounded mass, not a bar — it is the haunch, and
// the outline only shows it as a hump above the back line — then a slim shank
// down to the ankle and a long webbed foot flat on the ground. Thigh 16,
// shank 24, foot 20: the limb is longer than the body, as a frog's is.
D.thigh = [Ellipse(0, 7.5, 8, 9.5), Circle(0, 16, 5.4)];
D.shank = [P("M-4.6,0 C-5,8 -4.4,16 -3.6,24 L3.6,24 C4.4,16 5,8 4.6,0 Z"), Circle(0, 24, 4.2)];
D.hfoot = [P("M-4,-1 C-5.4,1.6 -4,5 0,5 C9,5 19,3.4 20,1 C20,-0.8 11,-1.4 3.5,-1.2 Z")];
// Front leg: short, propping the chest up.
D.farm = [P("M-3.4,-4 C-4.2,2 -3.6,8 -2.8,14 L3.4,14 C4.2,8 4.6,2 3.8,-4 Z"), Circle(0, 14, 3.3)];
D.ffoot = [P("M-3,-1 C-4.5,2 -2.5,5 1,5 C5,5 7.5,3 6.5,-1 Z")];
// The tongue slides, it does not swing — see `tongueYaw` and the `out` pose.
// Drawn along its own -y, which the yaw turns into "backward along the body",
// so at rest it lies inside the head and the belly and the outline never
// knows it is there (measured: the union is bit-identical with it removed).
D.tongue = [P("M-2,0 C-2.6,-9 -2.6,-21 -1.4,-28 C0,-29.5 0,-29.5 1.4,-28 C2.6,-21 2.6,-9 2,0 Z")];

/** Hip (thigh → shank → webbed foot); the far leg thinner, shorter and set back. */
function hindLeg(side, px, py) {
	const k = (c) => `hind.${side}.${c}`;
	const thin = side === "far" ? 0.85 : 1;
	const len = side === "far" ? 0.95 : 1;
	return {
		pivot: [px, py],
		rot: k("thigh"),
		layer: side,
		shapes: scaled(D.thigh, thin, len),
		children: [
			{
				pivot: [0, 16 * len],
				rot: k("shank"),
				layer: side,
				shapes: scaled(D.shank, thin, len),
				children: [
					{
						pivot: [0, 24 * len],
						rot: k("foot"),
						layer: side,
						shapes: scaled(D.hfoot, thin, len),
						marker: [20 * thin, 0],
						// the toe, not the heel: the push-off rolls the frog
						// onto its toes and the toe is the last thing in contact
						foot: [16 * thin, 4.5 * len],
					},
				],
			},
		],
	};
}

/** Shoulder (arm → hand), two levels rather than the hind leg's three. */
function frontLeg(side, px, py) {
	const k = (c) => `front.${side}.${c}`;
	const thin = side === "far" ? 0.85 : 1;
	const len = side === "far" ? 0.95 : 1;
	return {
		pivot: [px, py],
		rot: k("arm"),
		layer: side,
		shapes: scaled(D.farm, thin, len),
		children: [
			{
				pivot: [0, 14 * len],
				rot: k("foot"),
				layer: side,
				shapes: scaled(D.ffoot, thin, len),
				marker: [6.5 * thin, 0],
				foot: [1 * thin, 3 * len],
			},
		],
	};
}

// One gait. A frog's hop is a load, one explosive extension, a low arc and a
// folded landing. The hind pair moves together; the far side trails by 3 % of
// the cycle so the two legs never draw as one shape.
const hop = {
	dur: 1,
	phases: {near: 0, far: 0.03},
	ch: {
		// The cycle starts at the landing, which is also the `sit` pose, so a
		// hop begins and ends without a jump. 0-30 % is contact: the toe is
		// planted and tracks back at exactly the pinned 143 units/s (the
		// stance keys were solved by inverse kinematics against that path, so
		// the foot never slides), the body dipping into the load and then
		// rising through the push. 30-100 % is flight: the leg snaps straight,
		// then folds and swings forward to reach the next landing.
		"hind.thigh": [
			[0, 135.8, "linear"],
			[10, 139.9, "linear"],
			[20, 125.1, "linear"],
			[30, 105.4, "out"],
			[38, 92],
			[50, 112],
			[62, 128],
			[75, 136],
			[88, 137],
			[100, 135.8],
		],
		"hind.shank": [
			[0, -159.5, "linear"],
			[10, -126.2, "linear"],
			[20, -87.8, "linear"],
			[30, -50.4, "out"],
			[38, -30],
			[50, -95],
			[62, -140],
			[75, -156],
			[88, -158],
			[100, -159.5],
		],
		"hind.foot": [
			[0, 23.8, "linear"],
			[10, -16.7, "linear"],
			[20, -19.4, "linear"],
			[30, -10],
			[38, 12],
			[50, 6],
			[62, 12],
			[75, 20],
			[88, 26],
			[100, 23.8],
		],
		// The hands are down at the landing and leave the ground early: a
		// frog's forelimbs take the landing and then tuck under the chest.
		"front.arm": [
			[0, -8],
			[8, 16],
			[24, 32],
			[40, 34],
			[62, 6],
			[78, -30],
			[92, -22],
			[100, -8],
		],
		"front.foot": [
			[0, 8],
			[8, -6],
			[24, -22],
			[40, -22],
			[62, -6],
			[78, 16],
			[92, 14],
			[100, 8],
		],
		ty: [
			[0, 0],
			[10, 1],
			[20, -8],
			[30, -20, "out"],
			[40, -22],
			[54, -22],
			[70, -21],
			[85, -9],
			[94, -1],
			[100, 0],
		],
		pitch: [
			[0, 0],
			[10, 3],
			[20, -8],
			[30, -15],
			[40, -13],
			[54, -4],
			[70, 5],
			[85, 8],
			[94, 4],
			[100, 0],
		],
		sx: [
			[0, 1],
			[10, 1.05],
			[30, 0.97],
			[45, 1],
			[92, 1.04],
			[100, 1],
		],
		sy: [
			[0, 1],
			[10, 0.95],
			[30, 1.04],
			[45, 1],
			[92, 0.96],
			[100, 1],
		],
	},
};

function channels() {
	const ch = [];
	for (const side of ["near", "far"]) {
		const phase = hop.phases[side];
		for (const c of ["thigh", "shank", "foot"]) {
			ch.push({name: `hind.${side}.${c}`, key: `hind.${c}`, phase});
		}

		for (const c of ["arm", "foot"]) {
			ch.push({name: `front.${side}.${c}`, key: `front.${c}`, phase});
		}
	}

	for (const [c, rest] of [
		["ty", 0],
		["pitch", 0],
		["sx", 1],
		["sy", 1],
		["tongue", 0],
		["tongueYaw", -90],
	]) {
		ch.push({name: c, key: c, rest});
	}

	return ch;
}

/**
 * A pose table written once per pair — `hind.thigh` rather than both
 * `hind.near.thigh` and `hind.far.thigh`. A **pose** may be keyed either way
 * (`samplePose` falls back to the channel's key), but a **wobble**'s pose may
 * not: `sampleWobble` reads `pose[ch.name]` alone, so a pose reached by a
 * wobble segment carrying only the pair key would drop every leg to 0 and
 * splay the frog flat. Every pose here is expanded, so both are safe.
 */
const both = (o) =>
	Object.fromEntries(
		Object.entries(o).flatMap(([k, v]) =>
			k.startsWith("hind.") || k.startsWith("front.")
				? [
						[k.replace(".", ".near."), v],
						[k.replace(".", ".far."), v],
				  ]
				: [[k, v]]
		)
	);

// Also the hop's own frame 0, so a hop starts and ends without a jump.
const sit = both({
	"hind.thigh": 145,
	"hind.shank": -168,
	"hind.foot": 23,
	"front.arm": -8,
	"front.foot": 8,
	ty: 0,
	pitch: 0,
	sx: 1,
	sy: 1,
	tongue: 0,
	tongueYaw: -90,
});

const poses = {
	sit,
	// The tongue out. `tongue` is a *slide*, not a swing: the tongue is drawn
	// lying backward inside the body, and `tongueYaw` (a constant -90) turns
	// its own +y into "forward", so the channel translates it out through the
	// mouth and back again. A swing cannot do this — a 29-unit tongue rotating
	// from tucked (back) to out (forward) points straight down halfway, which
	// is a spike through the belly and the grass on every frame of every
	// blend, whichever way round it goes. A slide has no bad intermediate
	// state: the tongue grows out of the mouth, and the outline's length grows
	// smoothly with it.
	out: {...sit, tongue: 20},
};

// Breathing: the flanks and throat work while the frog sits. `sy` alone, which
// is why there is no `throat` channel and no throat disc — fewer parts, fewer
// union risks (the plan's own preference).
const wobbles = {
	breathe: {sy: [1, 0.035, 1.5], ty: [0, 0.6, 1.5]},
};

export const rig = {
	n: 280,
	emitStride: 3,
	nFar: 100,
	emitStrideFar: 3,
	// 10 rather than the puppy's 12: the eye bumps and the webbed toes are
	// small features and a stronger fillet rounds them away.
	fillet: 10,
	viewBox: {x: -13, y: 31, w: 114, h: 74},
	ground: 100,
	k: 2,
	// the far hind leg's five parts, then the far front leg's three
	farGroups: (items) => [items.slice(0, 5), items.slice(5, 8)],
	root: {
		pivot: [50, 100],
		rot: "pitch",
		ty: "ty",
		scale: ["sx", "sy"],
		children: [
			{
				pivot: [-50, -100],
				children: [
					hindLeg("far", 33, 83.5),
					frontLeg("far", 65, 81.5),
					{shapes: D.body},
					{pivot: [80, 82.5], rot: "tongueYaw", ty: "tongue", shapes: D.tongue},
					{shapes: D.eyeNear, marker: [70, 59.3]},
					{shapes: D.eyeFar},
					hindLeg("near", 36, 85),
					frontLeg("near", 68, 83),
				],
			},
		],
	},
	gaits: {hop},
	channels,
	poses,
	wobbles,
	still: sit,
};

export default {
	name: "frog",
	rig,
	colours: {near: "#7fb069", far: "#b9d6a8"},
	budget: 100 * 1024,
	/**
	 * What `client/themes/heart.css` has to say about this animal — the half of
	 * the box coupling no audit can reach, checked by `test/themes/heart.ts`
	 * (tools/heart/README.md § The audit):
	 *
	 * - `height` is `--heart-frog-h`, the on-screen height of the *box*, in
	 *   strips;
	 * - `box` is the `viewBox.h` it was picked against, so a box that grows
	 *   without its token growing by the same ratio fails there instead of
	 *   shipping an animal a different size;
	 * - `stageWidth` is `stage.aspect × viewBox.h`, which a box change must
	 *   leave alone — the aspect scales the other way — or the animal travels a
	 *   different distance.
	 */
	theme: {height: 0.3, box: 74, stageWidth: 1776},
	sequence: {
		first: 11,
		period: 58,
		stage: {aspect: 24},
		segments: [
			{pose: "sit", hold: 0.75, blend: 0, fps: 8, travel: 0},
			{wobble: "breathe", pose: "sit", secs: 1.2, fps: 8, travel: 0},
			{gait: "hop", cycles: 5, fps: 20, travel: 143},
			{pose: "sit", hold: 0.5, blend: 0.3, fps: 10, travel: 0},
			// The flick: the tongue slides 20 units out and back. 30 fps is not
			// smoothness for its own sake — the tongue emerging adds twice its own
			// extension to the near outline's length every frame, and the audit's
			// limit is 5 % of it, so how fast the tongue may travel is bounded by
			// the frame rate it travels at. The holds either side are cheap frames
			// at 8-10 fps instead.
			{pose: "out", hold: 0, blend: 0.3, fps: 30, travel: 0},
			{pose: "out", hold: 0.1, blend: 0, fps: 10, travel: 0},
			{pose: "sit", hold: 0, blend: 0.3, fps: 30, travel: 0},
			{pose: "sit", hold: 0.4, blend: 0, fps: 8, travel: 0},
			{gait: "hop", cycles: 9, fps: 20, travel: 143},
		],
	},
};
