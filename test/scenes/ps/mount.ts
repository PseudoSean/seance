import {expect} from "chai";
import sinon from "sinon";
import {weatherClouds} from "../../../client/js/scenes/ps/plains";
import {mount} from "../../../client/js/scenes/ps/scene";
import type {SceneHandle} from "../../../client/js/themeScene";

/*
 * scene.ts's mount() under mocha, which has no DOM: a stand-in for what
 * mount and its two watchers touch (the root and <html>, the message column,
 * matchMedia, ResizeObserver, frames, the window's listeners), every
 * observer, listener and frame recorded so a test can fire them and see what
 * is left behind. Timers are sinon's clock, so the scene's minute tick runs
 * on it. The globals are installed and removed inside each test body (mocha's
 * check-leaks runs at every hook's end too).
 */

interface Box {
	left: number;
	top: number;
	width: number;
	height: number;
}

class FakeStyle {
	props = new Map<string, string>();

	setProperty(name: string, value: string) {
		this.props.set(name, value);
	}

	removeProperty(name: string) {
		this.props.delete(name);
		return "";
	}

	getPropertyValue(name: string) {
		return this.props.get(name) ?? "";
	}
}

class FakeClassList {
	names = new Set<string>();

	contains(name: string) {
		return this.names.has(name);
	}

	add(...names: string[]) {
		names.forEach((n) => this.names.add(n));
	}

	remove(...names: string[]) {
		names.forEach((n) => this.names.delete(n));
	}

	toggle(name: string, force?: boolean) {
		const on = force ?? !this.names.has(name);

		if (on) {
			this.names.add(name);
		} else {
			this.names.delete(name);
		}

		return on;
	}
}

type Listener = (event?: unknown) => void;

class Listeners {
	all: Array<[string, Listener]> = [];

	addEventListener(type: string, fn: Listener) {
		this.all.push([type, fn]);
	}

	removeEventListener(type: string, fn: Listener) {
		this.all = this.all.filter(([t, f]) => t !== type || f !== fn);
	}
}

class FakeElement extends Listeners {
	dataset: Record<string, string> = {};
	style = new FakeStyle();
	classList = new FakeClassList();
	attrs = new Map<string, string>();
	box: Box = {left: 0, top: 0, width: 0, height: 0};
	/** Its own width, as its computed style has it, where that differs from its box (a transform on the way up). */
	layoutWidth: number | null = null;
	isConnected = true;
	markup = "";
	/** What querySelector has handed out since the markup was last set, by selector. */
	found = new Map<string, FakeElement>();
	/** What querySelector hands out whatever the markup: an element a test prepared. */
	planted = new Map<string, FakeElement>();
	/** Thrown from setAttribute while set: an apply that fails. */
	failing: Error | null = null;

	constructor(public name = "") {
		super();
	}

	set innerHTML(value: string) {
		this.markup = value;
		this.found.clear();
	}

	get innerHTML() {
		return this.markup;
	}

	querySelector(selector: string): FakeElement {
		let el = this.planted.get(selector) ?? this.found.get(selector);

		if (!el) {
			el = new FakeElement(selector);
			this.found.set(selector, el);
		}

		return el;
	}

	/** What querySelectorAll finds, by selector: nothing unless a test says (no svg for syncSvgs). */
	lists = new Map<string, () => FakeElement[]>();

	querySelectorAll(selector: string): FakeElement[] {
		return this.lists.get(selector)?.() ?? [];
	}

	setAttribute(name: string, value: string) {
		if (this.failing) {
			throw this.failing;
		}

		this.attrs.set(name, String(value));
	}

	removeAttribute(name: string) {
		this.attrs.delete(name);

		if (name === "style") {
			this.style = new FakeStyle();
		}
	}

	replaceChildren() {
		this.markup = "";
		this.found.clear();
	}

	getBoundingClientRect() {
		const {left, top, width, height} = this.box;
		return {
			left,
			top,
			width,
			height,
			right: left + width,
			bottom: top + height,
			x: left,
			y: top,
		};
	}
}

interface Observer {
	callback: () => void;
	targets: Set<unknown>;
	disconnected: boolean;
}

class FakeResizeObserver implements Observer {
	static all: Observer[] = [];
	targets = new Set<unknown>();
	disconnected = false;

