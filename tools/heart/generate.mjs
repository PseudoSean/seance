// Regenerates the <3 theme's animals — client/themes/heart/<animal>.svg, the
// distant-visitor -far.svg and the two -still.svg files — from the rigs
// under tools/heart/rigs/. The files are committed; run this after changing
// a rig or a sequence, read the audit, then commit what it wrote:
//
//   node tools/heart/generate.mjs            # every animal
//   node tools/heart/generate.mjs puppy      # one
//
// A problem in the audit (a failed union, an outline that jumps, a visit that
// ends on stage, a file over budget) leaves the old files alone and exits 1.
// tools/heart/README.md explains the pipeline and the rules a rig must keep.

import {writeFileSync} from "fs";
import path from "path";
import {buildAnimal} from "./lib/build.mjs";

const OUT = path.resolve(import.meta.dirname, "../../client/themes/heart");
const ALL = ["horse", "puppy", "bunny", "deer", "kitten"];
const names = process.argv.slice(2).length ? process.argv.slice(2) : ALL;
let ok = true;

for (const name of names) {
	const def = (await import(`./rigs/${name}.mjs`)).default;
	const started = Date.now();
	const {files, audit} = buildAnimal(def);
	const secs = ((Date.now() - started) / 1000).toFixed(1);
	console.log(
		`${name}: ${audit.frames} frames stored, on stage ${audit.onStage.toFixed(1)} s of a ${
			def.sequence.period
		} s loop (gap ${audit.gap.toFixed(1)} s), ${secs} s to build`
	);
	console.log(
		`  outline change ≤ ${(audit.worstNear * 100).toFixed(2)} % near / ${(
			audit.worstFar * 100
		).toFixed(2)} % far, ${audit.retries} union retries, ends at x=${audit.xEnd.toFixed(
			0
		)} of ${audit.stageW}`
	);
	console.log(
		`  fades out by t=${audit.tExit.toFixed(2)} s (on stage ${audit.onStage.toFixed(2)} s)${
			audit.tExitFallback ? " — exit condition not found, fell back to onStage" : ""
		}`
	);
	console.log(
		`  clip chain ${audit.clipTotalDur.toFixed(3)} s vs onStage ${audit.onStage.toFixed(
			3
		)} s (diff ${((audit.clipTotalDur - audit.onStage) * 1000).toFixed(1)} ms)`
	);
	for (const s of audit.speeds) {
		const note =
			s.mean !== s.measured ? ` (stance measured ${s.measured.toFixed(0)} units/s)` : "";
		const hold = s.hold ? " [hold]" : "";
		console.log(`  ${s.id} ${s.kind}: ${s.mean.toFixed(0)} units/s${note}${hold}`);
	}
	for (const p of audit.problems) console.log(`  ✗ ${p}`);
	if (audit.problems.length) {
		ok = false;
		continue;
	}
	for (const [file, text] of Object.entries(files)) {
		writeFileSync(path.join(OUT, file), text);
		console.log(`  ${file} ${(text.length / 1024).toFixed(1)} KB`);
	}
}

process.exit(ok ? 0 : 1);
