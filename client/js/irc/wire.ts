/**
 * Outbound line helpers on top of `formatLine`.
 */

import {formatLine} from "./message";

/**
 * Serialise `command` with `params`, always writing the last parameter as a
 * trailing (`:`-prefixed) one. `formatLine` only adds the colon when the
 * text needs it; for free-text parameters (realname, reasons, message
 * bodies) the explicit form is what every other client sends and what
 * humans reading a transcript expect.
 */
export function trailingLine(command: string, params: string[]): string {
	if (params.length === 0) {
		return formatLine({command, params});
	}

	const last = params[params.length - 1];

	if (/[\r\n\0]/.test(last)) {
		throw new Error("Trailing parameter contains CR, LF or NUL");
	}

	return `${formatLine({command, params: params.slice(0, -1)})} :${last}`;
}
