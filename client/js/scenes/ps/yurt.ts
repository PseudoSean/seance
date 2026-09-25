/**
 * Where the ps theme's yurt stands (docs/projects/ps-theme.md §5.3): in the
 * far third of the message column, 72 % of its width from its left edge; with
 * no column on screen, where it last stood; before any column was measured,
 * at 70 % of the scene (ps.css's own default).
 *
 * It never slides. A change under 1.5 rem (a window being dragged wider)
 * is followed at once; a larger one (the user list opens, a private
 * conversation opens) fades the yurt and its smoke out where they stood,
 * jumps while unseen and fades them in where they now stand. A change that
 * comes while a fade is running retargets that fade's jump; there is never a
 * second fade, so two quick toggles end where the last one put it.
 *
 * Pure and DOM-free: scene.ts measures the column and carries out the effects
 * (a custom property, a class, a timer and a frame), so mocha drives all of it.
 */

/** The yurt's centre, as a fraction of the message column's width from its left edge. */
export const YURT_AT = 0.72;
/** Before any column was measured: a fraction of the scene's width (the mockup's 70 %). */
export const YURT_DEFAULT = 0.7;
/** How long the yurt takes to fade out before it jumps (ps.css fades it in 0.38 s). */
export const FADE_MS = 400;
/** A change of place under this many rem is followed at once, without a fade. */
export const FOLLOW_REM = 1.5;

/** The message column's box, in px from the scene's left. */
export interface Column {
	left: number;
	width: number;
}

/**
 * The yurt's centre in px from the scene's left: 72 % across the column; with
 * no column, `last`; with neither, 70 % of the scene.
 */
export function yurtPlace(column: Column | null, last: number | null, sceneWidth: number): number {
	if (column) {
		return column.left + YURT_AT * column.width;
	}

	return last ?? YURT_DEFAULT * sceneWidth;
}

/**
 * What a change of place from `current` to `next` does: `follow` it at once
 * when it is under 1.5 rem and nothing is fading; `fade` for a larger one;
 * `retarget` whenever a fade is already running (its jump takes the new place).
 */
export function yurtMove(
	current: number,
	next: number,
	remPx: number,
	fading: boolean
): "follow" | "fade" | "retarget" {
	if (fading) {
		return "retarget";
	}

	return Math.abs(next - current) < FOLLOW_REM * remPx ? "follow" : "fade";
}

/** What the follower asks of the page. Each scheduler returns its own cancel. */
export interface YurtEffects {
	/** Stand the yurt and its smoke at `px` from the scene's left. */
	place(px: number): void;
	/** Fade the yurt and its smoke out (true) or back in (false). */
	hide(on: boolean): void;
	after(ms: number, fn: () => void): () => void;
	nextFrame(fn: () => void): () => void;
}

export interface YurtFollower {
	/** One measurement of the column (null: none on screen, or one not laid out). */
	measure(column: Column | null, sceneWidth: number, remPx: number): void;
	/** Where the yurt stands, in px; null while ps.css's 70 % stands. */
	readonly place: number | null;
	readonly fading: boolean;
	/** Cancel a fade in flight; nothing further happens. */
	stop(): void;
}

/**
 * The yurt's follow-or-fade rule over time: each measurement is followed at
 * once, faded to, or taken as a running fade's new target. A fade hides the
 * yurt, waits FADE_MS, places it at the latest target, and shows it on the
 * next frame (re-placing it first if the target moved in between).
 */
export function yurtFollower(fx: YurtEffects): YurtFollower {
	let shown: number | null = null;
	let target = 0;
	let fading = false;
	let cancelTimer: (() => void) | null = null;
	let cancelFrame: (() => void) | null = null;

	const put = (px: number) => {
		shown = px;
		fx.place(px);
	};

	const reveal = () => {
		cancelFrame = null;

		if (target !== shown) {
			put(target);
		}

		fading = false;
		fx.hide(false);
	};

	const jump = () => {
		cancelTimer = null;
		put(target);
		cancelFrame = fx.nextFrame(reveal);
	};

	return {
		get place() {
			return shown;
		},

		get fading() {
			return fading;
		},

		measure(column, sceneWidth, remPx) {
			// No column (Settings, Help, the connect form) keeps the place, and a
			// fade in flight still lands where it was going.
			if (!column || column.width <= 0) {
				return;
			}

			const next = yurtPlace(column, shown, sceneWidth);
			const current = shown ?? yurtPlace(null, null, sceneWidth);

			switch (yurtMove(current, next, remPx, fading)) {
				case "follow":
					if (next !== shown) {
						put(next);
					}

					return;
				case "retarget":
					target = next;
					return;
				case "fade":
					target = next;
					fading = true;
					fx.hide(true);
					cancelTimer = fx.after(FADE_MS, jump);
			}
		},

		stop() {
			cancelTimer?.();
			cancelFrame?.();
			cancelTimer = null;
			cancelFrame = null;
		},
	};
}
