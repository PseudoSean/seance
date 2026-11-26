import {expect} from "chai";
import {momentFor, type Moment, type Weather} from "../../../client/js/scenes/ps/engine";
import {paletteAt} from "../../../client/js/scenes/ps/palette";
import {sceneVars} from "../../../client/js/scenes/ps/markup";
import {
	meteorJitter,
	meteorsAt,
	meteorsMarkup,
	PERSEIDS,
	SPORADIC,
} from "../../../client/js/scenes/ps/meteors";

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

	it("draws a new offset each minute, the same all through it, within a small reach of the sky", function () {
		const xs: number[] = [];

		for (let minute = 120; minute < 130; minute++) {
			const j = meteorJitter(at(minute, 224));
			expect(j.x).to.be.within(-12, 12);
			expect(j.y).to.be.within(-8, 8);
			expect(meteorJitter(at(minute + 0.5, 224))).to.deep.equal(j);
			xs.push(j.x);
		}

		expect(new Set(xs.map((x) => x.toFixed(2))).size).to.be.at.least(8);
		expect(meteorJitter(at(120, 224))).to.not.deep.equal(
			meteorJitter({...at(120, 224), dayNumber: 20001})
		);
	});

	it("publishes the minute's offset as percentages on the tick", function () {
		const m = at(120, 224);
		const v = sceneVars(m, paletteAt(m));
		expect(v["--ps-meteor-jx"]).to.match(/^-?\d+\.\d{2}%$/);
		expect(v["--ps-meteor-jy"]).to.match(/^-?\d+\.\d{2}%$/);
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

		it("moves each streak's place with the minute's offset, each by its own share, so no track repeats night after night", function () {
			const streaks = [...markup.matchAll(/style="([^"]*)"/g)].map((m) => m[1]);

			for (const st of streaks) {
				const left =
					/left:calc\(([\d.]+)% \+ var\(--ps-meteor-jx, 0%\) \* (-?[\d.]+)\)/.exec(st);
				const top = /top:calc\(([\d.]+)% \+ var\(--ps-meteor-jy, 0%\) \* (-?[\d.]+)\)/.exec(
					st
				);
				expect(left, st).to.not.equal(null);
				expect(top, st).to.not.equal(null);
				expect(Math.abs(Number(left![2])), "its share").to.be.within(0.4, 1);
			}

			const shares = streaks.map(
				(st) => /var\(--ps-meteor-jx, 0%\) \* (-?[\d.]+)/.exec(st)![1]
			);
			expect(new Set(shares).size, "shares differ").to.be.at.least(6);
		});

		it("radiates the shower from one point up and to the left: every Perseid heads down and right", function () {
			for (const m of markup.matchAll(/class="ps-perseid" style="[^"]*--ma:([\d.-]+)deg/g)) {
				expect(Number(m[1])).to.be.within(10, 80);
			}
		});
	});
});
