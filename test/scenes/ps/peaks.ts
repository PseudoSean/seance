import {expect} from "chai";
import {mountainsSvg, rangesIn} from "../../../client/js/scenes/ps/peaks";

/** Every vertex of the three ranges' lit silhouettes, as [x, y] on the 1600 × 480 view. */
function litPathVertices(svg: string): Array<[number, number]> {
	const out: Array<[number, number]> = [];

	for (const m of svg.matchAll(/<path class="ps-m-(?:far|mid|near)" d="([^"]*)"/g)) {
		const nums = (m[1].match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);

		for (let i = 0; i + 1 < nums.length; i += 2) {
			out.push([nums[i], nums[i + 1]]);
		}
	}

	return out;
}

describe("the mountains (peaks.ts, the avatar's ranges, 2026-11-26)", function () {
	const svg = mountainsSvg();

	it("keeps its shape at any window: a 1600 × 480 view, sliced from the middle, on its foot", function () {
		expect(svg).to.include('viewBox="0 0 1600 480"');
		expect(svg).to.include('preserveAspectRatio="xMidYMax slice"');
		expect(svg).to.include('aria-hidden="true"');
		expect(svg).to.not.match(/\bid="/);
	});

	it("draws three ranges back to front, each with a shaded face and caps", function () {
		const order = [...svg.matchAll(/class="(ps-m-[a-z-]+)"/g)].map((m) => m[1]);
		expect(order.filter((c) => c !== "ps-m-snow")).to.deep.equal([
			"ps-m-far",
			"ps-m-far-sh",
			"ps-m-mid",
			"ps-m-mid-sh",
			"ps-m-near",
			"ps-m-near-sh",
		]);
		expect(order.filter((c) => c === "ps-m-snow")).to.have.length(3);
		// Each range's caps come after its own faces, before the next range.
		expect(order.indexOf("ps-m-snow")).to.equal(order.indexOf("ps-m-far-sh") + 1);
	});

	it("keeps the skyline low toward both sides and the tallest peak in the middle half", function () {
		const pts = litPathVertices(svg);
		expect(pts.length).to.be.at.least(60);
		const top = pts.reduce((a, b) => (b[1] < a[1] ? b : a));
		expect(top[0]).to.be.within(400, 1200);
		// Under the view's top 180, which a 21:9 window's slice crops away.
		expect(top[1]).to.be.at.least(180);

		for (const [x, y] of pts) {
			if (x < 300 || x > 1300) {
				expect(y, `${x},${y}`).to.be.at.least(330);
			}
		}
	});

	it("runs each range on past both edges of the view as low foothills, for a window wider than 2.65 : 1", function () {
		const pts = litPathVertices(svg);
		expect(Math.min(...pts.map(([x]) => x))).to.be.at.most(-1600);
		expect(Math.max(...pts.map(([x]) => x))).to.be.at.least(3200);

		for (const [x, y] of pts) {
			if (x < 0 || x > 1600) {
				expect(y, `${x},${y}`).to.be.at.least(360);
			}
		}
	});

	it("caps peaks only inside the ranges' own silhouettes, and only the high ones", function () {
		const caps = [...svg.matchAll(/<g class="ps-m-snow">(.*?)<\/g>/g)].map((m) => m[1]);
		expect(caps).to.have.length(3);

		for (const g of caps) {
			expect((g.match(/<path /g) ?? []).length).to.be.at.least(2);
		}
	});

	it("draws a window's ranges from the part of the view it shows, not all of it (the final review, 2026-11-27)", function () {
		const view = rangesIn(10, 100, 240, {from: 200, to: 1400});
		expect(view).to.match(/^<g transform="translate\([\d.-]+,[\d.-]+\) scale\(0\.2\)">/);
		// The paths' own points, after the group's transform.
		const paths = view.slice(view.indexOf('">') + 2);
		const xs = [...paths.matchAll(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g)].map((m) =>
			Number(m[1])
		);
		expect(Math.min(...xs)).to.be.at.least(200 - 200);
		expect(Math.max(...xs)).to.be.at.most(1400 + 200);
		for (const c of ["ps-m-far", "ps-m-mid", "ps-m-near"]) {
			expect(view).to.include(`class="${c}"`);
		}

		expect(view.split('class="ps-m-snow"').length - 1).to.equal(3);
	});
});