	constructor(public callback: () => void) {
		FakeResizeObserver.all.push(this);
	}

	observe(target: unknown) {
		this.targets.add(target);
	}

	unobserve(target: unknown) {
		this.targets.delete(target);
	}

	disconnect() {
		this.targets.clear();
		this.disconnected = true;
	}
}

class FakeMediaQueryList extends Listeners {
	constructor(public media: string, public matches = false) {
		super();
	}

	/** The system's setting changing: `matches` becomes `on` and the change listeners hear of it. */
	set(on: boolean) {
		this.matches = on;
		this.all.filter(([type]) => type === "change").forEach(([, fn]) => fn());
	}
}

/** One of the scene's <svg>s, for syncSvgs: its SMIL clock, in no layer that is out. */
class FakeSvg {
	classList = new FakeClassList();
	paused = false;

	closest() {
		return null;
	}

	animationsPaused() {
		return this.paused;
	}

	pauseAnimations() {
		this.paused = true;
	}

	unpauseAnimations() {
		this.paused = false;
	}
}

/** The page mount() runs in, and the handles a test needs on it. */
function fakePage() {
	const root = new FakeElement("#theme-scene");
	const html = new FakeElement("html");
	const column = new FakeElement("#chat .chat");
	column.box = {left: 250, top: 0, width: 850, height: 800};
	const win = new Listeners();
	const media: FakeMediaQueryList[] = [];
	let frames = new Map<number, () => void>();
	let nextFrame = 1;
	let columnShown = true;
	/** Thrown from the column's lookup while set: a failing measurement. */
	let columnFails: Error | null = null;
	FakeResizeObserver.all = [];

	const globals: Record<string, unknown> = {
		window: Object.assign(win, {
			matchMedia(query: string) {
				const list = new FakeMediaQueryList(query);
				media.push(list);
				return list;
			},
			setTimeout: (fn: () => void, ms: number) => globalThis.setTimeout(fn, ms),
			clearTimeout: (id: number) => globalThis.clearTimeout(id),
			requestAnimationFrame(fn: () => void) {
				frames.set(nextFrame, fn);
				return nextFrame++;
			},
			cancelAnimationFrame(id: number) {
				frames.delete(id);
			},
		}),
		document: {
			documentElement: html,
			querySelector(selector: string) {
				if (selector !== "#chat .chat") {
					return null; // no theme-color meta
				}

				if (columnFails) {
					throw columnFails;
				}

				return columnShown ? column : null;
			},
			getElementById: () => null,
		},
		ResizeObserver: FakeResizeObserver,
		HTMLMetaElement: class {},
		getComputedStyle: (el: FakeElement) => ({
			opacity: "1",
			fontSize: "20px",
			width: `${el.layoutWidth ?? el.box.width}px`,
		}),
	};

	return {
		root,
		html,
		column,
		win,
		media,
		globals,
		/** The scene laid out (ps.css applied): the root's box and the yurt's. */
		layOut(width: number) {
			root.box = {left: 0, top: 0, width, height: 900};
			root.querySelector(".ps-yurt").box = {left: 0, top: 0, width: 267, height: 189};
		},
		hideColumn() {
			columnShown = false;
			column.isConnected = false;
		},
		failColumnLookup(error: Error | null) {
			columnFails = error;
		},
		/** What the browser does when `target` changes size: each observer watching it is called once. */
		resize(target: unknown) {
			for (const ro of FakeResizeObserver.all) {
				if (ro.targets.has(target)) {
					ro.callback();
				}
			}
		},
		/** Run the frame callbacks queued so far. */
		frame() {
			const due = frames;
			frames = new Map();
			due.forEach((fn) => fn());
		},
		pendingFrames: () => frames.size,
		observers: () => FakeResizeObserver.all,
		/** The prefers-reduced-motion list the scene asked for. */
		reducedMotion: () => media.find((m) => m.media === "(prefers-reduced-motion: reduce)")!,
		/** An <svg> in the scene, for syncSvgs to pause and run. */
		plantSvg() {
			const svg = new FakeSvg();
			root.lists.set("svg", () => [svg as unknown as FakeElement]);
			return svg;
		},
	};
}

type Page = ReturnType<typeof fakePage>;

