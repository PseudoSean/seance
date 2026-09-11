import {expect} from "chai";
import fs from "fs";
import path from "path";

const DIR = path.resolve(__dirname, "../../../client/themes/heart");
/** [animal, budget for the near and far files in KB] — Task 7 adds its own. */
const ANIMALS: [string, number][] = [
	["horse", 200],
	["puppy", 160],
];

describe("the <3 theme's generated animals (client/themes/heart/*.svg)", function () {
	const read = (f: string) => fs.readFileSync(path.join(DIR, f), "utf8");

	for (const [name, budget] of ANIMALS) {
		describe(name, function () {
			it("ships the four files within budget", function () {
				for (const f of [`${name}.svg`, `${name}-far.svg`]) {
					expect(read(f).length, f).to.be.at.most(budget * 1024);
				}

				for (const f of [`${name}-still.svg`, `${name}-far-still.svg`]) {
					expect(read(f).length, f).to.be.at.most(8 * 1024);
				}
			});

			it("chains its clips, every animate's values matching its keyTimes from 0 to 1", function () {
				const svg = read(`${name}.svg`);
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

			it("keeps the far file the same shape in the far tint, and the stills static", function () {
				const strip = (s: string) => s.replace(/fill="#[0-9a-f]{6}"/g, "");
				expect(strip(read(`${name}-far.svg`))).to.equal(strip(read(`${name}.svg`)));
				expect(read(`${name}-still.svg`)).to.not.include("<animate");
				expect(read(`${name}-far-still.svg`)).to.not.include("<animate");
			});
		});
	}

	it("keeps the whole directory under 1.3 MB", function () {
		const total = fs
			.readdirSync(DIR)
			.reduce((a, f) => a + fs.statSync(path.join(DIR, f)).size, 0);
		expect(total).to.be.at.most(1.3 * 1024 * 1024);
	});
});
