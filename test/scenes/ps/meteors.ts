import {expect} from "chai";
import {momentFor, type Moment, type Weather} from "../../../client/js/scenes/ps/engine";
import {paletteAt} from "../../../client/js/scenes/ps/palette";
import {meteorsAt, meteorsMarkup, PERSEIDS, SPORADIC} from "../../../client/js/scenes/ps/meteors";

/** A local minute on a day of the year, the moon down unless asked for. */
function at(
	minute: number,
	doy: number,
	weather: Weather = "clear",
	moon?: "full-up" | "full-down"
): Moment {
	const m = momentFor({minute, doy, dayNumber: 20000, epochDays: 20000, weather});

	if (moon === "full-up") {
		return {
			...m,
			phase: {...m.phase, illumination: 1, present: true},
			moon: {...m.moon, up: true, alt: 0.8},
		};
	}

	return {
		...m,
		phase: {...m.phase, illumination: 1, present: true},
		moon: {...m.moon, up: false, alt: -0.3},
	};
}

const stars = (m: Moment) => meteorsAt(m, paletteAt(m));

describe("ps shooting stars (meteors.ts, 2026-11-26)", function () {
	it("keeps two sporadic streaks and eight of the Perseids", function () {
		expect(SPORADIC).to.equal(2);
		expect(PERSEIDS).to.equal(8);
	});

	it("shows none by day, under cloud, rain, snow or storm", function () {
		expect(stars(at(720, 74))).to.deep.equal({sporadic: 0, perseids: 0, level: 0});

		for (const w of ["rain", "storm", "snow"] as const) {
			expect(stars(at(120, 224, w)), w).to.deep.equal({sporadic: 0, perseids: 0, level: 0});
		}
	});

	it("counts windy and hot nights as clear", function () {
		for (const w of ["wind", "heat"] as const) {
			expect(stars(at(120, 74, w)).sporadic, w).to.be.at.least(1);
		}
	});

	it("gives an ordinary clear night a sporadic streak, two in a moonless small hours, and no Perseids", function () {
		expect(stars(at(1320, 74))).to.include({sporadic: 1, perseids: 0});
		expect(stars(at(120, 74))).to.include({sporadic: 2, perseids: 0});
		expect(stars(at(120, 74, "clear", "full-up")).sporadic).to.equal(1);
	});

	it("builds the Perseids from 17 July to the peak on 12–13 August and back by 24 August", function () {
		expect(stars(at(120, 197)).perseids, "16 Jul").to.equal(0);
		expect(stars(at(120, 201)).perseids, "20 Jul").to.be.within(1, 2);
		expect(stars(at(120, 224)).perseids, "12 Aug").to.equal(8);
		expect(stars(at(120, 225)).perseids, "13 Aug").to.equal(8);
		expect(stars(at(1320, 224)).perseids, "12 Aug, before midnight").to.be.within(3, 5);
		expect(stars(at(120, 232)).perseids, "20 Aug").to.be.within(2, 4);
		expect(stars(at(120, 237)).perseids, "25 Aug").to.equal(0);
	});

	it("thins them under a bright high moon, but the shower still shows", function () {
		const dark = stars(at(120, 224));
		const lit = stars(at(120, 224, "clear", "full-up"));
		expect(lit.perseids).to.be.within(3, 5);
		expect(lit.level).to.be.below(dark.level);
		expect(lit.level).to.be.above(0);
	});

	it("lets a set full moon thin nothing", function () {
		expect(stars(at(120, 224, "clear", "full-down")).perseids).to.equal(8);
	});

	it("fades in with the stars: none while they are out of the sky", function () {
		const m = at(720, 224);
		expect(paletteAt(m).stars).to.equal(0);
		expect(stars(m).level).to.equal(0);
	});

	describe("meteorsMarkup", function () {
		const markup = meteorsMarkup();

		it("is seeded: two sporadic streaks then eight of the shower, the same every time", function () {
			expect(meteorsMarkup()).to.equal(markup);
			expect(markup.match(/<i class="ps-meteor" /g)).to.have.length(SPORADIC);
			expect(markup.match(/<i class="ps-perseid" /g)).to.have.length(PERSEIDS);
			expect(markup.indexOf("ps-perseid")).to.be.above(markup.lastIndexOf('ps-meteor"'));
		});

		it("sizes them in rem and travels them in cqw, never px; long, rare periods, under a second lit", function () {
			expect(markup).to.not.include("px");

			for (const m of markup.matchAll(/style="([^"]*)"/g)) {
				const v = Object.fromEntries(
					m[1]
						.split(";")
						.filter(Boolean)
						.map((d) => d.split(":") as [string, string])
				);
				expect(v["--mx"]).to.match(/^[\d.]+cqw$/);
				expect(v["--ml"]).to.match(/^[\d.]+rem$/);
				expect(parseFloat(v["--md"])).to.be.within(200, 280);
				expect(parseFloat(v["--mb"])).to.be.within(0.45, 1);
			}
		});

		it("radiates the shower from one point up and to the left: every Perseid heads down and right", function () {
			for (const m of markup.matchAll(/class="ps-perseid" style="[^"]*--ma:([\d.-]+)deg/g)) {
				expect(Number(m[1])).to.be.within(10, 80);
			}
		});
	});
});
