import {expect} from "chai";
import {
	FIREFLIES,
	fireflies,
	landSvg,
	nearGrass,
	smoke,
	yurtSvg,
} from "../../../client/js/scenes/ps/plains";

/** How many times `class="<name>"` appears: the whole attribute, so `ps-l-mount` is not `ps-l-mount2`. */
const classCount = (markup: string, name: string) => markup.split(`class="${name}"`).length - 1;

describe("ps plains: the land, the near grass, the yurt, its smoke and the fireflies (plains.ts)", function () {
	describe("landSvg", function () {
		const land = landSvg();

		it("is the same drawing every time: the generators are seeded", function () {
			expect(landSvg()).to.equal(land);
		});

		it("is one svg on the mockup's 1200 × 400 viewBox, stretched to the box", function () {
			expect(land.startsWith('<svg class="ps-land" viewBox="0 0 1200 400"')).to.equal(true);
			expect(land).to.include('preserveAspectRatio="none"');
			expect(land.trim().endsWith("</svg>")).to.equal(true);
			expect(land.match(/<svg\b/g)).to.have.length(1);
		});

		it("names only ps- ids: the river's sky and the heat haze", function () {
			const ids = [...land.matchAll(/\bid="([^"]*)"/g)].map((m) => m[1]);
			expect(ids).to.have.members(["ps-heat", "ps-river-sky"]);

			for (const id of ids) {
				expect(id).to.match(/^ps-/);
			}
		});

		it("draws the eight land paths, once each", function () {
			for (const name of [
				"ps-l-mount2",
				"ps-l-mount",
				"ps-l-far",
				"ps-l-riverbed",
				"ps-l-river",
				"ps-l-hill2",
				"ps-l-hill1",
				"ps-l-grass",
			]) {
				expect(classCount(land, name), name).to.equal(1);
				expect(land, name).to.include(`<path class="${name}" d="`);
			}
		});

		it("in the mockup's order, back to front", function () {
			const at = (name: string) => land.indexOf(`class="${name}"`);
			const order = [
				"ps-l-mount2",
				"ps-l-mount",
				"ps-l-far",
				"ps-l-shrub",
				"ps-l-riverbed",
				"ps-l-bedstone",
				"ps-l-river",
				"ps-l-river-hi",
				"ps-l-hill2",
				"ps-l-rim",
				"ps-l-tuft2",
				"ps-l-tree",
				"ps-l-hill1",
				"ps-l-grass",
			].map(at);
			expect(order.every((i) => i >= 0)).to.equal(true);
			expect([...order].sort((a, b) => a - b)).to.deep.equal(order);
		});

		it("rims each hill with a line, and fills the river with the sky", function () {
			expect(classCount(land, "ps-l-rim")).to.equal(2);
			expect(classCount(land, "ps-l-river-hi")).to.equal(1);
			expect(land).to.include('<linearGradient id="ps-river-sky"');
			// An attribute, as the sun's and moon's gradients are: a fragment
			// url in an external stylesheet is the one place engines have
			// disagreed about which document it names.
			expect(land).to.match(
				/<path class="ps-l-river" d="[^"]*" fill="url\(#ps-river-sky\)"\/>/
			);
			expect(land).to.include("var(--ps-river-sky-top)");
			expect(land).to.include("var(--ps-river-sky-bottom)");
		});

		it("keeps the heat haze's final values (a 0.007 × 0.05 turbulence, displacement 2, 9 s)", function () {
			expect(land).to.include('<filter id="ps-heat"');
			expect(land).to.include('baseFrequency="0.007 0.05"');
			expect(land).to.include('scale="2"');
			expect(land).to.include('dur="9s"');
		});

		it("scatters 40 shrubs, 160 far tufts and 240 near tufts, a quarter or so of them lit", function () {
			expect(classCount(land, "ps-l-shrub")).to.equal(40);
			expect(classCount(land, "ps-l-tuft2")).to.equal(160);
			const lit = classCount(land, "ps-l-tuft-lit");
			expect(classCount(land, "ps-l-tuft1") + lit).to.equal(240);
			expect(lit).to.be.within(30, 90);
		});

		it("stands four trees with two trunks, and seven stones in the riverbed", function () {
			expect(classCount(land, "ps-l-tree")).to.equal(4);
			expect(classCount(land, "ps-l-trunk")).to.equal(2);
			const bed = land.match(/<g class="ps-l-bedstone">([\s\S]*?)<\/g>/)?.[1] ?? "";
			expect(bed.match(/<ellipse /g)).to.have.length(7);
		});

		it("puts every shrub on the far plain and every tuft on its own hill", function () {
			for (const m of land.matchAll(/class="ps-l-shrub" cx="([\d.]+)" cy="([\d.]+)"/g)) {
				expect(Number(m[1])).to.be.within(0, 1200);
				expect(Number(m[2])).to.be.within(130, 140);
			}

			const foot = (name: string) =>
				[
					...land.matchAll(new RegExp(`class="${name}" d="M(-?[\\d.]+),([\\d.]+) `, "g")),
				].map((m) => Number(m[2]));
			expect(foot("ps-l-tuft2").every((y) => y >= 200 && y <= 240)).to.equal(true);
			expect(
				[...foot("ps-l-tuft1"), ...foot("ps-l-tuft-lit")].every((y) => y >= 250 && y <= 294)
			).to.equal(true);
		});

		it("holds no text and no style strings but the gradient's stops", function () {
			expect(land).to.not.match(/<text\b/);
			expect(land.match(/style="/g)).to.have.length(2);
		});
	});

	describe("nearGrass", function () {
		const grass = nearGrass();

		it("is the same drawing every time", function () {
			expect(nearGrass()).to.equal(grass);
		});

		it("is one svg on the mockup's 1200 × 120 viewBox, anchored to the foot and sliced", function () {
			expect(grass.startsWith('<svg class="ps-blades" viewBox="0 0 1200 120"')).to.equal(
				true
			);
			expect(grass).to.include('preserveAspectRatio="xMidYMax slice"');
			expect(grass.match(/<svg\b/g)).to.have.length(1);
		});

		it("holds one swaying blade path, rooted along the whole width", function () {
			const sway = grass.match(/<g class="ps-sway">(<path d="([^"]*)"\/>)<\/g>/);
			expect(sway, "one path inside the swaying group").to.not.equal(null);
			expect(grass.match(/<path\b/g)).to.have.length(1);
			const blades = sway![2].split("Z").filter((s) => s.trim());
			expect(blades.length).to.be.within(200, 300);
			expect(blades.every((b) => /,120 Q/.test(b))).to.equal(true);
		});

		it("scatters 50 flowers in the mockup's five colours", function () {
			const flowers = [
				...grass.matchAll(
					/<circle cx="(\d+)" cy="(\d+)" r="([\d.]+)" fill="(#[0-9a-f]{6})"\/>/g
				),
			];
			expect(flowers).to.have.length(50);
			expect(grass.match(/<circle\b/g)).to.have.length(50);

			for (const [, cx, cy, r, fill] of flowers) {
				expect(Number(cx)).to.be.within(0, 1200);
				expect(Number(cy)).to.be.within(70, 114);
				expect(Number(r)).to.be.within(1.4, 2.8);
				expect(["#f3c85a", "#f6f0e4", "#e79a7a", "#c9b0e6", "#f2a65a"]).to.include(fill);
			}
		});

		it("names no ids", function () {
			expect(grass).to.not.match(/\bid="/);
		});
	});

	describe("yurtSvg", function () {
		const yurt = yurtSvg();

		it("is the same drawing every time", function () {
			expect(yurtSvg()).to.equal(yurt);
		});

		it("is one svg on the mockup's 240 × 170 viewBox", function () {
			expect(yurt.startsWith('<svg viewBox="0 0 240 170" aria-hidden="true">')).to.equal(
				true
			);
			expect(yurt.trim().endsWith("</svg>")).to.equal(true);
			expect(yurt.match(/<svg\b/g)).to.have.length(1);
		});

		it("names only ps-y- ids, and every url(#…) it uses is one of them", function () {
			const ids = [...yurt.matchAll(/\bid="([^"]*)"/g)].map((m) => m[1]);
			expect(ids).to.have.members([
				"ps-y-wall",
				"ps-y-roof",
				"ps-y-inner",
				"ps-y-spill",
				"ps-y-crown-glow",
				"ps-y-blur",
			]);

			for (const id of ids) {
				expect(id).to.match(/^ps-y-/);
			}

			const used = [...yurt.matchAll(/url\(#([^)]*)\)/g)].map((m) => m[1]);
			expect(used.length).to.be.at.least(8);

			for (const id of used) {
				expect(ids, id).to.include(id);
			}
		});

		it("names its parts with ps-y- classes, the mockup's own", function () {
			for (const name of [
				"ps-y-felt-l",
				"ps-y-felt-c",
				"ps-y-roof-t",
				"ps-y-roof-b",
				"ps-y-path",
				"ps-y-spill",
				"ps-y-wood",
				"ps-y-stone",
				"ps-y-lit",
				"ps-y-rope",
				"ps-y-band",
				"ps-y-band-mark",
				"ps-y-roof",
				"ps-y-snow",
				"ps-y-rib",
				"ps-y-crown",
				"ps-y-pipe",
				"ps-y-door",
				"ps-y-door-orn",
			]) {
				expect(yurt, name).to.include(`class="${name}"`);
			}

			for (const [, cls] of yurt.matchAll(/class="([^"]*)"/g)) {
				expect(cls).to.match(/^ps-y-[a-z-]+$/);
			}
		});

		it("paints its patterned band with 16 marks along the band's curve", function () {
			const band = yurt.match(/<g class="ps-y-band-mark">([\s\S]*?)<\/g>/)?.[1] ?? "";
			const marks = [
				...band.matchAll(/<path d="M([\d.]+),([\d.]+) l3,-2\.4 l3,2\.4 l-3,2\.4 Z"\/>/g),
			];
			expect(marks).to.have.length(16);
			expect(band.match(/<path /g)).to.have.length(16);

			marks.forEach((m, i) => {
				const x = 44 + i * 10.2;
				expect(Number(m[1])).to.be.closeTo(x, 0.01);
				expect(Number(m[2])).to.be.closeTo(
					101.5 - Math.sin(((x - 38) / 164) * Math.PI) * 4,
					0.01
				);
			});
		});

		it("lights the wall, the crown, the door and its seams, and snows on the roof", function () {
			expect(classCount(yurt, "ps-y-lit")).to.equal(4);
			expect(classCount(yurt, "ps-y-spill")).to.equal(1);
			expect(classCount(yurt, "ps-y-snow")).to.equal(1);
			expect(classCount(yurt, "ps-y-pipe")).to.equal(2);
		});

		it("holds no text and no style strings", function () {
			expect(yurt).to.not.match(/<text\b/);
			expect(yurt).to.not.include("style=");
		});
	});

	describe("smoke", function () {
		const puffs = smoke();

		it("rises in five puffs, the mockup's", function () {
			expect(puffs.match(/<i /g)).to.have.length(5);
			expect(smoke()).to.equal(puffs);
		});

		it("gives each its own rise and delay, sized in rem, never px", function () {
			expect(puffs).to.not.include("px");
			const got = [
				...puffs.matchAll(
					/<i style="--sd:([\d.]+)s;--sdl:([\d.]+)s;width:([\d.]+)rem;height:([\d.]+)rem"><\/i>/g
				),
			].map((m) => m.slice(1).map(Number));
			expect(got).to.deep.equal([
				[6.2, 0, 9 / 16, 9 / 16],
				[7.1, 1.5, 11 / 16, 11 / 16],
				[6.6, 3, 8 / 16, 8 / 16],
				[7.6, 4.4, 12 / 16, 12 / 16],
				[6.9, 5.6, 9 / 16, 9 / 16],
			]);
		});
	});

	describe("fireflies", function () {
		it("makes as many as asked: 34 for the window, 17 on a phone", function () {
			expect(FIREFLIES).to.equal(34);
			expect(fireflies(34).match(/<i /g)).to.have.length(34);
			expect(fireflies(FIREFLIES / 2).match(/<i /g)).to.have.length(17);
		});

		it("is seeded: the phone's 17 are the first 17 of the window's 34", function () {
			expect(fireflies(34)).to.equal(fireflies(34));
			expect(fireflies(34).startsWith(fireflies(17))).to.equal(true);
		});

		it("places each in the field and drifts it in rem, never px", function () {
			const flies = fireflies(34);
			expect(flies).to.not.include("px");

			for (const m of flies.matchAll(
				/<i style="left:([\d.]+)%;top:([\d.]+)%;--d:([\d.]+)s;--dl:(-?[\d.]+)s;--dx:(-?[\d.]+)rem;--dy:(-?[\d.]+)rem;--b:([\d.]+)s;--bl:(-?[\d.]+)s"><\/i>/g
			)) {
				const [, left, top, d, , dx, dy, b] = m.map(Number);
				expect(left).to.be.within(0, 100);
				expect(top).to.be.within(0, 100);
				expect(d).to.be.within(5, 11);
				expect(Math.abs(dx)).to.be.at.most(30 / 16);
				expect(Math.abs(dy)).to.be.at.most(13 / 16);
				expect(b).to.be.within(2.6, 5.8);
			}

			expect([
				...flies.matchAll(
					/<i style="left:[\d.]+%;top:[\d.]+%;--d:[\d.]+s;--dl:-?[\d.]+s;--dx:-?[\d.]+rem;--dy:-?[\d.]+rem;--b:[\d.]+s;--bl:-?[\d.]+s"><\/i>/g
				),
			]).to.have.length(34);
		});
	});
});
