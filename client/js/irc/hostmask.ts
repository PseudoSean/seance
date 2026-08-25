/**
 * `nick!ident@host` parsing and wildcard matching. Ported from
 * attic/server/helper.ts (`parseHostmask`, `compareHostmask`,
 * `compareWithWildcard`); used by the ignore list.
 */

export interface Hostmask {
	nick: string;
	ident: string;
	hostname: string;
}

/**
 * `nick[!ident][@host]` → lower-cased parts; missing parts become `*`.
 * The host is split off first so an `!` inside it does not confuse things.
 */
export function parseHostmask(hostmask: string): Hostmask {
	let rest = hostmask;
	let ident = "*";
	let hostname = "*";

	const at = rest.indexOf("@");

	if (at !== -1) {
		hostname = rest.slice(at + 1) || "*";
		rest = rest.slice(0, at);
	}

	const bang = rest.indexOf("!");

	if (bang !== -1) {
		ident = rest.slice(bang + 1) || "*";
		rest = rest.slice(0, bang);
	}

	return {
		nick: rest.toLowerCase() || "*",
		ident: ident.toLowerCase(),
		hostname: hostname.toLowerCase(),
	};
}

export function formatHostmask(mask: Hostmask): string {
	return `${mask.nick}!${mask.ident}@${mask.hostname}`;
}

/** Whether the pattern `a` (with `*`/`?` wildcards) matches the concrete `b`. */
export function compareHostmask(a: Hostmask, b: Hostmask): boolean {
	return (
		compareWithWildcard(a.nick, b.nick) &&
		compareWithWildcard(a.ident, b.ident) &&
		compareWithWildcard(a.hostname, b.hostname)
	);
}

function escapeRegExp(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Case-insensitive match of `subject` against `pattern`, where `*` matches
 * any run of characters and `?` exactly one. Mostly aligned with
 * https://modern.ircdocs.horse/#wildcard-expressions minus escaping: `\` is
 * valid in a nick, while the wildcards are not (RFC 1459).
 */
export function compareWithWildcard(pattern: string, subject: string): boolean {
	const source = pattern
		.split("*")
		.map((part) => part.split("?").map(escapeRegExp).join("."))
		.join(".*");

	return new RegExp(`^${source}$`, "i").test(subject);
}
