import {expect} from "chai";
import {momentFor, sunTimes} from "../../../client/js/scenes/ps/engine";
import {paletteAt} from "../../../client/js/scenes/ps/palette";
import {moonShape, sceneVars} from "../../../client/js/scenes/ps/scene";

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
});
