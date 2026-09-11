/* eslint-disable no-console */
// tools/heart/gait-probe.mjs — the numbers neither the audit nor the contact
// sheet can show you.
//
//     node tools/heart/gait-probe.mjs deer
//     node tools/heart/gait-probe.mjs deer --cycles=3
//
// The audit prints one mean speed per segment, and the contact sheet tracks the
// animal so that it sits in the middle of every cell — which is exactly what
// hides a gait's two characteristic defects:
//
//   * a foot that never really leaves the ground, so the animal moonwalks. The
//     stance measurement (lib/travel.mjs) picks the lowest planted foot within
//     `tol` units of the ground; a swing that lifts barely past `tol` is read as
//     planted through its whole swing and drags.
//   * a ground speed that steps at a cycle boundary. A gait stores one cycle and
//     repeats it, so a speed that differs between the cycle's first and last
//     frame is replayed as a lurch once per stride, forever.
//
// Both are invisible in a still frame and both need a number. Run this on every
// new rig before believing a contact sheet that looks fine.
//
// Reading the foot table: feet come out in the rig tree's own order, which for
// the existing quadrupeds is far legs first, then near. The rig rules keep a far
// leg slightly raised, so a far foot reads as clear of the ground for most of
// the cycle and its row means little — judge the near feet. A near foot in a
// four-beat walk should be clear for roughly a quarter of the cycle; in a gallop,
// most of it.

import {feetOf} from "./lib/outline.mjs";
import {gaitPose, samplePoses, travelOf} from "./lib/build.mjs";

const args = process.argv.slice(2);
const name = args.find((a) => !a.startsWith("--"));
const cycles = Number((args.find((a) => a.startsWith("--cycles=")) ?? "--cycles=2").slice(9));
if (!name) {
	console.error("usage: node tools/heart/gait-probe.mjs <animal> [--cycles=N]");
	process.exit(2);
}

const def = (await import(`./rigs/${name}.mjs`)).default;
const {rig} = def;
const TOL = 6; // lib/travel.mjs's plant tolerance
const SAMPLES = 40;
const height = rig.ground - rig.viewBox.y; // drawn height above the ground line

console.log(`${name} — gait probe (plant tolerance ${TOL} units, drawn height ${height})`);

// ── 1. does every foot actually leave the ground? ────────────────────────────
for (const [gname, gait] of Object.entries(rig.gaits ?? {})) {
	console.log(`\nfoot lift through one ${gname} cycle`);
	const chans = rig.channels(gname);
	const lifts = [];
	for (let i = 0; i < SAMPLES; i++) {
		lifts.push(feetOf(rig, gaitPose(gait, chans, i / SAMPLES)).map((f) => rig.ground - f.y));
	}
	const count = lifts[0].length;
	for (let f = 0; f < count; f++) {
		const series = lifts.map((l) => l[f]);
		const max = Math.max(...series);
		const above = series.filter((x) => x > TOL).length;
		const verdict =
			max <= TOL
				? "  DRAGS — never clears the plant tolerance"
				: above < SAMPLES * 0.15
				? "  thin — clears the tolerance for under 15 % of the cycle"
				: "";
		console.log(
			`  foot ${String(f).padStart(2)}  max lift ${max.toFixed(1).padStart(6)} ` +
				`(${((max / height) * 100).toFixed(0).padStart(3)} % of height)  ` +
				`frames clear of the ground ${String(above).padStart(2)}/${SAMPLES}${verdict}`
		);
	}
}

// ── 2. is the ground speed smooth, and smooth across a repeat? ───────────────
const {poses, segs} = samplePoses(def);
const {xs} = travelOf(def, poses, segs);

console.log("\nground speed per segment");
for (const s of segs) {
	const vs = [];
	for (let i = s.start + 1; i < s.start + s.count; i++) {
		const dt = poses[i].t - poses[i - 1].t;
		if (dt > 0) vs.push((xs[i] - xs[i - 1]) / dt);
	}
	if (!vs.length) continue;
	const min = Math.min(...vs);
	const max = Math.max(...vs);
	const mean = vs.reduce((a, b) => a + b, 0) / vs.length;
	const spread = mean > 0 ? ((max - min) / 2 / mean) * 100 : 0;
	const stalled = vs.filter((x) => x < 0.5).length;
	const what = s.gait ?? s.blendTo ?? s.wobble ?? s.pose ?? "?";
	console.log(
		`  ${s.id} ${String(what).padEnd(10)} min ${min.toFixed(1).padStart(7)} ` +
			`max ${max.toFixed(1).padStart(7)} mean ${mean.toFixed(1).padStart(7)} ` +
			`spread ${spread.toFixed(0).padStart(3)} %  stalled frames ${stalled}/${vs.length}`
	);
	// only a moving segment can stall; a pose hold or a wobble is pinned to 0 on purpose
	if (s.gait && stalled > vs.length * 0.1) {
		console.log("    STALLS — over a tenth of this moving segment sits at zero speed");
	}
	// a gait stores one cycle and repeats it, so the seam is replayed every stride
	if (s.gait && rig.gaits[s.gait]) {
		const per = Math.round(rig.gaits[s.gait].dur * s.fps);
		for (let c = 1; c <= cycles; c++) {
			const i = c * per;
			if (i > 0 && i < vs.length) {
				const step = vs[i] - vs[i - 1];
				const rel = mean > 0 ? Math.abs(step / mean) * 100 : 0;
				console.log(
					`    cycle seam ${c}: ${vs[i - 1].toFixed(1)} → ${vs[i].toFixed(1)} ` +
						`(step ${step.toFixed(1)}, ${rel.toFixed(0)} % of the mean)` +
						(rel > 25 ? "  LURCHES — this repeats every stride" : "")
				);
			}
		}
	}
}
