// From a rig and its sequence to the four files (tools/heart/README.md):
// sample the segments into poses, outline the frames that will be stored
// (one cycle of a gait, every frame of anything else), derive the travel
// from the planted feet over every frame, then write the near file, the
// distant-visitor file and their stills, with an audit that refuses what
// the meadow must not show.

import {cyc, sampleGait, samplePose, sampleWobble} from "./sampler.mjs";
import {align, feetOf, outlineFrame} from "./outline.mjs";
import {stanceTravel} from "./travel.mjs";
import {animalSvg, encodePath, fmt, mix, SKY, stillSvg} from "./svg.mjs";

/** The pose a gait is in at cycle phase t (0–1). */
export function gaitPose(gait, channels, t) {
	const v = {};
	for (const ch of channels) {
		const k = gait.ch[ch.key];
		v[ch.name] = k ? cyc(k, t, ch.phase ?? 0) : ch.rest ?? 0;
	}
	return v;
}

/**
 * Sample every segment into one pose list. A gait is sampled a cycle at a
 * time so the clip stored for it (its first cycle) repeats to exactly the
 * sampled length; each segment remembers its id (s1, s2, …), frame range,
 * frames per cycle and its span [t0, t1].
 */
export function samplePoses(def) {
	const {rig, sequence} = def;
	const poses = [];
	const segs = [];
	let t = 0;
	sequence.segments.forEach((seg, i) => {
		const start = poses.length;
		const t0 = t;
		let cycleFrames = 0;
		if (seg.gait) {
			const gait = rig.gaits[seg.gait];
			const channels = rig.channels(seg.gait);
			cycleFrames = Math.round(gait.dur * seg.fps);
			for (let c = 0; c < seg.cycles; c++)
				t = sampleGait(gait, channels, 1, seg.fps, poses, t);
		} else if (seg.blendTo) {
			const gait = rig.gaits[seg.blendTo];
			const channels = rig.channels(seg.blendTo);
			t = samplePose(gaitPose(gait, channels, 0), channels, 0, seg.secs, seg.fps, poses, t);
		} else if (seg.wobble) {
			const channels = rig.channels();
			t = sampleWobble(
				rig.poses[seg.pose],
				rig.wobbles[seg.wobble],
				channels,
				seg.secs,
				seg.fps,
				poses,
				t
			);
		} else {
			t = samplePose(
				rig.poses[seg.pose],
				rig.channels(),
				seg.hold,
				seg.blend,
				seg.fps,
				poses,
				t
			);
		}
		const count = poses.length - start;
		if (!count) throw new Error(`segment ${i + 1} of ${def.name} samples no frames`);
		segs.push({...seg, id: `s${i + 1}`, start, count, cycleFrames, t0, t1: t});
	});
	return {poses, segs, onStage: t};
}

/**
 * Outline the frames each clip stores: one cycle of a gait, every frame of a
 * pose or wobble, aligned frame to frame across segment boundaries. Every
 * clip is closed at its own duration — a gait on its first frame, aligned
 * to its last, so the repeat is seamless; a pose on a hold of its last.
 */
export function outlineSequence(def, poses, segs) {
	let prev = null;
	let failures = 0;
	let retries = 0;
	for (const seg of segs) {
		const n = seg.gait ? seg.cycleFrames : seg.count;
		seg.frames = [];
		for (let i = 0; i < n; i++) {
			const f = poses[seg.start + i];
			const o = outlineFrame(def.rig, f.v, prev);
			if (o.failed) failures++;
			retries += o.attempts;
			seg.frames.push({t: f.t - seg.t0, layers: o.layers});
			prev = o.layers;
		}
		seg.dur = seg.gait ? seg.cycleFrames / seg.fps : seg.t1 - seg.t0;
		const closing = seg.gait
			? seg.frames[0].layers.map((l, li) => ({cls: l.cls, pts: align(l.pts, prev[li].pts)}))
			: prev;
		seg.frames.push({t: seg.dur, layers: closing});
		prev = closing;
	}
	return {failures, retries};
}

/**
 * The travel over every sampled frame, facing flipped at each segment marked
 * `turn`. A segment may set a numeric `travel` (units/s, forward in the
 * facing direction) to override the stance measurement for its own frames —
 * for a rig whose swing does not lift the feet clearly, the plant-detection
 * this is built on cannot be trusted. `v` stays the measured velocity either
 * way; only the accumulated position is affected.
 */
