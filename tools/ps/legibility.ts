/**
 * The legibility rule for words over the plains (docs/projects/ps-theme.md
 * §11), shared by the floors test (test/scenes/ps/legibility.ts) and the
 * palette generator (tools/ps/message-palette.ts). A message can sit on any sky
 * or land colour of its minute, bare or under the day's weather veil. Its
 * treatment's own layer, the halo by day or the shadow while the light changes
 * and all night, lies between it and that ground at the strength measured in
 * rendered pixels: ALPHA_HALO or ALPHA_SHADOW (§11).
 */
import {luminance, mix} from "../../client/js/scenes/ps/colour";
import {momentFor, WEATHERS, type Weather} from "../../client/js/scenes/ps/engine";
import {paletteAt, publishedFor, WEATHER, type Palette} from "../../client/js/scenes/ps/palette";

/**
 * How far each treatment moves the ground right around a word toward its own
 * colour, measured once in rendered pixels on 2026-09-24 and used as
 * min(0.6, measured), so the measurement could only make the check stricter
 * (docs/projects/ps-theme.md §11):
 *
 *   node tools/browser-drive.mjs tools/ps/calibrate.mjs --out=<dir>
 *
 * against a production build. Headless Chromium drew swatches of 360 × 48 CSS
 * px at the default font-size step (html 20px), in the treatments computed off
 * a real message: Mulish 500 20px ("The quick brown fox 0123") and Fraunces
 * 700 20px ("Marigold Ősz"), at device scale factor 1 and 2. White with the
 * shadow was drawn over #ffb96f, #fdfaf0, #fffef6, #eef2f7, #9ccaf5 and
 * #69b04a; #1b2638 with the halo (#ebf5fd) over #9ccaf5, #69b04a and #ffc478
 * (over #eef2f7 the halo is too close to the ground to measure). The ring is
 * the pixels one CSS px out from the glyphs. At each ring pixel the strength
 * is the projection of its colour onto ground → treatment colour. Each swatch
 * gives the 10th percentile over its ring, and the lowest swatch counts:
 *
 * - halo: 0.2175 (Mulish, DPR 1, over #ffc478), median 0.39;
 * - shadow: 0.1099 (Mulish, DPR 2, over #fffef6), median 0.25.
 *
 * Both are written rounded down.
 */
export const ALPHA_HALO = Math.min(0.6, 0.2174);
export const ALPHA_SHADOW = Math.min(0.6, 0.1099);
export const INK = "#1b2638";
export const INK_FAINT = "#4c5a72";
/** The days checked: each season's anchor, the solstices and equinoxes, and 1 January. */
export const DOYS = [1, 32, 79, 121, 172, 213, 265, 305, 355];
export const MINUTE_STEP = 5;

export function messageGrounds(p: Palette, weather: Weather): string[] {
	const bare = [
		p.skyTop,
		p.skyMid,
		p.skyHorizon,
		p.mount,
		p.far,
		p.hill2,
		p.hill1,
		p.grass,
		p.blade,
	];
	const wx = WEATHER[weather];
	return wx.dim > 0 ? [...bare, ...bare.map((g) => mix(g, wx.dimc, wx.dim))] : bare;
}

export function effectiveGround(ground: string, text: "ink" | "light", halo: string): string {
	return text === "ink" ? mix(ground, halo, ALPHA_HALO) : mix(ground, "#000000", ALPHA_SHADOW);
}

/** Every effective ground a message can meet, with the treatment in force at that moment. */
export function eachChecked(
	visit: (text: "ink" | "light", effective: string, where: string) => void
): void {
	for (const doy of DOYS) {
		for (let minute = 0; minute < 1440; minute += MINUTE_STEP) {
			for (const weather of WEATHERS) {
				const p = paletteAt(
					momentFor({minute, doy, dayNumber: doy, epochDays: 20000, weather})
				);
				const {text, halo} = publishedFor(p);

				for (const g of messageGrounds(p, weather)) {
					visit(
						text,
						effectiveGround(g, text, halo),
						`doy ${doy} ${minute} min ${weather} on ${g}`
					);
				}
			}
		}
	}
}

export interface CheckedGround {
	hex: string;
	lum: number;
	where: string;
}

let cache: Record<"ink" | "light", CheckedGround[]> | undefined;

/** eachChecked's grounds, computed once per process with their luminance: about 15,000 palettes. */
export function checkedGrounds(): Record<"ink" | "light", CheckedGround[]> {
	if (!cache) {
		const out: Record<"ink" | "light", CheckedGround[]> = {ink: [], light: []};
		eachChecked((text, hex, where) => out[text].push({hex, lum: luminance(hex), where}));
		cache = out;
	}

	return cache;
}
