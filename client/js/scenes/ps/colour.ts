/**
 * #rrggbb arithmetic for the ps theme: the mockup's sRGB mixing, and WCAG
 * luminance and contrast for the legibility floors (docs/projects/ps-theme.md §11).
 * Pure; mocha loads it.
 */

export function hexRgb(hex: string): [number, number, number] {
	return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

const byte = (v: number) =>
	Math.max(0, Math.min(255, Math.round(v)))
		.toString(16)
		.padStart(2, "0");

export function rgbHex(r: number, g: number, b: number): string {
	return `#${byte(r)}${byte(g)}${byte(b)}`;
}

/** `b` mixed into `a` by `u` (0 is `a`, 1 is `b`), channel by channel in sRGB. */
export function mix(a: string, b: string, u: number): string {
	const [x, y] = [hexRgb(a), hexRgb(b)];
	return rgbHex(...(x.map((v, i) => v + (y[i] - v) * u) as [number, number, number]));
}

/** Move `c` by `to − from`, scaled by `amount`: the season's offset from midsummer, applied at any hour. */
export function shift(c: string, from: string, to: string, amount: number): string {
	const [a, f, t] = [hexRgb(c), hexRgb(from), hexRgb(to)];
	return rgbHex(...(a.map((v, i) => v + (t[i] - f[i]) * amount) as [number, number, number]));
}

/** WCAG relative luminance. */
export function luminance(hex: string): number {
	const [r, g, b] = hexRgb(hex).map((v) => {
		const c = v / 255;
		return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return (hi + 0.05) / (lo + 0.05);
}