export function travelOf(def, poses, segs) {
	const feetFrames = poses.map((p) => ({t: p.t, feet: feetOf(def.rig, p.v)}));
	const {x, v} = stanceTravel(feetFrames, def.rig.ground);
	const turns = new Set(segs.filter((s) => s.turn).map((s) => s.start));
	const owner = new Array(poses.length);
	for (const s of segs) for (let i = s.start; i < s.start + s.count; i++) owner[i] = s;
	const xs = [];
	const flips = [];
	let facing = 1;
	let acc = 0;
	for (let i = 0; i < poses.length; i++) {
		if (turns.has(i)) {
			facing = -facing;
			flips.push(poses[i].t);
		}
		if (i > 0) {
			const seg = owner[i];
			const step =
				typeof seg?.travel === "number"
					? seg.travel * (poses[i].t - poses[i - 1].t)
					: x[i] - x[i - 1];
			acc += facing * step;
		}
		xs.push(acc);
	}
	return {xs, v, flips};
}

/**
 * When the animal's box starts to cross the stage boundary it leaves by, so
 * the fade-out can finish exactly there instead of hanging on past it: the
 * last contiguous run of frames whose box already crosses one edge —
 * rightward when `x0 + xs[i] + vb.x + vb.w >= stageW`, leftward when
 * `x0 + xs[i] + vb.x <= 0` — walking back from the end so the flush-left
 * start (`x0 = -vb.x`, which trivially satisfies the leftward test at frame
 * 0) is never mistaken for the exit. The exit rule guarantees the last frame
 * satisfies one of the two; `found: false` only if it somehow doesn't.
 */
export function findExitTime(poses, xs, x0, vb, stageW) {
	const exits = (i) => {
		const pos = x0 + xs[i];
		return pos + vb.x + vb.w >= stageW || pos + vb.x <= 0;
	};
	const n = poses.length;
	if (!exits(n - 1)) return {t: null, found: false};
	let i = n - 1;
	while (i > 0 && exits(i - 1)) i--;
	return {t: poses[i].t, found: true};
}

const lengthOf = (pts) => {
	let L = 0;
	for (let i = 0; i < pts.length; i += 2) {
		const j = (i + 2) % pts.length;
		L += Math.hypot(pts[j] - pts[i], pts[j + 1] - pts[i + 1]);
	}
	return L;
};

