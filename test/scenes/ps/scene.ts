import {expect} from "chai";
import {
	momentAt,
	momentFor,
	sunTimes,
	WEATHERS,
	type Weather,
} from "../../../client/js/scenes/ps/engine";
import {publishedFor} from "../../../client/js/scenes/ps/grounds";
import {paletteAt} from "../../../client/js/scenes/ps/palette";
import {clouds, FIREFLIES, smoke, yurtSvg} from "../../../client/js/scenes/ps/plains";
import {
	moonShape,
	sceneClasses,
	sceneMarkup,
	sceneVars,
	themeColorFor,
	weatherChanged,
} from "../../../client/js/scenes/ps/scene";

const days = (iso: string) => Date.parse(iso) / 86400000;

describe("ps scene: what it writes", function () {
	it("shows the sun by day and not the moon", function () {
		const {rise, set} = sunTimes(172);
		const m = momentFor({
			minute: (rise + set) / 2,
			doy: 172,
			dayNumber: 20626,
			epochDays: days("2026-09-26T12:00:00Z"),
			weather: "clear",
		});
		const v = sceneVars(m, paletteAt(m));
		expect(v["--ps-sun-op"]).to.equal("1.00");
		expect(v["--ps-moon-op"]).to.equal("0.000");
		expect(v["--ps-sun-scale"]).to.equal("1.000");
	});

	it("shows a full moon at night, and none at all on a new moon", function () {
		const night = (iso: string) =>
			momentFor({
				minute: 30,
				doy: 269,
				dayNumber: 20722,
				epochDays: days(iso),
				weather: "clear",
			});
		const full = night("2026-09-26T16:52:00Z");
		expect(Number(sceneVars(full, paletteAt(full))["--ps-moon-op"])).to.be.greaterThan(0.9);
		expect(sceneVars(full, paletteAt(full))["--ps-sun-op"]).to.equal("0");
		const fresh = night("2026-10-10T16:00:00Z");
		expect(sceneVars(fresh, paletteAt(fresh))["--ps-moon-op"]).to.equal("0.000");
	});

	it("hides the sun behind rain in proportion to the weather", function () {
		const {rise, set} = sunTimes(121);
		const m = momentFor({
			minute: (rise + set) / 2,
			doy: 121,
			dayNumber: 20574,
			epochDays: 20574,
			weather: "rain",
		});
		expect(sceneVars(m, paletteAt(m))["--ps-sun-op"]).to.equal("0.35");
	});

	it("draws the phase with one ellipse, mirrored when waning", function () {
		expect(
			moonShape({elongation: 0, illumination: 0, waning: false, present: false})
		).to.deep.equal({rx: 30, fill: "#000", mirror: false});
		expect(
			moonShape({elongation: 90, illumination: 0.5, waning: false, present: true}).rx
		).to.be.closeTo(0, 1e-9);
		expect(
			moonShape({elongation: 180, illumination: 1, waning: false, present: true})
		).to.deep.include({fill: "#fff"});
		expect(
			moonShape({elongation: 300, illumination: 0.25, waning: true, present: true})
		).to.deep.include({mirror: true, fill: "#000"});
	});

	it("gives the browser's theme-color the hour's sky-top, the colour it publishes as the canvas", function () {
		const {rise, set} = sunTimes(172);

		for (const minute of [0, rise, (rise + set) / 2, set, 1380]) {
			const m = momentFor({
				minute,
				doy: 172,
				dayNumber: 20626,
				epochDays: 20626,
				weather: "clear",
			});
			const published = publishedFor(paletteAt(m), m);
			expect(themeColorFor(published)).to.equal(published.canvas);
			expect(themeColorFor(published)).to.equal(paletteAt(m).skyTop);
		}
	});
});

