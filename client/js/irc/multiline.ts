/**
 * `draft/multiline` (https://ircv3.net/specs/extensions/multiline).
 *
 * A multi-line message travels as a `BATCH … draft/multiline <target>` whose
 * lines are ordinary `PRIVMSG`/`NOTICE`s: they are joined with `\n`, except
 * where a line carries {@link CONCAT_TAG}, which glues it to the previous one
 * with no separator (that is how a paragraph longer than the line budget is
 * split). One batch is one message: one msgid, one timeline entry.
 *
 * This module is store- and DOM-free (it runs under mocha).
 */

/** The capability name, whose CAP 302 value carries the limits. */
export const MULTILINE_CAP = "draft/multiline";
/** Tag on a line that continues the previous one without a line feed. */
export const CONCAT_TAG = "draft/multiline-concat";

/** What one batch may carry, from the cap's 302 value. */
export type MultilineLimits = {
	/** Maximum total byte length of the joined message. */
	maxBytes: number;
	/** Maximum number of `PRIVMSG`/`NOTICE` lines in one batch. */
	maxLines: number;
};

/** A positive integer token value, or undefined for anything else. */
function positiveInt(value: string | undefined): number | undefined {
	if (value === undefined || !/^\d+$/.test(value)) {
		return undefined;
	}

	const n = Number(value);
	return n > 0 ? n : undefined;
}

/**
 * `"max-bytes=16384,max-lines=100"` → the limits. The spec requires the
 * value, so anything without both usable numbers means the server cannot
 * tell us what it accepts and the cap is treated as absent (unknown tokens
 * are ignored, as future ones must be).
 */
export function parseMultilineValue(value: string | undefined): MultilineLimits | undefined {
	if (!value) {
		return undefined;
	}

	const tokens = new Map<string, string>();

	for (const token of value.split(",")) {
		const eq = token.indexOf("=");

		if (eq !== -1) {
			tokens.set(token.slice(0, eq), token.slice(eq + 1));
		}
	}

	const maxBytes = positiveInt(tokens.get("max-bytes"));
	const maxLines = positiveInt(tokens.get("max-lines"));

	if (maxBytes === undefined || maxLines === undefined) {
		return undefined;
	}

	return {maxBytes, maxLines};
}