export function buildAnimal(def) {
	const {rig, sequence, colours, name} = def;
	const k = rig.k ?? 1;
	const vb = rig.viewBox;
	const stageW = sequence.stage.aspect * vb.h;
	const stride = (cls) => (cls === "near" ? rig.emitStride ?? 1 : rig.emitStrideFar ?? 1);
	const {poses, segs, onStage} = samplePoses(def);
	const {failures, retries} = outlineSequence(def, poses, segs);
	const {xs, v, flips} = travelOf(def, poses, segs);
	const problems = [];
	if (failures) problems.push(`${failures} frame(s) whose union failed after retries`);
	if (flips.length > 1) problems.push("more than one turn (a file carries one flip)");
	const gap = sequence.period - sequence.first - onStage;
	if (gap < 2)
		problems.push(`the off-stage gap is ${gap.toFixed(1)} s (need ≥ 2 s): raise the period`);
	const x0 = -vb.x;
	const xEnd = x0 + xs[xs.length - 1];
	if (!(xEnd + vb.x + vb.w <= 0 || xEnd + vb.x >= stageW)) {
		problems.push(
			`the sequence ends on stage at x=${xEnd.toFixed(
				0
			)} of ${stageW}: add cycles to the last gait`
		);
	}
	const exitTime = findExitTime(poses, xs, x0, vb, stageW);
	const tExit = exitTime.found ? exitTime.t : onStage;
	let worstNear = 0;
	let worstFar = 0;
	for (const seg of segs) {
		for (let i = 1; i < seg.frames.length; i++) {
			seg.frames[i].layers.forEach((l, li) => {
				const a = lengthOf(seg.frames[i - 1].layers[li].pts);
				const d = Math.abs(lengthOf(l.pts) - a) / a;
				if (l.cls === "near") worstNear = Math.max(worstNear, d);
				else worstFar = Math.max(worstFar, d);
			});
		}
	}
	if (worstNear > 0.05)
		problems.push(
			`the near outline's length jumps ${(worstNear * 100).toFixed(
				1
			)} % between frames (limit 5 %)`
		);
	if (worstFar > 0.1)
		problems.push(
			`a far leg's outline length jumps ${(worstFar * 100).toFixed(
				1
			)} % between frames (limit 10 %)`
		);

	const lastId = segs[segs.length - 1].id;
	const clips = segs.map((seg, i) => ({
		id: seg.id,
		repeat: seg.gait ? seg.cycles : 1,
		dur: seg.dur,
		keyTimes: seg.frames.map((f) => f.t / seg.dur),
		values: seg.frames.map((f) => f.layers.map((l) => encodePath(l.pts, k, stride(l.cls)))),
		begin:
			i === 0
				? `${fmt(sequence.first)}s;${lastId}.end+${fmt(gap)}s`
				: `${segs[i - 1].id}.end`,
	}));
	const P = sequence.period;
	const xLast = (x0 + xs[xs.length - 1]) * k;
	let fade = Math.min(1, onStage / 4);
	// a visit shorter than two fades: shrink so fade-in and fade-out don't overlap
	if (tExit - fade < fade) fade = tExit / 2;
	const travel = {
		period: P,
		first: sequence.first,
		onStage,
		tExit,
		fade,
		keyTimes: [
			0,
			...poses.map((p) => (sequence.first + p.t) / P),
			(sequence.first + onStage) / P,
			1,
		],
		xs: [x0 * k, ...xs.map((x) => (x0 + x) * k), xLast, xLast],
	};
	const flip = flips.length ? {at: (sequence.first + flips[0]) / P} : null;
	const heartSeg = segs.find((s) => s.hearts);
	const hearts =
		def.hearts && heartSeg
			? {
					d: def.hearts.d,
					fill: mix("#d9457f", SKY, 0.35),
					x: def.hearts.x * k,
					y: def.hearts.y * k,
					rise: def.hearts.rise * k,
					begin: def.hearts.times.map((t) => `${heartSeg.id}.begin+${fmt(t)}s`).join(";"),
			  }
			: null;

	const layersWith = (near, far) =>
		segs[0].frames[0].layers.map((l) => ({cls: l.cls, fill: l.cls === "near" ? near : far}));
	const spec = (layers) => ({viewBox: vb, k, stageW, layers, clips, travel, flip, hearts});
	const farTint = mix(colours.far, SKY, 0.45);
	const nearLayers = layersWith(mix(colours.near, SKY, 0.35), mix(colours.far, SKY, 0.35));
	const farLayers = layersWith(farTint, farTint);

	const stillV = {};
	for (const ch of rig.channels())
		stillV[ch.name] = rig.still[ch.name] ?? rig.still[ch.key] ?? ch.rest ?? 0;
	const stillFrame = outlineFrame(rig, stillV, null).layers.map((l) =>
		encodePath(l.pts, k, stride(l.cls))
	);

	const files = {
		[`${name}.svg`]: animalSvg(spec(nearLayers)),
		[`${name}-far.svg`]: animalSvg(spec(farLayers)),
		[`${name}-still.svg`]: stillSvg({viewBox: vb, k, layers: nearLayers, frame: stillFrame}),
		[`${name}-far-still.svg`]: stillSvg({viewBox: vb, k, layers: farLayers, frame: stillFrame}),
	};
	for (const [f, s] of Object.entries(files)) {
		const limit = f.includes("still") ? 8 * 1024 : def.budget;
		if (s.length > limit)
			problems.push(`${f} is ${(s.length / 1024).toFixed(0)} KB (limit ${limit / 1024} KB)`);
	}
	const speeds = segs.map((s) => {
		const vs = v.slice(s.start, s.start + s.count);
		const measured = vs.reduce((a, b) => a + Math.abs(b), 0) / vs.length;
		return {
			id: s.id,
			kind: s.gait ?? s.blendTo ?? s.wobble ?? s.pose,
			mean: typeof s.travel === "number" ? s.travel : measured,
			measured,
		};
	});
	const audit = {
		frames: segs.reduce((a, s) => a + s.frames.length, 0),
		onStage,
		gap,
		retries,
		failures,
		worstNear,
		worstFar,
		xEnd,
		stageW,
		tExit,
		tExitFallback: !exitTime.found,
		speeds,
		bytes: Object.fromEntries(Object.entries(files).map(([f, s]) => [f, s.length])),
		problems,
	};
	return {files, audit};
}
