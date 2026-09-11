import {expect} from "chai";
import fs from "fs";
import path from "path";

const DIR = path.resolve(__dirname, "../../../client/themes/heart");

type Animal = {
	name: string;
	/** The cap, in KB, on each of the animated files — the near tint and the
	 * distant-visitor `-far` one, which are the same shape and so the same
	 * size. Stills are capped at 8 KB whatever the animal. Each rig sets its
	 * own `budget` to the same number (`tools/heart/rigs/<name>.mjs`), which
	 * is what the generator's audit refuses to write over. */
	budget: number;
	/** The dolphin only ever passes in the distance, so it ships two files,
	 * not four: the far tint and its still, and no near tint at all. */
	farOnly?: boolean;
};

/**
 * The whole cast, with the size each animal is allowed. Rows are written down
 * before the animals exist: an animal whose files are not in the directory yet
 * skips its assertions (mocha reports them pending) and its task turns them on
 * by generating the files.
 *
 * Why the directory may be this much bigger than one page needs: a scene casts
 * three animals, and a `url()` sitting in a CSS custom property that no
 * resolved `background-image` substitutes is never fetched. A page therefore
 * pulls three animal files out of this directory, not twenty — the scenario
 * check in `tools/scenarios/theme-heart.mjs` pins that claim against a real
 * browser's network log.
 */
const ANIMALS: Animal[] = [
	{name: "horse", budget: 200},
	{name: "puppy", budget: 160},
	{name: "bunny", budget: 160},
	{name: "deer", budget: 150},
	{name: "kitten", budget: 150},
	{name: "teddy", budget: 120},
	{name: "bird", budget: 120},
	{name: "frog", budget: 100},
	{name: "ladybug", budget: 100},
	{name: "dolphin", budget: 120, farOnly: true},
];

describe("the <3 theme's generated animals (client/themes/heart/*.svg)", function () {
	const read = (f: string) => fs.readFileSync(path.join(DIR, f), "utf8");
	const has = (f: string) => fs.existsSync(path.join(DIR, f));

	for (const {name, budget, farOnly} of ANIMALS) {
		const near = `${name}.svg`;
		const far = `${name}-far.svg`;
		/** The animated file the assertions below read: the near tint, or the
		 * far one for an animal that has no near tint. */
		const stage = farOnly ? far : near;
		const animated = farOnly ? [far] : [near, far];
		const stills = farOnly
			? [`${name}-far-still.svg`]
			: [`${name}-still.svg`, `${name}-far-still.svg`];

		describe(name, function () {
			// An animal the cast has not grown yet: the row above is its
			// budget, but there is nothing on disk to measure, and assertions
			// that silently pass on nothing would also stop noticing a file
			// that disappears. Pending is the honest answer.
			beforeEach(function () {
				if (!has(stage)) {
					this.skip();
				}
			});

			it(`ships its ${animated.length + stills.length} files within budget`, function () {
				for (const f of animated) {
					expect(read(f).length, f).to.be.at.most(budget * 1024);
				}

				for (const f of stills) {
					expect(read(f).length, f).to.be.at.most(8 * 1024);
				}
			});

			it("chains its clips, every animate's values matching its keyTimes from 0 to 1", function () {
				const svg = read(stage);
				expect(
					svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 ')
				).to.be.true;
				const ids = [...svg.matchAll(/<animate id="(s\d+)"/g)].map((m) => m[1]);
				expect(ids.length).to.be.greaterThan(1);
				expect(new Set(ids).size).to.equal(ids.length);
				expect(svg).to.include(`begin="${ids[0]}.end"`);
				expect(svg).to.match(
					new RegExp(`begin="[\\d.]+s;${ids[ids.length - 1]}\\.end\\+[\\d.]+s"`)
				);

				for (const id of ids) {
					expect(svg, `${id} syncs the other paths`).to.include(`begin="${id}.begin"`);
				}

				// calcMode="discrete" is the turn's flip transform: its keyTimes are
				// [0, flip.at] within the shared period and legitimately stop short of
				// 1 (see tools/heart/lib/svg.mjs animalSvg's `scale`). Every other
				// animate/animateTransform here is calcMode="linear" and must span 0 to 1.
				for (const m of svg.matchAll(
					/calcMode="linear"[^>]*values="([^"]*)" keyTimes="([^"]*)" dur=/g
				)) {
					const values = m[1].split(";");
					const times = m[2].split(";").map(Number);
					expect(values.length).to.equal(times.length);
					expect(times[0]).to.equal(0);
					expect(times[times.length - 1]).to.equal(1);

					for (let i = 1; i < times.length; i++) {
						expect(times[i]).to.be.greaterThan(times[i - 1]);
					}
				}

				expect(svg).to.include('type="translate"');
			});

			it("fades the visit in and out on the outer group, invisible before its first sample", function () {
				const svg = read(stage);
				expect(svg).to.include('<g opacity="0">');
				// the outer group's fade is the first <animate> in the file — the
				// puppy's hearts carry their own opacity animate too, but inside
				// the inner group, after the outer group's translate
				const first = svg.indexOf("<animate ");
				expect(first).to.be.greaterThan(-1);
				const tag = svg.slice(first, svg.indexOf("/>", first) + 2);
				expect(tag).to.include('attributeName="opacity"');
				expect(tag).to.include('calcMode="linear" values="0;0;1;1;0;0"');
			});

			it("keeps the far file the same shape in the far tint, and the stills static", function () {
				const strip = (s: string) => s.replace(/fill="#[0-9a-f]{6}"/g, "");

				if (farOnly) {
					expect(has(near), `${near} — this one only ever passes in the distance`).to.be
						.false;
				} else {
					expect(strip(read(far))).to.equal(strip(read(near)));
				}

				for (const f of stills) {
					expect(read(f), f).to.not.include("<animate");
				}
			});
		});
	}

	it("keeps the whole directory under 2.8 MB", function () {
		const total = fs
			.readdirSync(DIR)
			.reduce((a, f) => a + fs.statSync(path.join(DIR, f)).size, 0);
		expect(total).to.be.at.most(2.8 * 1024 * 1024);
	});
});
