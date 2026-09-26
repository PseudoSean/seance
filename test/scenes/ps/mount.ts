import {expect} from "chai";
import sinon from "sinon";
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

	querySelectorAll(): FakeElement[] {
		return []; // no svg and no gated layer: nothing for syncSvgs or the gates to touch
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
		getComputedStyle: () => ({opacity: "1", fontSize: "20px"}),
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
});