/** Run `fn` with the fake page's globals installed and sinon's clock at a clear noon; both removed after. */
function withPage(fn: (page: Page, clock: sinon.SinonFakeTimers) => void) {
	const page = fakePage();
	const g = globalThis as Record<string, unknown>;
	const names = Object.keys(page.globals);

	for (const name of names) {
		expect(name in g, `${name} is not a global already`).to.equal(false);
		g[name] = page.globals[name];
	}

	const clock = sinon.useFakeTimers({now: new Date(2026, 8, 25, 12, 30).getTime()});

	try {
		fn(page, clock);
	} finally {
		clock.restore();

		for (const name of names) {
			delete g[name];
		}
	}
}

const mountOn = (page: Page, visible = true): SceneHandle =>
	mount(page.root as unknown as HTMLElement, {visible, view: "channel"});

/** What a scene has left running and written, read off the stand-in page. */
function leftBehind(page: Page, clock: sinon.SinonFakeTimers) {
	return {
		observers: page.observers().filter((o) => !o.disconnected).length,
		windowListeners: page.win.all.map(([type]) => type),
		mediaListeners: page.media.flatMap((m) => m.all.map(([type]) => `${m.media} ${type}`)),
		frames: page.pendingFrames(),
		timers: clock.countTimers(),
		rootMarkup: page.root.markup.length,
		rootData: Object.keys(page.root.dataset),
		rootStyle: [...page.root.style.props.keys()],
		rootClasses: [...page.root.classList.names],
		htmlData: Object.keys(page.html.dataset),
		htmlStyle: [...page.html.style.props.keys()],
		htmlClasses: [...page.html.classList.names],
	};
}

const NOTHING = {
	observers: 0,
	windowListeners: [],
	mediaListeners: [],
	frames: 0,
	timers: 0,
	rootMarkup: 0,
	rootData: [],
	rootStyle: [],
	rootClasses: [],
	htmlData: [],
	htmlStyle: [],
	htmlClasses: [],
};

