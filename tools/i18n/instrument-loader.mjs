// Development-only webpack loader: the dynamic-LABEL instrument.
//
// Renames every t()/tCount() call whose key argument is NOT a string
// literal to the runtime's dynamic-path globals (__tDyn/__tDynC, defined
// in client/js/i18n/core.ts under DEV). The warning thereby belongs to the
// CALL SITE — how the label was built — not to what the string happens to
// render as: an assembled key warns even when it resolves, in any
// language. Static literal calls are left byte-identical.
//
//   const a = t("lobby.connected");   // static  — untouched
//   const b = t("lobby." + which);    // dynamic — becomes __tDyn("lobby." + which)
//   const c = t(whichLabel);          // dynamic — becomes __tDyn(whichLabel)
//
// Skipped (not skipped-as-in-excused — out of the instrument's scope):
// client/js/i18n/** (the implementation itself: core defines t/tCount and
// the wrappers receive keys as parameters by design) and
// client/js/branding.ts (the override-aware wrapper, same reason). The
// service worker's fallback resolver is plain JS outside webpack. Template
// expressions in .vue files that call t() with a non-literal are renamed
// too — __tDyn is a global, but Vue compiles unknown template identifiers
// to _ctx.*, so such a template call fails loudly in a dev build rather
// than silently; write the call in the script block instead.
//
// Applied only when the build is a development one (webpack.config.ts
// guards the rule), so production never transforms and never carries the
// globals.
const TOKEN = /(?<![\w$.])(?<!function\s)\bt(?:Count)?\(/g;
const EXCLUDED = /js[\\/]i18n([\\/]|$)|js[\\/]branding\.ts$/;

/** String/comment spans to skip, so a "t(" inside a literal or a comment
 * is never rewritten (a missed rewrite inside a template literal's
 * interpolation is accepted; a wrong rewrite is not). */
function maskedSpans(source) {
	const spans = [];
	let i = 0;

	while (i < source.length) {
		const ch = source[i];

		if (ch === "/" && source[i + 1] === "/") {
			const end = source.indexOf("\n", i);
			spans.push([i, end === -1 ? source.length : end]);
			i = end === -1 ? source.length : end;
			continue;
		}

		if (ch === "/" && source[i + 1] === "*") {
			const end = source.indexOf("*/", i + 2);
			const stop = end === -1 ? source.length : end + 2;
			spans.push([i, stop]);
			i = stop;
			continue;
		}

		if (ch === '"' || ch === "'" || ch === "`") {
			const quote = ch;
			let j = i + 1;

			while (j < source.length) {
				if (source[j] === "\\") {
					j += 2;
					continue;
				}

				if (source[j] === quote) {
					j++;
					break;
				}

				j++;
			}

			spans.push([i, j]);
			i = j;
			continue;
		}

		i++;
	}

	return spans;
}

function masked(spans, index) {
	return spans.some(([start, end]) => index >= start && index < end);
}

/** True when the call's first argument is ONE whole string literal —
 * `t("key")` and `t("key", vars)` are static; `t("a" + b)`,
 * `t(`a${b}`)`, `t(foo)` are assembled (a leading quote alone is not
 * enough: "a" + b starts with one). */
function firstArgumentIsStringLiteral(source, openParenEnd) {
	let i = nextSignificant(source, openParenEnd);

	if (source[i] !== '"') {
		return false;
	}

	i++;

	while (i < source.length) {
		if (source[i] === "\\") {
			i += 2;
			continue;
		}

		if (source[i] === '"') {
			i++;
			break;
		}

		i++;
	}

	const after = nextSignificant(source, i);
	return source[after] === "," || source[after] === ")";
}

/** Index of the first non-whitespace character at or after `from`. */
function nextSignificant(source, from) {
	let i = from;

	while (i < source.length && /\s/.test(source[i])) {
		i++;
	}

	return i;
}

export default function instrument(source) {
	// eslint-disable-next-line no-underscore-dangle
	const file = this.resourcePath ?? "";

	if (EXCLUDED.test(file.replace(/\\/g, "/"))) {
		return source;
	}

	const spans = maskedSpans(source);
	let out = "";
	let last = 0;

	for (const match of source.matchAll(TOKEN)) {
		if (masked(spans, match.index)) {
			continue;
		}

		if (firstArgumentIsStringLiteral(source, match.index + match[0].length)) {
			continue; // static literal call site — byte-identical output
		}

		out += source.slice(last, match.index);
		out += match[0].includes("Count") ? "__tDynC(" : "__tDyn(";
		last = match.index + match[0].length;
	}

	if (last === 0) {
		return source;
	}

	out += source.slice(last);
	return out;
}
