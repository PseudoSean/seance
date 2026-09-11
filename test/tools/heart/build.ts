import {expect} from "chai";
import {Circle, Ellipse, P} from "../../../tools/heart/lib/outline.mjs";
import {buildAnimal, samplePoses} from "../../../tools/heart/lib/build.mjs";
import {decodePath} from "../../../tools/heart/lib/svg.mjs";

/**
 * A blob with one near leg and one far leg that step: the leg swings back
 * while planted (rot −20° → +20°) and lifts to swing forward, so the blob
 * walks. Small point counts keep the test quick.
 */
const step = {
	dur: 0.4,
	phases: {},
	ch: {
		leg: [
			[0, -20, "linear"],
			[50, 20, "linear"],
			[100, -20, "linear"],
		],
		lift: [
			[0, 0],
			[50, 0],
			[60, -12],
			[90, -12],
			[100, 0],
		],
	},
};

function leg(layer: string, px: number) {
	return {
		pivot: [px, 44],
		rot: "leg",
		ty: "lift",
		layer,
		shapes: [P("M-4,-24 L4,-24 L4,26 L-4,26 Z"), Circle(0, 26, 4.5)],
		foot: [0, 30],
	};
}

const blob = {
	name: "blob",
	colours: {near: "#d97a9c", far: "#ecbccb"},
	budget: 40 * 1024,
	rig: {
		n: 48,
		emitStride: 1,
		nFar: 24,
		emitStrideFar: 1,
		fillet: 4,
		viewBox: {x: 0, y: 0, w: 100, h: 80},
		ground: 74,
		k: 1,
		farGroups: (items: unknown[]) => [items],
		root: {
			children: [
				leg("far", 44),
				{shapes: [Ellipse(50, 40, 30, 16), Circle(78, 34, 12)], marker: [90, 34]},
				leg("near", 56),
			],
		},
		gaits: {step},
		channels: () => [
			{name: "leg", key: "leg"},
			{name: "lift", key: "lift"},
		],
		poses: {rest: {leg: 0, lift: 0}},
		wobbles: {nod: {lift: [0, 2, 2]}}, // bobs the legs along their axis: feet stay put
		still: {leg: 0, lift: 0},
	},
	sequence: {
		first: 1,
		period: 30,
		stage: {aspect: 3},
		segments: [
			{gait: "step", cycles: 10, fps: 10},
			{pose: "rest", hold: 0.3, blend: 0.2, fps: 10, turn: true},
			{wobble: "nod", pose: "rest", secs: 0.5, fps: 10},
			{gait: "step", cycles: 14, fps: 10},
		],
	},
};

describe("tools/heart build", function () {
	this.timeout(20000);

	it("samples the sequence into frames and remembers each segment's range", function () {
		const {poses, segs, onStage} = samplePoses(blob);
		expect(segs.map((s: {id: string}) => s.id)).to.deep.equal(["s1", "s2", "s3", "s4"]);
		expect(segs[0]).to.include({start: 0, count: 40, cycleFrames: 4});
		expect(segs[1]).to.include({start: 40, count: 5});
		expect(segs[2]).to.include({start: 45, count: 5});
		expect(segs[3]).to.include({start: 50, count: 56});
		expect(poses).to.have.length(106);
		expect(onStage).to.be.closeTo(10.6, 1e-9);
	});

	it("builds the four files with a clean audit, chained clips, travel and one flip", function () {
		const {files, audit} = buildAnimal(blob);
		expect(audit.problems, audit.problems.join("; ")).to.deep.equal([]);
		expect(Object.keys(files)).to.deep.equal([
			"blob.svg",
			"blob-far.svg",
			"blob-still.svg",
			"blob-far-still.svg",
		]);
		const svg = files["blob.svg"];
		expect(svg).to.include('viewBox="0 0 240 80"');
		expect(svg).to.include('<animate id="s1"');
		expect(svg).to.include('begin="s1.end"');
		expect(svg).to.match(/begin="1s;s4\.end\+[\d.]+s"/);
		expect(svg).to.include('repeatCount="10"');
		expect(svg).to.include('type="scale"'); // the turn

		// every path-morph clip's keyTimes run 0 → 1 and match its values (the
		// turn's discrete scale transform is excluded: its keyTimes are
		// [0, flip.at] within the shared period and legitimately stop short of 1)
		for (const m of svg.matchAll(
			/attributeName="d"[^>]*values="([^"]*)" keyTimes="([^"]*)" dur=/g
		)) {
			const values = m[1].split(";");
			const times = m[2].split(";").map(Number);
			expect(values).to.have.length(times.length);
			expect(times[0]).to.equal(0);
			expect(times[times.length - 1]).to.equal(1);

			for (let i = 1; i < times.length; i++) {
				expect(times[i]).to.be.greaterThan(times[i - 1]);
			}
		}

		// the near path is the last path and every frame keeps its point count
		const paths = [...svg.matchAll(/<path fill="([^"]+)" d="([^"]+)"/g)];
		expect(paths.map((p) => p[1])).to.deep.equal(["#e6cedd", "#daa3bf"]);
		expect(decodePath(paths[1][2])).to.have.length(48);
		// it turned at the rest and walked back off the left of the stage
		expect(audit.xEnd).to.be.lessThan(-100);
		expect(audit.speeds[0].mean).to.be.greaterThan(80);
		expect(audit.speeds[2].mean).to.be.lessThan(1); // the wobble: planted and still
		expect(files["blob-still.svg"]).to.not.include("<animate");
		expect(files["blob-far.svg"]).to.include('fill="#e4d3e2"');
	});

	it("refuses a visit that ends on stage", function () {
		const short = {
			...blob,
			sequence: {...blob.sequence, segments: [{gait: "step", cycles: 2, fps: 10}]},
		};
		const {audit} = buildAnimal(short);
		expect(audit.problems.join(" ")).to.include("ends on stage");
	});
});
