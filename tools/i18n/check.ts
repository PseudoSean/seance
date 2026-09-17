/* eslint-disable no-console */
// npx tsx tools/i18n/check.ts
//
// Cross-checks client/locales/messages.pot against the live tree: every
// t()/tCount()/brandingT() call-site key must exist in the pot, every pot
// key must be referenced somewhere, and every pot entry must carry at least
// one `#.` context line for translators and MT. It also flags ASSEMBLED
// call sites — a t() whose key is not a plain double-quoted literal, or a
// translated fragment glued to another string with `+`: a key that is built
// at runtime cannot carry a `#.` context, cannot be in a translator's table,
// and concatenating translated phrases produces sentences no catalog
// predicted. Exits 1 listing every miss.
//
// The scan is a heuristic (a regex over comments-stripped source), which is
// why call sites are written `t("key")` or `t('key')` — a single string
// literal, no concatenation.
// Fixture coverage and the live-tree assertion (the real client/ tree and
// messages.pot) live in test/tests/i18n-toolchain.ts.

import {readFileSync, readdirSync} from "node:fs";
import {join, relative, resolve} from "node:path";
import {POT_PATH} from "./paths";
import {parsePo} from "./po";

/** An assembled call site: the runtime builds what should have been a
 * static key (or glues translated fragments into a sentence). */
export interface DynamicSite {
	/** Path relative to the scanned root, /-separated. */
	file: string;
	line: number;
	/** `key`: the first argument is not a double-quoted literal;
	 * `combined`: a t() call concatenated with another string. */
	kind: "key" | "combined";
	/** The offending line, comment-stripped, trimmed. */
	code: string;
}

export interface PotProblems {
	/** Referenced by a call site but missing from the pot. */
	missing: string[];
	/** In the pot but never referenced, excepting ALLOWED_UNREFERENCED. */
	unreferenced: string[];
	/** Pot entries without a single `#.` context line. */
	missingContext: string[];
	/** Assembled call sites that survived the allowlist. */
	dynamic: DynamicSite[];
	/** Assembled sites per allowlisted file (raw counts, before filtering) —
	 * a listed file with zero hits is a stale entry. */
	dynamicHits: Record<string, number>;
}

/**
 * Keys the call-site scan can never see. The loading splash's only
 * referents are the static copy in client/index.html and the pre-bundle
 * loading-error-handlers.js — plain .js outside the .ts/.vue scan (the
 * live-tree assertion in test/tests/i18n-toolchain.ts pins every key here
 * to the file that resolves it, so a key that leaves its resolver cannot
 * linger on the allowlist).
 *
 * The dates.* labels are the second kind: formatRelativeDay() resolves them
 * inside client/js/i18n/dates.ts, which the scan skips wholesale (date
 * patterns are Intl's business, not the catalog's), and their UI owner is
 * DateMarker.vue, which hands its t() over instead of naming keys. The same
 * live-tree assertion pins them to dates.ts's source text.
 */
export const ALLOWED_UNREFERENCED = new Set([
	"dates.today",
	"dates.yesterday",
	"loading.reload",
	"loading.requiresJs",
	"loading.slow",
	"loading.starting",
	"loading.error",
	"loading.errorDetails",
	"loading.errorDevtools",
]);

/**
 * Files whose assembled call sites are known and justified — the tracking
 * ledger for the runtime warnings' build-time half. Every entry carries its
 * reason here, and main() fails when a listed file no longer produces a
 * site, so the entry cannot outlive the code it excuses. The ledger starts
 * empty: fix the site (a whole-phrase key with {vars}) instead of listing it.
 */
export const ALLOWED_DYNAMIC = new Set<string>([]);

/** t("key") / t('key') / tCount("key", …) / brandingT("key") — the only way
 * a key becomes a call site. Single and double quotes are both accepted (a
 * key inside an HTML attribute is often single-quoted); the key is group 2,
 * group 1 is the quote character the backreference matches against. The
 * service worker's own t() (client/service-worker.js, which prefers the
 * push module's catalog) is written in the same shape on purpose, so this
 * one regex covers it too once its file is scanned (SERVICE_WORKER_FILE). */
