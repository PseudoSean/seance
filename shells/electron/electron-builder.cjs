"use strict";

// Passed to electron-builder with `-c electron-builder.cjs` (a "build" key in
// package.json otherwise takes precedence over any config file). It reuses
// that key verbatim and only derives productName and the Linux executable
// name from the deploy's branding, so a rebranded public/config.json names
// the binaries.

const fs = require("fs");
const path = require("path");

const base = require("./package.json").build;

function appNameFromConfig() {
	try {
		const file = path.resolve(__dirname, "../../public/config.json");
		const parsed = JSON.parse(fs.readFileSync(file, "utf8"));

		if (typeof parsed.appName === "string" && parsed.appName.trim()) {
			return parsed.appName.trim();
		}
	} catch (e) {
		// Fall back to the static productName below.
	}

	return null;
}

const productName = appNameFromConfig() || base.productName;
const executableName =
	productName
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "") || "seance";

module.exports = {
	...base,
	productName,
	linux: {...base.linux, executableName},
};
