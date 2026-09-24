/** sRGB ↔ OKLCH (Björn Ottosson's OKLab), for solving a colour's lightness at a fixed hue. */
import {hexRgb, rgbHex} from "../../client/js/scenes/ps/colour";

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

export function hexToOklch(hex: string): [number, number, number] {
	const [r, g, b] = hexRgb(hex).map((v) => toLinear(v / 255));
	const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
	const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
	const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
	const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
	const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
	const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
	return [L, Math.hypot(A, B), Math.atan2(B, A)];
}

/** The colour at OKLCH (L, C, h radians), or null when it falls outside sRGB. */
export function oklchToHex(L: number, C: number, h: number): string | null {
	const A = C * Math.cos(h);
	const B = C * Math.sin(h);
	const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
	const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
	const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
	const rgb = [
		4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
		-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
		-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
	];

	if (rgb.some((c) => c < -1e-4 || c > 1 + 1e-4)) {
		return null;
	}

	return rgbHex(
		...(rgb.map((c) => toGamma(Math.min(1, Math.max(0, c))) * 255) as [number, number, number])
	);
}
