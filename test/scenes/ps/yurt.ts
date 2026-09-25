import {expect} from "chai";
import {
	FADE_MS,
	FOLLOW_REM,
	YURT_AT,
	YURT_DEFAULT,
	yurtFollower,
	yurtMove,
	yurtPlace,
	type YurtEffects,
} from "../../../client/js/scenes/ps/yurt";

describe("ps yurt: where it stands (yurt.ts)", function () {
	it("keeps the brief's numbers", function () {
		expect(YURT_AT).to.equal(0.72);
		expect(YURT_DEFAULT).to.equal(0.7);
		expect(FADE_MS).to.equal(400);
		expect(FOLLOW_REM).to.equal(1.5);
	});

	describe("yurtPlace", function () {
		it("stands at 72 % of the message column, from the column's left", function () {
			expect(yurtPlace({left: 300, width: 800}, null, 1200)).to.equal(876);
			expect(
				yurtPlace({left: 300, width: 800}, 500, 1200),
				"a column wins over the last place"
			).to.equal(876);
		});

		it("keeps its last place with no column on screen", function () {
			expect(yurtPlace(null, 500, 1200)).to.equal(500);
		});

		it("stands at 70 % of the scene before any column was measured", function () {
			expect(yurtPlace(null, null, 1200)).to.equal(840);
		});
	});

	describe("yurtMove", function () {
		it("follows a change under 1.5 rem at once", function () {
			expect(yurtMove(500, 510, 20, false)).to.equal("follow");
			expect(yurtMove(510, 500, 20, false)).to.equal("follow");
			expect(yurtMove(500, 529.9, 20, false)).to.equal("follow");
		});

		it("fades for a change of 1.5 rem or more", function () {
			expect(yurtMove(500, 540, 20, false)).to.equal("fade");
			expect(yurtMove(540, 500, 20, false)).to.equal("fade");
			expect(yurtMove(500, 530, 20, false), "exactly 1.5 rem").to.equal("fade");
		});

		it("measures the threshold in the page's rem", function () {
			expect(yurtMove(500, 540, 32, false)).to.equal("follow");
			expect(yurtMove(500, 520, 12, false)).to.equal("fade");
		});

		it("retargets any change while a fade is running: no second fade", function () {
			expect(yurtMove(500, 510, 20, true)).to.equal("retarget");
			expect(yurtMove(500, 900, 20, true)).to.equal("retarget");
			expect(yurtMove(500, 500, 20, true)).to.equal("retarget");
		});
	});
});

/**
 * A scripted clock for the follower: timers by virtual milliseconds, frames
 * one batch at a time, and a log of every effect in order.
 */
function harness() {
	let now = 0;
	const timers: Array<{at: number; fn: () => void; live: boolean}> = [];
	let frames: Array<{fn: () => void; live: boolean}> = [];
	const log: string[] = [];

	const fx: YurtEffects = {
		place: (px) => log.push(`place ${px}`),
		hide: (on) => log.push(on ? "hide" : "show"),
		after(ms, fn) {
			const t = {at: now + ms, fn, live: true};
			timers.push(t);

			return () => {
				t.live = false;
			};
		},
		nextFrame(fn) {
			const f = {fn, live: true};
			frames.push(f);

			return () => {
				f.live = false;
			};
		},
	};

	return {
		fx,
		log,
		/** Move the clock on by `ms`, firing each timer that falls due. */
		advance(ms: number) {
			now += ms;

			for (const t of timers) {
				if (t.live && t.at <= now) {
					t.live = false;
					t.fn();
				}
			}
		},
		/** Run the frame callbacks queued so far. */
		frame() {
			const due = frames;
			frames = [];

			for (const f of due) {
				if (f.live) {
					f.fn();
				}
			}
		},
		pending: () => timers.filter((t) => t.live).length + frames.filter((f) => f.live).length,
	};
}

