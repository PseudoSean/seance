import {expect} from "chai";
import {
	animalSvg,
	decodePath,
	encodePath,
	fmt,
	mix,
	stillSvg,
} from "../../../tools/heart/lib/svg.mjs";

describe("tools/heart svg", function () {
	it("mixes colours in sRGB", function () {
		expect(mix("#000000", "#ffffff", 0.5)).to.equal("#808080");
		expect(mix("#d97a9c", "#dbeeff", 0.35)).to.equal("#daa3bf");
	});

	it("encodes an outline as integer relative deltas that decode exactly", function () {
		const pts = [0.4, 0.6, 10.2, 0.4, 10.1, 9.9, -0.2, 10.4];
		expect(encodePath(pts)).to.equal("M0,1l10,-1l0,10l-10,0z");
		expect(decodePath(encodePath(pts))).to.deep.equal([
			[0, 1],
			[10, 0],
			[10, 10],
			[0, 10],
		]);
		expect(encodePath(pts, 2, 2)).to.equal("M1,1l19,19z");
	});

	it("formats numbers to four decimals without trailing zeros", function () {
		expect(fmt(0.5)).to.equal("0.5");
		expect(fmt(1 / 3)).to.equal("0.3333");
		expect(fmt(2)).to.equal("2");
	});

	const spec = {
		viewBox: {x: 0, y: 20, w: 100, h: 80},
		k: 2,
		stageW: 800,
		layers: [
			{cls: "far", fill: "#aaa"},
			{cls: "near", fill: "#333"},
		],
		clips: [
			{
				id: "s1",
				begin: "2s;s2.end+40s",
				repeat: 3,
				dur: 0.5,
				keyTimes: [0, 0.5, 1],
				values: [
					["M0,0l1,1z", "M5,5l2,2z"],
					["M0,0l2,1z", "M5,5l3,2z"],
					["M0,0l1,1z", "M5,5l2,2z"],
				],
			},
			{
				id: "s2",
				begin: "s1.end",
				repeat: 1,
				dur: 1,
				keyTimes: [0, 1],
				values: [
					["M0,0l1,1z", "M5,5l2,2z"],
					["M0,0l1,2z", "M5,5l2,3z"],
				],
			},
		],
		travel: {period: 45, keyTimes: [0, 0.1, 0.5, 1], xs: [-200, -200, 900, 900]},
		flip: {at: 0.3},
		hearts: null,
	};

	it("writes the stage, the chained clips on every path and the travel", function () {
		const svg = animalSvg(spec);
		expect(svg).to.include('viewBox="0 40 1600 160"');
		expect(svg.match(/<path /g)).to.have.length(2);
		expect(svg.lastIndexOf('fill="#333"')).to.be.greaterThan(svg.lastIndexOf('fill="#aaa"'));
		// ids and the chain live on the near path; the far path syncs to its begins
		expect(svg).to.include('<animate id="s1" attributeName="d"');
		expect(svg).to.include('begin="2s;s2.end+40s"');
		expect(svg).to.include('begin="s1.end"');
		expect(svg.match(/begin="s1\.begin"/g)).to.have.length(1);
		expect(svg.match(/repeatCount="3"/g)).to.have.length(2);
		expect(svg).to.include(
			'values="M0,0l1,1z;M0,0l2,1z;M0,0l1,1z" keyTimes="0;0.5;1" dur="0.5s"'
		);
		expect(svg).to.include(
			'type="translate" calcMode="linear" values="-200 0;-200 0;900 0;900 0" keyTimes="0;0.1;0.5;1" dur="45s"'
		);
		expect(svg).to.include(
			'type="scale" additive="sum" calcMode="discrete" values="1 1;-1 1" keyTimes="0;0.3"'
		);
		expect(svg).to.include('transform="translate(100 0)"');
		expect(svg).to.include('transform="translate(-100 0)"');
	});

	it("omits the flip when the sequence never turns and adds hearts when asked", function () {
		expect(animalSvg({...spec, flip: null})).to.not.include('type="scale"');
		const withHearts = animalSvg({
			...spec,
			hearts: {
				d: "M0,0l1,1z",
				fill: "#e07",
				x: 160,
				y: 40,
				rise: 50,
				begin: "s2.begin+0.4s;s2.begin+2s",
			},
		});
		expect(withHearts).to.include('fill="#e07" opacity="0" transform="translate(160 40)"');
		expect(withHearts).to.include(
			'values="0 0;0 -50" dur="1.4s" begin="s2.begin+0.4s;s2.begin+2s"'
		);
	});

	it("writes a still as plain paths in the rig's own box", function () {
		const still = stillSvg({
			viewBox: spec.viewBox,
			k: 2,
			layers: spec.layers,
			frame: ["M0,0l1,1z", "M5,5l2,2z"],
		});
		expect(still).to.equal(
			'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 40 200 160"><path fill="#aaa" d="M0,0l1,1z"/><path fill="#333" d="M5,5l2,2z"/></svg>\n'
		);
	});
});
