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
		let el = this.found.get(selector);

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
	/** Thrown from document.querySelector while set: a failing measurement. */
	let queryFails: Error | null = null;
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
				if (queryFails) {
					throw queryFails;
				}

				return selector === "#chat .chat" && columnShown ? column : null;
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
		failQueries(error: Error | null) {
			queryFails = error;
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
});
