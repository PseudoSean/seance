import {expect} from "chai";
import {contrast, hexRgb, luminance, mix, shift} from "../../../client/js/scenes/ps/colour";
import {momentFor, sunTimes} from "../../../client/js/scenes/ps/engine";
import {
	GLASS_NIGHT_AT,
	LAND,
	paletteAt,
	publishedFor,
	REF,
	SEASON_LAND,
	STOPS,
	stopsAt,
	TEXT_LIGHT_AT,
	WEATHER,
} from "../../../client/js/scenes/ps/palette";

const COLOURS = [
	"top",
	"mid",
	"hor",
	"mount",
	"far",
	"hill2",
	"hill1",
	"grass",
	"blade",
	"felt",
	"band",
	"door",
	"cloud",
	"under",
	"glow",
] as const;

/** A moment at a given canonical position on a given day. */
function at(
	canon: number,
	doy: number,
	weather: "clear" | "rain" | "storm" | "wind" | "snow" | "heat" = "clear"
) {
	const {rise, set} = sunTimes(doy);
	const minute = rise + ((canon - 390) / (1155 - 390)) * (set - rise);
	return momentFor({minute, doy, dayNumber: 20000, epochDays: 20000, weather});
}

describe("ps colour arithmetic", function () {
	it("mixes in sRGB the way the mockup did", function () {
		expect(mix("#000000", "#ffffff", 0.5)).to.equal("#808080");
		expect(mix("#102030", "#102030", 0.3)).to.equal("#102030");
		expect(shift("#808080", "#000000", "#101010", 1)).to.equal("#909090");
		expect(shift("#f0f0f0", "#000000", "#404040", 1)).to.equal("#ffffff");
		expect(hexRgb("#0a0b0c")).to.deep.equal([10, 11, 12]);
	});

	it("measures WCAG contrast", function () {
		expect(contrast("#000000", "#ffffff")).to.be.closeTo(21, 1e-9);
		expect(luminance("#ffffff")).to.be.closeTo(1, 1e-9);
	});
});

describe("ps palette: the stops", function () {
	it("keeps the mockup's thirteen stops, midnight to midnight", function () {
		expect(STOPS).to.have.length(13);
		expect(STOPS[0].t).to.equal(0);
		expect(STOPS[12].t).to.equal(1440);

		for (let i = 1; i < STOPS.length; i++) {
			expect(STOPS[i].t).to.be.greaterThan(STOPS[i - 1].t);
		}

		const {t: _a, ...first} = STOPS[0];
		const {t: _b, ...last} = STOPS[12];
		expect(first).to.deep.equal(last);
	});

	it("lands exactly on every stop, so no stop is skipped or doubled", function () {
		for (const stop of STOPS.slice(0, 12)) {
			const s = stopsAt(stop.t);

			for (const c of COLOURS) {
				expect(s[c], `${c} at ${stop.t}`).to.equal(stop[c]);
			}

			expect(s.dark).to.equal(stop.dark);
		}
	});

	it("changes by at most a few steps a minute, so no hour jumps", function () {
		for (let t = 0; t < 1440; t++) {
			const a = stopsAt(t);
			const b = stopsAt(t + 1);

			for (const c of COLOURS) {
				const [x, y] = [hexRgb(a[c]), hexRgb(b[c])];
				const step = Math.max(...x.map((v, i) => Math.abs(v - y[i])));
				expect(step, `${c} at ${t}`).to.be.at.most(8);
			}
		}
	});
});

describe("ps palette: a moment", function () {
	it("paints the season's own land at midsummer noon", function () {
		const p = paletteAt(at(780, 213));

		for (const land of LAND) {
			const [x, y] = [hexRgb(p[land]), hexRgb(SEASON_LAND.summer[land])];
			expect(Math.max(...x.map((v, i) => Math.abs(v - y[i]))), land).to.be.at.most(1);
		}

		expect(REF.grass).to.equal("#69b04a");
	});

	it("greys the clouds and dims the horizon glow in rain", function () {
		const clear = paletteAt(at(1080, 121, "clear"));
		const rain = paletteAt(at(1080, 121, "rain"));
		expect(rain.cloud).to.not.equal(clear.cloud);
		expect(rain.glowOpacity).to.be.closeTo(
			clear.glowOpacity * (1 - WEATHER.rain.hide * 0.8),
			1e-9
		);
	});

	it("burns the sun gold overhead and orange at the horizon", function () {
		const noon = paletteAt(at(772, 172));
		expect(noon.sunMid).to.equal(mix("#ffe07a", "#ff9c3e", 1 - at(772, 172).sun.alt));
		const low = paletteAt(at(391, 172));
		expect(hexRgb(low.sunEdge)[1]).to.be.below(hexRgb(noon.sunEdge)[1]);
	});
});

describe("ps palette: what the chrome reads", function () {
	it("turns the words light from darkness 0.05, and the glass at 0.5", function () {
		const base = paletteAt(at(780, 213));
		expect(publishedFor({...base, dark: TEXT_LIGHT_AT}).text).to.equal("ink");
		expect(publishedFor({...base, dark: TEXT_LIGHT_AT + 0.01}).text).to.equal("light");
		expect(publishedFor({...base, dark: GLASS_NIGHT_AT}).light).to.equal("day");
		expect(publishedFor({...base, dark: GLASS_NIGHT_AT + 0.01}).light).to.equal("night");
	});

	it("haloes daytime ink in the horizon's colour, lifted toward white, and gives the canvas the sky-top", function () {
		const p = paletteAt(at(780, 213));
		const out = publishedFor(p);
		expect(out.halo).to.equal(mix(p.skyHorizon, "#ffffff", 0.55));
		expect(out.canvas).to.equal(p.skyTop);
	});
});