const CALL_SITE = /\b(?:brandingT|t)(?:Count)?\(\s*(["'])([^"']+)\1/g;

/** A t()/brandingT() call to classify: not a property access (`.t(` is some
 * object's method) and not a definition (`function t(`). */
const CALL_TOKEN = /(?<![\w$.])(?<!function\s)(?:brandingT|t)(?:Count)?\(/g;

/** A translated fragment glued into a longer string: any `+ t(` or `t(…) +`. */
const COMBINED = /(?:\+\s*(?<![\w$.])t(?:Count)?\()|((?<![\w$.])t(?:Count)?\([^)]*\)\s*\+)/;

/** The service worker composes reader-visible copy (notification actions,
 * title fragments, the fallback body) through the same resolver shape, but
 * it is plain .js outside the .ts/.vue scan — collected explicitly per
 * scan root, so fixture trees without one are unaffected. */
const SERVICE_WORKER_FILE = "service-worker.js";

/** Directories the implementation itself lives in — never call sites. */
const I18N_DIR = /(^|[\\/])js[\\/]i18n([\\/]|$)/;

/** Strip comments, so a commented-out call site is not "referenced".
 * Block comments are blanked out newline-preserving, so line numbers of the
 * lines that remain stay true — the dynamic-site report names lines. */
function stripComments(source: string): string {
	return (
		source
			.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
			.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, " "))
			// Whole-line // comments, including runs of them.
			.replace(/^[ \t]*\/\/[^\n]*(?:\n[ \t]*\/\/[^\n]*)*/gm, "")
			// Trailing // comments — unless the // is inside a string or a URL,
			// i.e. it does not follow a colon, quote, word character or slash.
			.replace(/(?<=[^:)"'\w\n/])\/\/[^\n]*/g, " ")
	);
}

function collectCallSites(
	dir: string,
	root: string,
	into: Set<string>,
	dynamic: DynamicSite[]
): void {
	for (const item of readdirSync(dir, {withFileTypes: true})) {
		const path = join(dir, item.name);

		if (item.isDirectory()) {
			collectCallSites(path, root, into, dynamic);
			continue;
		}

		const isCallSiteFile = /\.(?:ts|vue)$/.test(item.name) || item.name === SERVICE_WORKER_FILE;

		if (!isCallSiteFile || I18N_DIR.test(relative(root, path))) {
			continue;
		}

		const source = stripComments(readFileSync(path, "utf8"));
		const rel = relative(root, path).split("\\").join("/");
		const lines = source.split("\n");

		for (const [index, line] of lines.entries()) {
			for (const match of line.matchAll(CALL_SITE)) {
				into.add(match[2]);
			}

			// Assembled sites: a non-literal key (the runtime composes what
			// should be a pot entry), a literal key glued to more code
			// ("prefix." + var), and a translated fragment concatenated into
			// a longer string. All are line-flagged with code, not
			// auto-fixed — the ledger in ALLOWED_DYNAMIC decides what is
			// known and justified. One hit per line is enough.
			let flagged = false;

			const flag = (kind: DynamicSite["kind"]) => {
				if (!flagged) {
					flagged = true;
					dynamic.push({file: rel, line: index + 1, kind, code: line.trim()});
				}
			};

			for (const match of line.matchAll(CALL_TOKEN)) {
				const rest = line.slice(match.index! + match[0].length);
				const literal = /^\s*"([^"]*)"/.exec(rest);

				if (!literal) {
					flag("key");
					break;
				}

				if (/^\s*\+/.test(rest.slice(literal[0].length))) {
					flag("combined"); // t("prefix." + …) — a key under assembly
					break;
				}
			}

			if (!flagged && COMBINED.test(line)) {
				flag("combined");
			}
		}
	}
}

export function checkPot(
	potPath: string,
	scanRoots: string[],
	options: {allowedDynamic?: ReadonlySet<string>} = {}
): PotProblems {
	const referenced = new Set<string>();
	const dynamic: DynamicSite[] = [];

	for (const root of scanRoots) {
		collectCallSites(resolve(root), resolve(root), referenced, dynamic);
	}

	const allowed = options.allowedDynamic ?? ALLOWED_DYNAMIC;
	const dynamicHits: Record<string, number> = {};

	for (const site of dynamic) {
		dynamicHits[site.file] = (dynamicHits[site.file] ?? 0) + 1;
	}

	const {entries} = parsePo(readFileSync(potPath, "utf8"));
	const potKeys = entries.filter((entry) => entry.msgctxt !== "").map((entry) => entry.msgctxt);

	return {
		missing: [...referenced].filter((key) => !potKeys.includes(key)).sort(),
		unreferenced: potKeys
			.filter((key) => !referenced.has(key) && !ALLOWED_UNREFERENCED.has(key))
			.sort(),
		missingContext: entries
			.filter((entry) => entry.msgctxt !== "" && entry.context.length === 0)
			.map((entry) => entry.msgctxt)
			.sort(),
		dynamic: dynamic.filter((site) => !allowed.has(site.file)),
		dynamicHits,
	};
}

/**
 * Every key that appears as a literal at a call site anywhere in the tree —
 * the i18n implementation included (dates.ts resolves dates.* through the
 * caller's t) and the service worker. This is the runtime's ground truth
 * for the dynamic-key warning (core.ts): a key OUTSIDE this set was
 * assembled at runtime, and composed keys translate unpredictably even
 * when they happen to resolve. Over-inclusion is safe (fewer false
 * "dynamic" warnings); under-inclusion needs a compile re-run
 * (client/js/i18n/call-sites.ts, generated by tools/i18n/compile.ts).
 */
export function collectStaticCallSiteKeys(root: string): Set<string> {
	const keys = new Set<string>();

	const walk = (dir: string): void => {
		for (const item of readdirSync(dir, {withFileTypes: true})) {
			const path = join(dir, item.name);

			if (item.isDirectory()) {
				walk(path);
				continue;
			}

			if (!/\.(?:ts|vue)$/.test(item.name) && item.name !== SERVICE_WORKER_FILE) {
				continue;
			}

			const source = stripComments(readFileSync(path, "utf8"));

			for (const match of source.matchAll(CALL_SITE)) {
				keys.add(match[2]);
			}
		}
	};

	walk(resolve(root));
	return keys;
}

function list(title: string, keys: string[]): void {
	console.error(title);

	for (const key of keys) {
		console.error(`  ${key}`);
	}
}

function main(): void {
	const problems = checkPot(POT_PATH, [resolve("client")]);
	let failed = false;

	if (problems.missing.length > 0) {
		failed = true;
		list("check: referenced by a call site but missing from the pot:", problems.missing);
	}

	if (problems.unreferenced.length > 0) {
		failed = true;
		list("check: in the pot but never referenced:", problems.unreferenced);
	}

	if (problems.missingContext.length > 0) {
		failed = true;
		list("check: pot entry without a #. context line:", problems.missingContext);
	}

	if (problems.dynamic.length > 0) {
		failed = true;
		console.error(
			"check: assembled call sites (a key the runtime builds, or glued fragments):"
		);

		for (const site of problems.dynamic) {
			console.error(`  ${site.file}:${site.line} [${site.kind}] ${site.code}`);
		}
	}

	// The ledger must stay warm: a listed file that no longer produces an
	// assembled site means the site was fixed — remove the entry (or the
	// excuse rots while the pattern sneaks back in elsewhere).
	for (const file of ALLOWED_DYNAMIC) {
		if (!problems.dynamicHits[file]) {
			failed = true;
			console.error(`check: stale assembled-site ledger entry (no site left in): ${file}`);
		}
	}

	if (failed) {
		process.exitCode = 1;
		return;
	}

	console.log("check: the pot and the call sites agree");
}

if (require.main === module) {
	main();
}