describe("ps scene: plan 3's land, yurt and level vars", function () {
	const HEX = /^#[0-9a-f]{6}$/;

	function moment() {
		const doy = 213;
		const {rise, set} = sunTimes(doy);
		return momentFor({
			minute: (rise + set) / 2,
			doy,
			dayNumber: 20626,
			epochDays: 20626,
			weather: "clear",
		});
	}

	it("writes every land band, derived colour and river-sky stop as a hex custom property", function () {
		const m = moment();
		const v = sceneVars(m, paletteAt(m));
		const HEX_NAMES = [
			"--ps-mount",
			"--ps-far",
			"--ps-hill2",
			"--ps-hill1",
			"--ps-grass",
			"--ps-blade",
			"--ps-felt",
			"--ps-band",
			"--ps-door",
			"--ps-cloud",
			"--ps-cloud-under",
			"--ps-mount2",
			"--ps-tree",
			"--ps-trunk",
			"--ps-shrub",
			"--ps-tuft2",
			"--ps-tuft1",
			"--ps-tuft-lit",
			"--ps-riverbed",
			"--ps-bedstone",
			"--ps-river-hi",
			"--ps-river-sky-top",
			"--ps-river-sky-bottom",
			"--ps-felt-shade",
			"--ps-roof-top",
			"--ps-roof-bottom",
			"--ps-roof-stroke",
			"--ps-band-mark",
			"--ps-rope",
			"--ps-rib",
			"--ps-door-orn",
			"--ps-crown",
			"--ps-pipe",
			"--ps-stone",
			"--ps-wood",
		];

		for (const name of HEX_NAMES) {
			expect(v[name], name).to.match(HEX);
		}

		// The worn path is gone (the user, 2026-09-25), and so is its colour.
		expect(v).to.not.have.property("--ps-path");
	});

	it("writes the day's levels as numbers, sway in degrees, and the veil and bird-ink as their own strings", function () {
		const m = moment();
		const p = paletteAt(m);
		const v = sceneVars(m, p);
		const NUMERIC_NAMES = [
			"--ps-water",
			"--ps-flowers",
			"--ps-snowcap",
			"--ps-ff-op",
			"--ps-skeins-op",
			"--ps-residents-op",
			"--ps-wind-op",
			"--ps-heat-op",
			"--ps-veil",
			"--ps-tuft-lit-op",
			"--ps-night-glow",
			"--ps-smoke-op",
			"--ps-dark",
		];

		for (const name of NUMERIC_NAMES) {
			expect(Number.isNaN(Number(v[name])), name).to.equal(false);
		}

		expect(v["--ps-sway"]).to.match(/^-?[\d.]+deg$/);
		expect(v["--ps-veil-c"]).to.match(/^#[0-9a-f]{6}$/);
		expect(v["--ps-bird-ink"]).to.match(/^rgb\(/);
		expect(v["--ps-smoke"]).to.match(/^rgb\(/);
		expect(v["--ps-dark"]).to.equal(p.dark.toFixed(3));
	});
});

describe("ps scene: the day's weather (plan 3 task 4)", function () {
	function at(weather: Weather, minute?: number) {
		const doy = 200;
		const {rise, set} = sunTimes(doy);
		return momentFor({
			minute: minute ?? (rise + set) / 2,
			doy,
			dayNumber: 20653,
			epochDays: 20653,
			weather,
		});
	}

	it("rebuilds the weather layer when the day's weather is new: first, or changed", function () {
		expect(weatherChanged(null, "rain")).to.equal(true);
		expect(weatherChanged(null, "clear")).to.equal(true);
		expect(weatherChanged("clear", "rain")).to.equal(true);
		expect(weatherChanged("rain", "clear")).to.equal(true);
		expect(weatherChanged("rain", "rain")).to.equal(false);

		for (const w of WEATHERS) {
			expect(weatherChanged(w, w), w).to.equal(false);
		}
	});

	it("sees the change at local midnight with the page open: a rainy 26 September, a clear 27th", function () {
		// Local dates, so the day is the same in any timezone the suite runs in.
		const before = momentAt(new Date(2026, 8, 26, 23, 59, 50));
		const after = momentAt(new Date(2026, 8, 27, 0, 0, 10));
		expect(before.weather).to.equal("rain");
		expect(after.weather).to.equal("clear");
		expect(weatherChanged(before.weather, after.weather)).to.equal(true);
		// And within the day the layer is left alone.
		const noon = momentAt(new Date(2026, 8, 26, 12, 0));
		expect(weatherChanged(noon.weather, before.weather)).to.equal(false);
	});

	it("turns the day's booleans into the root's classes: windy, storm, hot", function () {
		const classes = (weather: Weather, minute?: number) => {
			const m = at(weather, minute);
			return sceneClasses(m, paletteAt(m));
		};

		expect(classes("clear")).to.deep.equal({
			"ps-windy": false,
			"ps-storm": false,
			"ps-hot": false,
		});
		expect(classes("wind")).to.deep.include({"ps-windy": true, "ps-storm": false});
		// A storm blows too (its wind is 0.6, over the 0.5 line), as the mockup's.
		expect(classes("storm")).to.deep.include({"ps-windy": true, "ps-storm": true});
		expect(classes("rain")).to.deep.include({"ps-windy": false, "ps-storm": false});
		expect(classes("heat")).to.deep.include({"ps-hot": true});
		// Hot only while the day is light: a heat day's midnight is not.
		expect(classes("heat", 0)).to.deep.include({"ps-hot": false});
	});

	it("writes the rain's and the snow's opacity, the mockup's --rain-op and --snow-op", function () {
		const vars = (weather: Weather) => {
			const m = at(weather);
			return sceneVars(m, paletteAt(m));
		};

		expect(vars("rain")["--ps-rain-op"]).to.equal("0.90");
		expect(vars("storm")["--ps-rain-op"]).to.equal("1.00");
		expect(vars("clear")["--ps-rain-op"]).to.equal("0.00");
		expect(vars("snow")["--ps-snow-op"]).to.equal("0.95");
		expect(vars("rain")["--ps-snow-op"]).to.equal("0.00");
	});
});

describe("ps scene: the layers it builds (sceneMarkup)", function () {
	/** The class of every top-level element in `markup`, in order. */
	function topLevel(markup: string): string[] {
		const out: string[] = [];
		let depth = 0;

		for (const m of markup.matchAll(/<(\/?)(div|svg)\b([^>]*)>/g)) {
			if (m[1]) {
				depth--;
			} else {
				if (depth === 0) {
					out.push(/class="([^"]*)"/.exec(m[3])?.[1] ?? "");
				}

				depth++;
			}
		}

		return out;
	}

	/** The inside of the first `<div class="${name}">…</div>` in `markup`, nested divs included. */
	function inside(markup: string, name: string): string {
		const open = `<div class="${name}">`;
		const start = markup.indexOf(open);
		expect(start, name).to.be.at.least(0);
		let depth = 0;

		for (const m of markup.slice(start).matchAll(/<(\/?)div\b[^>]*>/g)) {
			depth += m[1] ? -1 : 1;

			if (depth === 0) {
				return markup.slice(start + open.length, start + m.index!);
			}
		}

		throw new Error(`${name} is not closed`);
	}

	it("puts the layers in the spec's order (§5.1): sky things, the bodies, the clouds, the ground, the near grass, the veil, the weather", function () {
		expect(topLevel(sceneMarkup(false))).to.deep.equal([
			"ps-milky",
			"ps-stars",
			"ps-glow",
			"ps-moon",
			"ps-sun",
			"ps-cloud-field",
			"ps-ground",
			"ps-blades",
			"ps-veil",
			"ps-weather",
		]);
	});

	it("drifts plains.ts's five clouds in the cloud field", function () {
		expect(inside(sceneMarkup(false), "ps-cloud-field")).to.equal(clouds());
	});

	it("leaves the veil and the weather layer empty: the first tick builds the day's weather", function () {
		for (const phone of [false, true]) {
			const markup = sceneMarkup(phone);
			expect(inside(markup, "ps-veil")).to.equal("");
			expect(inside(markup, "ps-weather")).to.equal("");
			expect(markup).to.not.include('id="ps-heat"');

			for (const layer of ["ps-rain", "ps-snow", "ps-seeds", "ps-flash", "ps-heatband"]) {
				expect(markup, layer).to.not.include(`class="${layer}"`);
			}
		}
	});

	it("holds the land, the fireflies, the yurt, its smoke and the animal layer in the ground group, in that order", function () {
		// The yurt after the fireflies, as the mockup's ground has it; the smoke
		// inside the group too (the plan's ruling), so the heat haze bends it.
		const ground = inside(sceneMarkup(false), "ps-ground");
		expect(topLevel(ground)).to.deep.equal([
			"ps-land",
			"ps-fireflies",
			"ps-yurt",
			"ps-smoke",
			"ps-animals",
		]);
	});

	it("builds the yurt from plains.ts and the smoke's five puffs", function () {
		const markup = sceneMarkup(false);
		expect(inside(markup, "ps-yurt")).to.equal(yurtSvg());
		expect(inside(markup, "ps-smoke")).to.equal(smoke());
	});

	it("halves the fireflies on a phone", function () {
		const count = (phone: boolean) =>
			inside(sceneMarkup(phone), "ps-fireflies").match(/<i /g)?.length ?? 0;
		expect(count(false)).to.equal(FIREFLIES);
		expect(count(true)).to.equal(FIREFLIES / 2);
	});

	it("keeps plan 1's 190 stars", function () {
		expect(inside(sceneMarkup(false), "ps-stars").match(/<i /g)).to.have.length(190);
	});

	it("builds the same markup every time", function () {
		expect(sceneMarkup(false)).to.equal(sceneMarkup(false));
	});
});
