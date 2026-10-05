/**
 * The scene's frame rate (docs/projects/ps-theme.md §10.3). Left to the
 * browser, every running animation restyles its element on every main frame,
 * 60 times a second, and each frame moves what the chrome's glass blurs. The
 * plains move slowly; SCENE_FPS frames a second are plenty (the user's call,
 * 2026-10-05). So the scene's own CSS animations and SMIL clocks are held
 * paused, and one timer advances them all together by the real time elapsed,
 * SCENE_FPS times a second: the browser draws a frame only when they move.
 *
 * Only CSS animations are stepped. Transitions (a layer's fade, the day/night
 * flip, the overcast's cross-fade) run natively, since the scene times its
 * own clean-ups against them. Writes only in a step: reading an animation's
 * state between writes would make the browser restyle once per animation, so
 * what to step is collected by refresh(), which the scene calls when its
 * layers change, and a step only writes. No Vue, no DOM: the scene hands in
 * its animations and its SVGs, so mocha drives it.
 */

/** Frames a second the scene is drawn at. 24 divides 120 and 144 Hz screens evenly; on 60 Hz it lands on two vsyncs out of five. */
export const SCENE_FPS = 24;

/** The part of a CSSAnimation the stepper uses. */
export interface StepAnimation {
	readonly playState: string;
	currentTime: number | null | CSSNumberish;
	pause(): void;
}

/** The part of an SVG root element the stepper uses. */
export interface StepSvg {
	animationsPaused(): boolean;
	pauseAnimations(): void;
	getCurrentTime(): number;
	setCurrentTime(seconds: number): void;
}

export interface Stepper {
	/** Advance from now on (a resume starts from where it stood: no jump). */
	start(): void;
	/** Hold everything where it stands; no timer is left. */
	stop(): void;
	/** Collect what to step again: the scene's animations and SVGs changed. Pauses whatever is newly running. */
	refresh(): void;
	readonly running: boolean;
}

export function createStepper(deps: {
	/** The scene's CSS animations (not its transitions), its style computed. */
	animations(): StepAnimation[];
	/** The SVGs whose SMIL moves: in a layer in its window, the heat haze only on a hot day. */
	svgs(): StepSvg[];
	now(): number;
	after(ms: number, fn: () => void): () => void;
	fps?: number;
}): Stepper {
	const interval = 1000 / (deps.fps ?? SCENE_FPS);
	// Each animation's scene time, kept here so a step never reads one back.
	let times = new Map<StepAnimation, number>();
	let svgs: StepSvg[] = [];
	let last = 0;
	let cancel: (() => void) | undefined;

	const refresh = () => {
		const next = new Map<StepAnimation, number>();
		const found = deps.animations();

		for (const a of found) {
			next.set(a, times.get(a) ?? Number(a.currentTime ?? 0));
		}

		for (const a of found) {
			if (a.playState === "running") {
				a.pause();
			}
		}

		times = next;
		svgs = deps.svgs();

		for (const svg of svgs) {
			if (!svg.animationsPaused()) {
				svg.pauseAnimations();
			}
		}
	};

	const step = () => {
		const now = deps.now();
		const dt = now - last;
		last = now;

		for (const [a, t] of times) {
			const u = t + dt;
			times.set(a, u);
			a.currentTime = u;
		}

		for (const svg of svgs) {
			svg.setCurrentTime(svg.getCurrentTime() + dt / 1000);
		}

		cancel = deps.after(interval, step);
	};

	return {
		get running() {
			return cancel !== undefined;
		},
		start() {
			if (cancel) {
				return;
			}

			refresh();
			last = deps.now();
			cancel = deps.after(interval, step);
		},
		stop() {
			cancel?.();
			cancel = undefined;
		},
		refresh,
	};
}
