import {expect} from "chai";
import {momentFor, sunTimes} from "../../../client/js/scenes/ps/engine";
import {paletteAt, publishedFor} from "../../../client/js/scenes/ps/palette";
import {FIREFLIES, smoke, yurtSvg} from "../../../client/js/scenes/ps/plains";
import {moonShape, sceneMarkup, sceneVars, themeColorFor} from "../../../client/js/scenes/ps/scene";

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
			const published = publishedFor(paletteAt(m));
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
			"--ps-path",
		];

		for (const name of HEX_NAMES) {
			expect(v[name], name).to.match(HEX);
		}
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

	it("puts the layers in the spec's order (§5.1): sky things, the bodies, the ground, the near grass", function () {
		expect(topLevel(sceneMarkup(false))).to.deep.equal([
			"ps-milky",
			"ps-stars",
			"ps-glow",
			"ps-moon",
			"ps-sun",
			"ps-ground",
			"ps-blades",
		]);
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
