/**
 * The legibility rule for words over the plains (docs/projects/ps-theme.md
 * §11), shared by the floors test (test/scenes/ps/legibility.ts) and the
 * palette generator (tools/ps/message-palette.ts). A message can sit on any sky
 * or land colour of its minute, bare or under the day's weather veil. Its
 * treatment's own layer, the halo by day or the shadow while the light changes
 * and all night, lies between it and that ground at strength ALPHA (0.6 until
 * a rendered-pixel calibration says otherwise; §11).
 */
import {luminance, mix} from "../../client/js/scenes/ps/colour";
import {momentFor, WEATHERS, type Weather} from "../../client/js/scenes/ps/engine";
import {paletteAt, publishedFor, WEATHER, type Palette} from "../../client/js/scenes/ps/palette";

export const ALPHA = 0.6;
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
	return mix(ground, text === "ink" ? halo : "#000000", ALPHA);
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
