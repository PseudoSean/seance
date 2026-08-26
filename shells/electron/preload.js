"use strict";

// Runs in the sandboxed renderer. Exposes a tiny, read-only descriptor so the
// SPA can tell it is inside the desktop shell; nothing else crosses the bridge.

const {contextBridge} = require("electron");

const versionArg = process.argv.find((arg) => arg.startsWith("--seance-shell-version="));

contextBridge.exposeInMainWorld("seanceShell", {
	platform: process.platform,
	version: versionArg ? versionArg.slice("--seance-shell-version=".length) : "",
});
