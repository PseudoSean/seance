/**
 * IRC case folding for nick/channel comparison (ISUPPORT `CASEMAPPING`).
 *
 * Only ASCII is folded: IRC casemapping never touches non-ASCII characters,
 * so `String.prototype.toLowerCase` (which does) is deliberately not used.
 */

export type CaseMapping = "rfc1459" | "rfc1459-strict" | "ascii";

/** Map an ISUPPORT `CASEMAPPING` value to a {@link CaseMapping}, or undefined if unknown. */
export function parseCaseMapping(value: string): CaseMapping | undefined {
	switch (value.toLowerCase()) {
		case "rfc1459":
			return "rfc1459";
		case "rfc1459-strict":
			return "rfc1459-strict";
		case "ascii":
			return "ascii";
		default:
			return undefined;
	}
}

/** Fold `s` to its canonical lowercase form under `mapping`. */
export function casefold(s: string, mapping: CaseMapping = "rfc1459"): string {
	let out = "";

	for (let i = 0; i < s.length; i++) {
		const code = s.charCodeAt(i);

		if (code >= 0x41 && code <= 0x5a) {
			// A-Z
			out += String.fromCharCode(code + 0x20);
		} else if (mapping !== "ascii" && code >= 0x5b && code <= 0x5d) {
			// [ \ ] -> { | }
			out += String.fromCharCode(code + 0x20);
		} else if (mapping === "rfc1459" && code === 0x7e) {
			// ~ -> ^
			out += "^";
		} else {
			out += s[i];
		}
	}

	return out;
}

/** True if `a` and `b` name the same nick/channel under `mapping`. */
export function namesEqual(a: string, b: string, mapping: CaseMapping = "rfc1459"): boolean {
	return a.length === b.length && casefold(a, mapping) === casefold(b, mapping);
}
