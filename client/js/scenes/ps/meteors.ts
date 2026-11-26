/**
 * Shooting stars over the ps scene (the user, 2026-11-26; design
 * docs/superpowers/specs/2026-11-26-ps-scene-mountains-design.md): on clear
 * nights only, with the stars, a sporadic one every few minutes, and from
 * 17 July to 24 August the Perseids, building to the peak nights of 12–13
 * August, when after midnight one crosses about every half minute, all of
 * them radiating from one point up and to the left. A bright moon that is up
 * thins them.
 *
 * The markup is a fixed set of streaks, each its own long CSS loop (ps.css
 * `ps-meteor`): invisible for almost all of it, then under a second's run.
 * The minute tick publishes how many of each kind are live (layers.ts gates
 * the rest out of the render tree) and the layer's level. Pure: mocha loads it.
 */
import {rng, type Moment} from "./engine";
import {bodyOpacity} from "./grounds";
import {WEATHER, type Palette} from "./palette";

/** The sporadic streaks the markup holds, and the shower's. */
export const SPORADIC = 2;
export const PERSEIDS = 8;

/** The Perseids by day of the year: from 17 July, the peak 12–13 August, over by 24 August (a leap year runs a day early). */
const SHOWER_FROM = 198;
const PEAK_FROM = 224;
const PEAK_TO = 225;
const SHOWER_TO = 236;

/** The shower's strength on a day, 0–1. */
function shower(doy: number): number {
	if (doy < SHOWER_FROM || doy > SHOWER_TO) {
		return 0;
	}

	if (doy < PEAK_FROM) {
		return (doy - SHOWER_FROM) / (PEAK_FROM - SHOWER_FROM);
	}

	return doy <= PEAK_TO ? 1 : (SHOWER_TO - doy) / (SHOWER_TO - PEAK_TO);
}

/** How many of each kind of streak are live at a moment, and the layer's opacity. */
export function meteorsAt(
	m: Moment,
	p: Palette
): {sporadic: number; perseids: number; level: number} {
	if (WEATHER[m.weather].hide !== 0 || p.stars <= 0) {
		return {sporadic: 0, perseids: 0, level: 0};
	}

	const moonlight = bodyOpacity(m, p).moon * m.phase.illumination;
	const smallHours = m.minute < m.sunrise;
	const evening = m.minute >= 720 ? 0.5 : 1;
	return {
		sporadic: moonlight < 0.1 && smallHours ? 2 : 1,
		perseids: Math.round(shower(m.doy) * PERSEIDS * evening * (1 - 0.5 * moonlight)),
		level: p.stars * (1 - 0.4 * moonlight),
	};
}

/**
 * The minute's offset of every streak's place, in % of the sky's width and
 * height: a new draw each minute (seeded by the day and the minute, so every
 * device agrees), which each streak takes its own share of. A streak recurs
 * every few minutes, so each time it runs somewhere else and no track repeats;
 * it is unseen for all but under a second of its loop, so the move never shows.
 */
export function meteorJitter(m: Moment): {x: number; y: number} {
	const r = rng(m.dayNumber * 1440 + Math.floor(m.minute));
	return {x: (r() * 2 - 1) * 12, y: (r() * 2 - 1) * 8};
}

const f = (v: number, d = 1) => v.toFixed(d);

/**
 * The streaks: SPORADIC `ps-meteor` then PERSEIDS `ps-perseid`, each placed
 * in the upper sky with its own angle, travel, length, period, delay and
 * brightness (mostly faint, about one in four bright). The shower's angles
 * all point away from one radiant off the sky's upper left.
 */
export function meteorsMarkup(): string {
	const r = rng(1312);
	let out = "";

	for (let i = 0; i < SPORADIC + PERSEIDS; i++) {
		const perseid = i >= SPORADIC;
		const x = 12 + r() * 76;
		const y = 4 + r() * 30;
		// The radiant at (-12 %, -40 %) of the sky; the scene is about 16:9, so a height is 0.56 of a width.
		const angle = perseid
			? (Math.atan2((y + 40) * 0.56, x + 12) * 180) / Math.PI
			: r() < 0.5
			? 20 + r() * 45
			: 115 + r() * 45;
		const travel = 10 + r() * 12;
		const length = 3 + r() * 3;
		const period = 200 + r() * 80;
		const delay = -r() * period;
		const bright = r() < 0.25 ? 1 : 0.45 + r() * 0.25;
		const share = (k: number) => (k < 0.5 ? -1 : 1) * (0.4 + r() * 0.6);
		const sx = share(r());
		const sy = share(r());
		// Numbered within its kind (`--mi`, which ps.css holds against the published count, as a
		// flock's --fi); the streak itself is the inner element, so its run never fights that opacity.
		out +=
			`<i class="${perseid ? "ps-perseid" : "ps-meteor"}" style="--mi:${
				perseid ? i - SPORADIC : i
			};` +
			`left:calc(${f(x)}% + var(--ps-meteor-jx, 0%) * ${f(sx, 2)});` +
			`top:calc(${f(y)}% + var(--ps-meteor-jy, 0%) * ${f(sy, 2)});--ma:${f(
				angle
			)}deg;--mx:${f(travel)}cqw;--ml:${f(length, 2)}rem;` +
			`--md:${f(period)}s;--mdl:${f(delay)}s;--mb:${f(bright, 2)}"><b></b></i>`;
	}

	return out;
}
