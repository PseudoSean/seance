/* eslint-disable no-console */
// npx tsx tools/i18n/check.ts
//
// Cross-checks client/locales/messages.pot against the live tree: every
// t()/tCount() call-site key must exist in the pot, every pot key must be
// referenced somewhere, and every pot entry must carry at least one `#.`
// context line for translators and MT. Exits 1 listing every miss.
//
// The scan is a heuristic (a regex over comments-stripped source), which is
// why call sites are written `t("key")` — double quotes, no concatenation.
// Fixture coverage and the live-tree assertion (the real client/ tree and
// messages.pot) live in test/tests/i18n-toolchain.ts.

import {readFileSync, readdirSync} from "node:fs";
import {join, relative, resolve} from "node:path";
import {POT_PATH} from "./paths";
import {parsePo} from "./po";

export interface PotProblems {
	/** Referenced by a call site but missing from the pot. */
	missing: string[];
	/** In the pot but never referenced, excepting ALLOWED_UNREFERENCED. */
	unreferenced: string[];
	/** Pot entries without a single `#.` context line. */
	missingContext: string[];
}

/**
 * Keys the call-site scan can never see. The loading splash's only
 * referents are the static copy in client/index.html (the scanner reads
 * just .ts/.vue) and the splash id/key table in client/js/i18n/index.ts —
 * a data table, not t() call sites. The live-tree assertion in
 * test/tests/i18n-toolchain.ts pins every key here to that table, so a
 * splash key that leaves it cannot linger on the allowlist.
 */
export const ALLOWED_UNREFERENCED = new Set([
	"loading.reload",
	"loading.requiresJs",
	"loading.slow",
]);

/** t("key") / tCount("key", …) — the only way a key becomes a call site. */
const CALL_SITE = /\bt(?:Count)?\(\s*"([^"]+)"/g;

/** Directories the implementation itself lives in — never call sites. */
const I18N_DIR = /(^|[\\/])js[\\/]i18n([\\/]|$)/;

/** Strip comments, so a commented-out call site is not "referenced". */
function stripComments(source: string): string {
	return (
		source
			.replace(/\/\*[\s\S]*?\*\//g, " ")
			.replace(/<!--[\s\S]*?-->/g, " ")
			// Whole-line // comments, including runs of them.
			.replace(/^[ \t]*\/\/[^\n]*(?:\n[ \t]*\/\/[^\n]*)*/gm, "")
			// Trailing // comments — unless the // is inside a string or a URL,
			// i.e. it does not follow a colon, quote, word character or slash.
			.replace(/(?<=[^:)"'\w\n/])\/\/[^\n]*/g, " ")
	);
}

function collectCallSites(dir: string, root: string, into: Set<string>): void {
	for (const item of readdirSync(dir, {withFileTypes: true})) {
		const path = join(dir, item.name);

		if (item.isDirectory()) {
			collectCallSites(path, root, into);
			continue;
		}

		if (!/\.(?:ts|vue)$/.test(item.name) || I18N_DIR.test(relative(root, path))) {
			continue;
		}

		const source = stripComments(readFileSync(path, "utf8"));

		for (const match of source.matchAll(CALL_SITE)) {
			into.add(match[1]);
		}
	}
}

export function checkPot(potPath: string, scanRoots: string[]): PotProblems {
	const referenced = new Set<string>();

	for (const root of scanRoots) {
		collectCallSites(resolve(root), resolve(root), referenced);
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
	};
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

	if (failed) {
		process.exitCode = 1;
		return;
	}

	console.log("check: the pot and the call sites agree");
}

if (require.main === module) {
	main();
}