describe("ps scene: mount (scene.ts, on a stand-in page)", function () {
	describe("the yurt waits for the scene to be laid out (the boot race)", function () {
		it("places nothing while the scene has no box, and the yurt's first place once it has one", function () {
			withPage((page) => {
				const scene = mountOn(page); // ps.css not applied yet: #theme-scene is display: none
				page.frame();
				page.resize(page.column); // the column's first observation
				expect(
					page.root.style.getPropertyValue("--ps-yurt-left"),
					"nothing placed at 0"
				).to.equal("");

				page.layOut(1280);
				page.resize(page.root); // ps.css shows the scene
				expect(page.root.style.getPropertyValue("--ps-yurt-left")).to.equal(
					`${(250 + 0.72 * 850).toFixed(2)}px`
				);
				expect(page.root.classList.contains("ps-yurt-moving"), "no fade").to.equal(false);
				scene.destroy();
			});
		});

		it("clamps the last place again when the scene narrows with no column on the page", function () {
			withPage((page) => {
				const scene = mountOn(page);
				page.layOut(1280);
				page.resize(page.column);
				expect(page.root.style.getPropertyValue("--ps-yurt-left")).to.equal("862.00px");
				page.hideColumn(); // Settings
				page.layOut(990); // the window narrowed there: 990 − 133.5
				page.resize(page.root);
				expect(page.root.style.getPropertyValue("--ps-yurt-left")).to.equal("856.50px");
				scene.destroy();
			});
		});
	});

	describe("a mount that throws leaves nothing running", function () {
		it("runs, and a destroy leaves nothing behind (the control)", function () {
			withPage((page, clock) => {
				const scene = mountOn(page);
				const running = leftBehind(page, clock);
				expect(running.observers, "the yurt's and the composer's").to.equal(2);
				expect(running.windowListeners).to.deep.equal(["resize"]);
				expect(running.mediaListeners).to.deep.equal([
					"(prefers-reduced-motion: reduce) change",
				]);
				expect(running.timers, "the minute's tick").to.equal(1);
				expect(running.htmlData).to.have.members(["psLight", "psText"]);
				scene.destroy();
				expect(leftBehind(page, clock)).to.deep.equal(NOTHING);
			});
		});

		it("destroys what it built and rethrows when the first tick throws", function () {
			withPage((page, clock) => {
				const bad = new Error("a bad moment");
				// The moon's ellipse is written late in apply, after the observers,
				// the listeners, the gates and the weather.
				const ellipse = new FakeElement(".ps-m-ell");
				ellipse.failing = bad;
				page.root.planted.set(".ps-m-ell", ellipse);
				expect(() => mountOn(page)).to.throw(bad);
				expect(leftBehind(page, clock)).to.deep.equal(NOTHING);
			});
		});

		it("destroys what it built and rethrows when looking for the column throws", function () {
			withPage((page, clock) => {
				const bad = new Error("a bad measurement");
				page.failColumnLookup(bad);
				expect(() => mountOn(page)).to.throw(bad);
				expect(leftBehind(page, clock)).to.deep.equal(NOTHING);
			});
		});
	});

	describe("the minute's tick", function () {
		it("draws the next minute after one whose apply threw", function () {
			withPage((page, clock) => {
				const scene = mountOn(page);
				const ellipse = page.root.querySelector(".ps-m-ell");
				const writes = sinon.spy(ellipse, "setAttribute");
				ellipse.failing = new Error("a bad minute");
				expect(() => clock.tick(61000)).to.throw("a bad minute");
				expect(clock.countTimers(), "the next minute is still due").to.equal(1);
				ellipse.failing = null;
				writes.resetHistory();
				clock.tick(61000);
				expect(writes.calledWith("rx"), "the next minute was drawn").to.equal(true);
				expect(clock.countTimers()).to.equal(1);
				scene.destroy();
			});
		});

		it("keeps ticking after a visible page's catch-up throws", function () {
			withPage((page, clock) => {
				const scene = mountOn(page, false); // mounted into a hidden page: no tick yet
				expect(clock.countTimers()).to.equal(0);
				const ellipse = page.root.querySelector(".ps-m-ell");
				ellipse.failing = new Error("a bad minute");
				expect(() => scene.update({visible: true, view: "channel"})).to.throw(
					"a bad minute"
				);
				expect(clock.countTimers(), "the next minute is still due").to.equal(1);
				ellipse.failing = null;
				const writes = sinon.spy(ellipse, "setAttribute");
				clock.tick(61000);
				expect(writes.calledWith("rx")).to.equal(true);
				scene.destroy();
			});
		});
	});

	describe("the day's weather, rebuilt", function () {
		it("rebuilds the weather's own clouds with the day's weather, and never the five (the user, 2026-09-26)", function () {
			withPage((page, clock) => {
				const overcast = new FakeElement(".ps-overcast");
				const field = new FakeElement(".ps-cloud-field");
				let builds = 0;
				Object.defineProperty(overcast, "innerHTML", {
					set(value: string) {
						overcast.markup = value;
						builds++;
					},
				});
				page.root.planted.set(".ps-overcast", overcast);
				page.root.planted.set(".ps-cloud-field", field);
				const scene = mountOn(page); // 25 September: clear

				// Waking into another day.
				const shownOn = (date: Date) => {
					scene.update({visible: false, view: "channel"});
					clock.setSystemTime(date);
					scene.update({visible: true, view: "channel"});
				};

				expect(page.root.dataset.weather).to.equal("clear");
				expect(overcast.markup, "a clear day adds nothing").to.equal("");

				shownOn(new Date(2026, 8, 26, 12, 30));
				expect(page.root.dataset.weather).to.equal("rain");
				expect(overcast.markup, "rain's four").to.equal(weatherClouds("rain"));
				const rainBuilds = builds;

				clock.tick(60000); // the next minute, the same day: nothing rebuilt
				expect(builds).to.equal(rainBuilds);

				shownOn(new Date(2026, 6, 19, 12, 30));
				expect(page.root.dataset.weather).to.equal("storm");
				expect(overcast.markup, "the storm's deck and four").to.equal(
					weatherClouds("storm")
				);

				shownOn(new Date(2026, 8, 25, 12, 30));
				expect(overcast.markup, "clear again").to.equal("");
				expect(field.markup, "the five are the mount's, never rebuilt").to.equal("");
				scene.destroy();
			});
		});

		it("takes out the seeds a new day's weather built when its wind shows none (a clear 30 January, a snowy 31st)", function () {
			withPage((page, clock) => {
				// The weather layer's seeds, as its latest build made them.
				const weather = new FakeElement(".ps-weather");
				let seeds: FakeElement | null = null;
				Object.defineProperty(weather, "innerHTML", {
					set(value: string) {
						weather.markup = value;
						seeds = value.includes('class="ps-seeds"')
							? new FakeElement(".ps-seeds")
							: null;
					},
				});
				page.root.planted.set(".ps-weather", weather);
				page.root.lists.set(".ps-seeds", () => (seeds ? [seeds] : []));

				clock.setSystemTime(new Date(2026, 0, 30, 12, 30));
				const scene = mountOn(page);
				expect(page.root.dataset.weather).to.equal("clear");
				expect(seeds, "no seeds on a day without wind").to.equal(null);

				scene.update({visible: false, view: "channel"});
				clock.setSystemTime(new Date(2026, 0, 31, 12, 30));
				scene.update({visible: true, view: "channel"}); // waking into the next day
				expect(page.root.dataset.weather).to.equal("snow");
				expect(page.root.style.getPropertyValue("--ps-wind-op")).to.equal("0.00");
				expect(seeds, "the snow's seeds are built").to.not.equal(null);
				expect(seeds!.classList.contains("ps-off"), "and out of the render tree").to.equal(
					true
				);
				scene.destroy();
			});
		});
	});

	describe("the private view: frosted and still in a query (spec §5.7)", function () {
		/** The two classes the private view is made of, on the root. */
		const state = (page: Page) =>
			["ps-private", "ps-paused"].filter((name) => page.root.classList.contains(name));

		it("frosts and stills the scene while a query is open, and a channel and every other view show it as usual", function () {
			withPage((page, clock) => {
				const svg = page.plantSvg();
				const scene = mountOn(page);
				expect(state(page), "a channel").to.deep.equal([]);
				expect(svg.paused).to.equal(false);

				scene.update({visible: true, view: "query"});
				expect(state(page), "a query").to.deep.equal(["ps-private", "ps-paused"]);
				expect(svg.paused, "its SVG clocks too").to.equal(true);
				expect(clock.countTimers(), "the minute's tick keeps running").to.equal(1);

				scene.update({visible: true, view: "channel"});
				expect(state(page), "back in a channel").to.deep.equal([]);
				expect(svg.paused).to.equal(false);

				scene.update({visible: true, view: "query"});
				scene.update({visible: true, view: "other"});
				expect(state(page), "Settings, Help, the connect form").to.deep.equal([]);
				expect(svg.paused).to.equal(false);
				scene.destroy();
			});
		});

		it("keeps the colours on the hour in a query: the next minute is drawn, and the scene stays still", function () {
			withPage((page, clock) => {
				const scene = mount(page.root as unknown as HTMLElement, {
					visible: true,
					view: "query",
				});
				expect(state(page)).to.deep.equal(["ps-private", "ps-paused"]);
				const writes = sinon.spy(page.root.querySelector(".ps-m-ell"), "setAttribute");
				clock.tick(61000);
				expect(writes.calledWith("rx"), "the next minute was drawn").to.equal(true);
				expect(state(page)).to.deep.equal(["ps-private", "ps-paused"]);
				scene.destroy();
			});
		});

		it("composes with a hidden page: hidden stops it and its minute, shown again in the query it stays still, and leaving the query runs it", function () {
			withPage((page, clock) => {
				const svg = page.plantSvg();
				const scene = mountOn(page);
				scene.update({visible: true, view: "query"});

				scene.update({visible: false, view: "query"});
				expect(state(page), "hidden, in a query").to.deep.equal([
					"ps-private",
					"ps-paused",
				]);
				expect(svg.paused).to.equal(true);
				expect(clock.countTimers(), "no tick on a hidden page").to.equal(0);

				scene.update({visible: true, view: "query"});
				expect(state(page), "shown again, still in the query").to.deep.equal([
					"ps-private",
					"ps-paused",
				]);
				expect(svg.paused).to.equal(true);
				expect(clock.countTimers(), "the minute's tick again").to.equal(1);

				scene.update({visible: true, view: "channel"});
				expect(state(page), "the query left").to.deep.equal([]);
				expect(svg.paused).to.equal(false);

				// Hidden wins over a channel as well, and a view changed while hidden is the one shown.
				scene.update({visible: false, view: "channel"});
				scene.update({visible: false, view: "query"});
				expect(state(page), "a query opened on a hidden page").to.deep.equal([
					"ps-private",
					"ps-paused",
				]);
				scene.update({visible: false, view: "channel"});
				expect(state(page), "hidden, in a channel").to.deep.equal(["ps-paused"]);
				expect(svg.paused).to.equal(true);
				scene.update({visible: true, view: "channel"});
				expect(state(page)).to.deep.equal([]);
				expect(svg.paused).to.equal(false);
				scene.destroy();
			});
		});

		it("starts frosted and still when mounted into a query, hidden or shown", function () {
			for (const visible of [false, true]) {
				withPage((page, clock) => {
					const svg = page.plantSvg();
					const scene = mount(page.root as unknown as HTMLElement, {
						visible,
						view: "query",
					});
					expect(state(page), `visible ${visible}`).to.deep.equal([
						"ps-private",
						"ps-paused",
					]);
					expect(svg.paused).to.equal(true);
					expect(clock.countTimers()).to.equal(visible ? 1 : 0);
					scene.destroy();
				});
			}
		});

		it("stays still in a query when reduced motion is lifted, and reduced motion still holds a channel", function () {
			withPage((page) => {
				const svg = page.plantSvg();
				const scene = mountOn(page);
				const reduced = page.reducedMotion();
				scene.update({visible: true, view: "query"});
				reduced.set(true);
				expect(state(page)).to.deep.equal(["ps-private", "ps-paused"]);
				reduced.set(false);
				expect(state(page), "lifted, in a query").to.deep.equal([
					"ps-private",
					"ps-paused",
				]);
				expect(svg.paused).to.equal(true);

				scene.update({visible: true, view: "channel"});
				expect(state(page)).to.deep.equal([]);
				reduced.set(true);
				expect(state(page), "reduced motion, in a channel").to.deep.equal(["ps-paused"]);
				scene.update({visible: true, view: "query"});
				scene.update({visible: true, view: "channel"});
				expect(state(page), "reduced motion, back in a channel").to.deep.equal([
					"ps-paused",
				]);
				expect(svg.paused).to.equal(true);
				scene.destroy();
			});
		});

		it("leaves nothing behind when destroyed in a query", function () {
			withPage((page, clock) => {
				const scene = mountOn(page);
				scene.update({visible: true, view: "query"});
				scene.destroy();
				expect(leftBehind(page, clock)).to.deep.equal(NOTHING);
			});
		});

		it("publishes the same values in a query as in a channel: the frost is the stylesheet's alone", function () {
			withPage((page, clock) => {
				/** What the chrome and the scene's CSS read: <html>'s and the root's values. */
				const published = () => ({
					htmlData: {...page.html.dataset},
					htmlStyle: Object.fromEntries(page.html.style.props),
					htmlClasses: [...page.html.classList.names],
					rootStyle: Object.fromEntries(page.root.style.props),
					rootData: {...page.root.dataset, view: undefined},
				});

				let scene = mountOn(page);
				const inChannel = published();
				scene.update({visible: true, view: "query"});
				expect(published(), "opening the query").to.deep.equal(inChannel);

				clock.tick(60 * 60000 + 1000); // an hour on, every minute of it drawn in the query
				const inQuery = published();
				expect(inQuery.htmlStyle, "the hour's own values").to.not.deep.equal(
					inChannel.htmlStyle
				);
				scene.destroy();
				scene = mountOn(page); // the same minute, drawn in a channel
				expect(published()).to.deep.equal(inQuery);
				scene.destroy();
			});
		});

		it("clamps the yurt by its own width, not by the box the frost's scale draws it in", function () {
			withPage((page) => {
				const scene = mountOn(page);
				page.layOut(1280);
				page.resize(page.column);
				expect(page.root.style.getPropertyValue("--ps-yurt-left")).to.equal("862.00px");
				scene.update({visible: true, view: "query"});
				page.hideColumn();
				page.layOut(990);
				const yurt = page.root.querySelector(".ps-yurt");
				yurt.layoutWidth = 267;
				yurt.box = {...yurt.box, width: 267 * 1.2}; // under the frost's scale(1.2)
				page.resize(page.root);
				expect(page.root.style.getPropertyValue("--ps-yurt-left")).to.equal("856.50px");
				expect(page.root.classList.contains("ps-yurt-moving"), "no fade").to.equal(false);
				scene.destroy();
			});
		});
	});
});
