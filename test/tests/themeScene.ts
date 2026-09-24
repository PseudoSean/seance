import {expect} from "chai";
import {
	createSceneHost,
	SCENES,
	type SceneHandle,
	type SceneHostState,
	type SceneLoader,
	type SceneModule,
} from "../../client/js/themeScene";

const ROOT = {} as HTMLElement;

/** A scene module that records what happened to it. */
function fakeScene() {
	const log: string[] = [];
	const mod: SceneModule = {
		mount(root, state): SceneHandle {
			log.push(`mount ${root === ROOT} ${state.visible} ${state.view}`);
			return {
				update: (s: SceneHostState) => log.push(`update ${s.visible} ${s.view}`),
				destroy: () => log.push("destroy"),
			};
		},
	};
	return {log, mod};
}

/** A loader that resolves only when told to. */
function deferred(mod: SceneModule) {
	let release: () => void = () => undefined;
	const loader: SceneLoader = () => new Promise((resolve) => (release = () => resolve(mod)));
	return {loader, release: () => release()};
}

const host = (loaders: Record<string, SceneLoader>, warn?: (m: string, e: unknown) => void) =>
	createSceneHost({root: () => ROOT, loaders, state: {visible: true, view: "channel"}, warn});

describe("the theme-scene hook (client/js/themeScene.ts)", function () {
	it("has a scene for ps and for no other theme", function () {
		expect(Object.keys(SCENES)).to.deep.equal(["ps"]);
	});

	it("mounts the applied theme's scene with the current state", async function () {
		const {log, mod} = fakeScene();
		const h = host({ps: () => Promise.resolve(mod)});
		await h.setTheme("ps");
		expect(h.mounted).to.equal("ps");
		expect(log).to.deep.equal(["mount true true channel"]);
	});

	it("mounts nothing for a theme without a scene, and takes the previous one down", async function () {
		const {log, mod} = fakeScene();
		const h = host({ps: () => Promise.resolve(mod)});
		await h.setTheme("ps");
		await h.setTheme("coffee");
		expect(h.mounted).to.equal(null);
		expect(log).to.deep.equal(["mount true true channel", "destroy"]);
	});

	it("never mounts a scene whose theme was switched away while it loaded", async function () {
		const {log, mod} = fakeScene();
		const d = deferred(mod);
		const h = host({ps: d.loader});
		const loading = h.setTheme("ps");
		await h.setTheme("coffee");
		d.release();
		await loading;
		expect(h.mounted).to.equal(null);
		expect(log).to.deep.equal([]);
	});

	it("mounts exactly once when a theme is re-applied, or left and re-applied quickly", async function () {
		const {log, mod} = fakeScene();
		const h = host({ps: () => Promise.resolve(mod)});
		const first = h.setTheme("ps");
		await h.setTheme("ps");
		await first;
		expect(log).to.deep.equal(["mount true true channel"]);
		const away = h.setTheme("coffee");
		const back = h.setTheme("ps");
		await Promise.all([away, back]);
		expect(log.filter((l) => l.startsWith("mount"))).to.have.length(2);
		expect(log.filter((l) => l === "destroy")).to.have.length(1);
		expect(h.mounted).to.equal("ps");
	});

	it("leaves nothing mounted and warns once when a scene fails to load", async function () {
		const warnings: string[] = [];
		const h = host({ps: () => Promise.reject(new Error("offline"))}, (m) => warnings.push(m));
		await h.setTheme("ps");
		expect(h.mounted).to.equal(null);
		expect(warnings).to.have.length(1);
	});

	it('treats a theme name that collides with an inherited key ("toString") as having no scene: mounts nothing, warns nothing, and does not throw', async function () {
		const warnings: string[] = [];
		const h = host({ps: () => Promise.resolve(fakeScene().mod)}, (m) => warnings.push(m));
		await h.setTheme("toString");
		expect(h.mounted).to.equal(null);
		expect(warnings).to.have.length(0);
	});

	it("leaves nothing mounted, warns once and empties the root when a scene's mount throws synchronously", async function () {
		const warnings: string[] = [];
		let replaceCalls = 0;
		const throwing: SceneModule = {
			mount(): SceneHandle {
				throw new Error("boom");
			},
		};
		const fakeRoot = {
			replaceChildren() {
				replaceCalls += 1;
			},
		} as unknown as HTMLElement;
		const h = createSceneHost({
			root: () => fakeRoot,
			loaders: {ps: () => Promise.resolve(throwing)},
			state: {visible: true, view: "channel"},
			warn: (m) => warnings.push(m),
		});
		await h.setTheme("ps");
		expect(h.mounted).to.equal(null);
		expect(warnings).to.have.length(1);
		expect(replaceCalls).to.equal(1);
	});

	it("forwards visibility and view to the mounted scene, only when they change", async function () {
		const {log, mod} = fakeScene();
		const h = host({ps: () => Promise.resolve(mod)});
		h.setView("query");
		await h.setTheme("ps");
		h.setVisible(false);
		h.setVisible(false);
		h.setView("query");
		h.setView("channel");
		expect(log).to.deep.equal([
			"mount true true query",
			"update false query",
			"update false channel",
		]);
	});
});
