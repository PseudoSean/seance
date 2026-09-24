/**
 * The theme-scene hook (docs/projects/ps-theme.md §3): the one place the app
 * lets a theme bring page elements of its own. A theme listed in SCENES has its
 * scene module mounted into #theme-scene (client/index.html) when it is applied,
 * and destroyed when another theme is; every other theme loads nothing. The
 * hook tells a scene only what any theme could want: whether the page is
 * visible, and what kind of conversation is open. It never reads a colour or a
 * time. It touches the document only inside functions, so mocha loads it.
 */

export type SceneView = "channel" | "query" | "other";

export interface SceneHostState {
	visible: boolean;
	view: SceneView;
}

export interface SceneHandle {
	update(state: SceneHostState): void;
	destroy(): void;
}

export interface SceneModule {
	mount(root: HTMLElement, state: SceneHostState): SceneHandle;
}

export type SceneLoader = () => Promise<SceneModule>;

/** The themes that have a scene, by theme name: each is its own chunk, loaded only for that theme. */
export const SCENES: Readonly<Record<string, SceneLoader>> = {
	ps: () => import(/* webpackChunkName: "scene-ps" */ "./scenes/ps/scene"),
};

export interface SceneHost {
	setTheme(name: string): Promise<void>;
	setVisible(visible: boolean): void;
	setView(view: SceneView): void;
	readonly mounted: string | null;
}

export function createSceneHost(opts: {
	root: () => HTMLElement | null;
	loaders: Readonly<Record<string, SceneLoader>>;
	state: SceneHostState;
	warn?: (message: string, error: unknown) => void;
}): SceneHost {
	const state: SceneHostState = {...opts.state};
	let asked: string | null = null;
	let mounted: string | null = null;
	let handle: SceneHandle | null = null;
	let ticket = 0;

	const unmount = () => {
		handle?.destroy();
		handle = null;
		mounted = null;
	};

	return {
		get mounted() {
			return mounted;
		},

		async setTheme(name: string): Promise<void> {
			if (name === asked) {
				return;
			}

			asked = name;
			const mine = ++ticket;
			unmount();
			// Object.hasOwn: a stored theme name of "toString" or the like must not
			// resolve to an inherited Object.prototype member.
			const load = Object.hasOwn(opts.loaders, name) ? opts.loaders[name] : undefined;

			if (!load) {
				return;
			}

			let mod: SceneModule;

			try {
				mod = await load();
			} catch (error) {
				if (mine === ticket) {
					opts.warn?.(
						`The ${name} theme's scene did not load; its daylight fallback stays.`,
						error
					);
				}

				return;
			}

			// Another theme was applied while this one loaded: it wins.
			const root = opts.root();

			if (mine !== ticket || !root) {
				return;
			}

			// A scene's mount can throw synchronously (bad markup, a bad measurement);
			// caught here so it never becomes an unhandled rejection through the
			// `void` call in settings.ts, and never leaves a half-built scene.
			try {
				handle = mod.mount(root, {...state});
				mounted = name;
			} catch (error) {
				opts.warn?.(
					`The ${name} theme's scene failed to mount; its daylight fallback stays.`,
					error
				);
				root.replaceChildren();
			}
		},

		setVisible(visible: boolean): void {
			if (state.visible === visible) {
				return;
			}

			state.visible = visible;
			handle?.update({...state});
		},

		setView(view: SceneView): void {
			if (state.view === view) {
				return;
			}

			state.view = view;
			handle?.update({...state});
		},
	};
}

/** The app's host. */
export const themeScene: SceneHost = createSceneHost({
	root: () => document.getElementById("theme-scene"),
	loaders: SCENES,
	state: {visible: true, view: "other"},
	warn: (message, error) => console.warn(message, error), // eslint-disable-line no-console
});

/** Follow the page's visibility: a hidden page's scene stops, and catches up on return. */
export function installThemeSceneHooks(): void {
	const sync = () => themeScene.setVisible(document.visibilityState !== "hidden");
	document.addEventListener("visibilitychange", sync);
	sync();
}
