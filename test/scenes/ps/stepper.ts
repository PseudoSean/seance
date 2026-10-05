import {expect} from "chai";
import sinon from "sinon";
import {createStepper, SCENE_FPS, type StepAnimation} from "../../../client/js/scenes/ps/stepper";

class FakeAnimation implements StepAnimation {
	playState = "running";
	currentTime: number | null;

	constructor(start = 0) {
		this.currentTime = start;
	}

	pause() {
		this.playState = "paused";
	}
}

class FakeSvg {
	paused = false;
	time = 0;

	animationsPaused() {
		return this.paused;
	}

	pauseAnimations() {
		this.paused = true;
	}

	getCurrentTime() {
		return this.time;
	}

	setCurrentTime(seconds: number) {
		this.time = seconds;
	}
}

describe("ps scene: the stepper (stepper.ts)", function () {
	let clock: sinon.SinonFakeTimers;

	beforeEach(function () {
		clock = sinon.useFakeTimers();
	});

	afterEach(function () {
		clock.restore();
	});

	const stepper = (anims: FakeAnimation[], svgs: FakeSvg[]) =>
		createStepper({
			animations: () => anims,
			svgs: () => svgs,
			now: () => Date.now(),
			after(ms, fn) {
				const id = setTimeout(fn, ms);
				return () => clearTimeout(id);
			},
		});

	it("draws at 24 frames a second", function () {
		expect(SCENE_FPS).to.equal(24);
	});

	it("holds every animation and SVG clock, and advances them by the real time elapsed", function () {
		const a = new FakeAnimation(500);
		const svg = new FakeSvg();
		const s = stepper([a], [svg]);
		s.start();
		expect(a.playState, "held").to.equal("paused");
		expect(svg.paused, "held").to.equal(true);
		clock.tick(1000);
		expect(a.currentTime).to.be.closeTo(1500, 1000 / SCENE_FPS);
		expect(svg.time).to.be.closeTo(1, 1 / SCENE_FPS);
		s.stop();
	});

	it("steps SCENE_FPS times a second, not at the screen's rate", function () {
		const a = new FakeAnimation();
		let writes = 0;
		Object.defineProperty(a, "currentTime", {
			get: () => 0,
			set: () => (writes += 1),
		});
		const s = stepper([a], []);
		s.start();
		clock.tick(1000);
		expect(writes).to.be.within(SCENE_FPS - 1, SCENE_FPS);
		s.stop();
	});

	it("leaves no timer when stopped, and resumes from where it stood", function () {
		const a = new FakeAnimation();
		const s = stepper([a], []);
		s.start();
		clock.tick(1000);
		s.stop();
		expect(clock.countTimers()).to.equal(0);
		expect(s.running).to.equal(false);
		const held = a.currentTime as number;
		clock.tick(60000); // a minute at rest
		expect(a.currentTime).to.equal(held);
		s.start();
		clock.tick(500);
		expect(a.currentTime, "no jump by the rest's length").to.be.closeTo(
			held + 500,
			1000 / SCENE_FPS
		);
		s.stop();
	});

	it("takes in what a refresh finds and lets go of what it no longer finds", function () {
		const anims = [new FakeAnimation()];
		const s = stepper(anims, []);
		s.start();
		const late = new FakeAnimation(200);
		const gone = anims[0];
		anims.splice(0, 1, late);
		s.refresh();
		expect(late.playState).to.equal("paused");
		const goneAt = gone.currentTime;
		clock.tick(1000);
		expect(late.currentTime).to.be.closeTo(1200, 1000 / SCENE_FPS);
		expect(gone.currentTime, "no longer stepped").to.equal(goneAt);
		s.stop();
	});

	it("never reads an animation back in a step", function () {
		const a = new FakeAnimation();
		let reads = 0;
		let value: number | null = 0;
		Object.defineProperty(a, "currentTime", {
			get() {
				reads += 1;
				return value;
			},
			set: (v: number) => (value = v),
		});
		const s = stepper([a], []);
		s.start(); // the refresh reads it once
		const afterRefresh = reads;
		clock.tick(1000);
		expect(reads).to.equal(afterRefresh);
		s.stop();
	});

	it("starts once however often it is asked", function () {
		const s = stepper([], []);
		s.start();
		s.start();
		expect(clock.countTimers()).to.equal(1);
		s.stop();
	});
});