describe("ps yurt: following the column (yurtFollower)", function () {
	const W = 1280;
	const REM = 20;
	/** The column beside a sidebar of 250 px, the user list open (850 wide) or closed (1030). */
	const OPEN = {left: 250, width: 850};
	const CLOSED = {left: 250, width: 1030};
	const AT_OPEN = yurtPlace(OPEN, null, W); // 862
	const AT_CLOSED = yurtPlace(CLOSED, null, W); // 991.6

	/** A follower already standing where the open list puts it. */
	function standing() {
		const h = harness();
		const f = yurtFollower(h.fx);
		f.measure(OPEN, W, REM);
		h.advance(FADE_MS);
		h.frame();
		h.log.length = 0;
		expect(f.place).to.equal(AT_OPEN);
		expect(f.fading).to.equal(false);
		return {h, f};
	}

	it("leaves ps.css's 70 % standing until a column is measured", function () {
		const h = harness();
		const f = yurtFollower(h.fx);
		f.measure(null, W, REM);
		f.measure({left: 250, width: 0}, W, REM); // a column not laid out is no column
		expect(h.log).to.deep.equal([]);
		expect(f.place).to.equal(null);
	});

	it("follows at once when the first column puts it within 1.5 rem of 70 %", function () {
		const h = harness();
		const f = yurtFollower(h.fx);
		const near = {left: 0, width: (W * YURT_DEFAULT + 10) / YURT_AT};
		f.measure(near, W, REM);
		expect(h.log).to.deep.equal([`place ${yurtPlace(near, null, W)}`]);
		expect(f.fading).to.equal(false);
	});

	it("fades from 70 % to the first column's far third (the page opened on Settings)", function () {
		const h = harness();
		const f = yurtFollower(h.fx);
		f.measure(null, W, REM); // Settings: no column
		f.measure(OPEN, W, REM); // a channel opens: 862 is 34 px from 896
		expect(h.log).to.deep.equal(["hide"]);
		h.advance(FADE_MS - 1);
		expect(h.log, "unmoved while it fades out").to.deep.equal(["hide"]);
		h.advance(1);
		expect(h.log).to.deep.equal(["hide", `place ${AT_OPEN}`]);
		h.frame();
		expect(h.log, "shown on the frame after the jump").to.deep.equal([
			"hide",
			`place ${AT_OPEN}`,
			"show",
		]);
		expect(f.fading).to.equal(false);
		expect(h.pending()).to.equal(0);
	});

	it("follows a small change at once, with no fade", function () {
		const {h, f} = standing();
		f.measure({left: 250, width: 870}, W, REM);
		expect(h.log).to.deep.equal([`place ${250 + 0.72 * 870}`]);
	});

	it("fades out, jumps unseen and fades in for a large change", function () {
		const {h, f} = standing();
		f.measure(CLOSED, W, REM);
		expect(h.log).to.deep.equal(["hide"]);
		expect(f.fading).to.equal(true);
		h.advance(FADE_MS);
		h.frame();
		expect(h.log).to.deep.equal(["hide", `place ${AT_CLOSED}`, "show"]);
		expect(f.place).to.equal(AT_CLOSED);
	});

	it("ends where the last of two quick toggles puts it, placed once, while hidden (review focus 2)", function () {
		const {h, f} = standing();
		// close, open, close, open inside one fade: back where it started.
		f.measure(CLOSED, W, REM);
		h.advance(100);
		f.measure(OPEN, W, REM);
		h.advance(100);
		f.measure(CLOSED, W, REM);
		h.advance(100);
		f.measure(OPEN, W, REM);
		h.advance(100);
		h.frame();
		expect(h.log).to.deep.equal(["hide", `place ${AT_OPEN}`, "show"]);
		expect(f.place).to.equal(AT_OPEN);
		expect(f.fading).to.equal(false);
	});

	it("ends at the far place when the toggles stop there", function () {
		const {h, f} = standing();
		f.measure(CLOSED, W, REM);
		h.advance(100);
		f.measure(OPEN, W, REM);
		h.advance(100);
		f.measure(CLOSED, W, REM);
		h.advance(200);
		h.frame();
		expect(h.log).to.deep.equal(["hide", `place ${AT_CLOSED}`, "show"]);
	});

	it("takes a change between the jump and the next frame before it shows the yurt", function () {
		const {h, f} = standing();
		f.measure(CLOSED, W, REM);
		h.advance(FADE_MS);
		f.measure(OPEN, W, REM); // the timer has fired; the class is still on
		expect(f.fading).to.equal(true);
		h.frame();
		expect(h.log).to.deep.equal(["hide", `place ${AT_CLOSED}`, `place ${AT_OPEN}`, "show"]);
		expect(f.place).to.equal(AT_OPEN);
	});

	it("keeps its place when the column goes, and a pending jump still lands", function () {
		const {h, f} = standing();
		f.measure(null, W, REM);
		expect(h.log, "no column: nothing moves").to.deep.equal([]);
		f.measure(CLOSED, W, REM);
		f.measure(null, W, REM);
		h.advance(FADE_MS);
		h.frame();
		expect(h.log).to.deep.equal(["hide", `place ${AT_CLOSED}`, "show"]);
	});

	it("follows again once a fade has ended", function () {
		const {h, f} = standing();
		f.measure(CLOSED, W, REM);
		h.advance(FADE_MS);
		h.frame();
		h.log.length = 0;
		f.measure({left: 250, width: 1020}, W, REM);
		expect(h.log).to.deep.equal([`place ${250 + 0.72 * 1020}`]);
	});

	it("leaves no timer or frame behind when stopped mid-fade", function () {
		const {h, f} = standing();
		f.measure(CLOSED, W, REM);
		f.stop();
		expect(h.pending()).to.equal(0);
		h.advance(FADE_MS * 2);
		h.frame();
		expect(h.log).to.deep.equal(["hide"]);

		const g = standing();
		g.f.measure(CLOSED, W, REM);
		g.h.advance(FADE_MS); // between the jump and the frame
		g.f.stop();
		expect(g.h.pending()).to.equal(0);
	});
});
