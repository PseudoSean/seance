#!/usr/bin/env node
// Ask a headless Chromium for its own verdict on a Seance deploy as a PWA.
//
//   node tools/pwa-check.mjs http://localhost:8000/ [--chrome=/path/to/chromium] [--wait=6000]
//
// Dependency-free: drives the browser over the DevTools protocol with Node's
// global fetch/WebSocket. Prints the parsed manifest errors, Chrome's
// installability errors (Page.getInstallabilityErrors — the same list the
// DevTools "Application > Manifest" pane shows), the service-worker state and
// any console errors, then exits non-zero if anything is wrong.
//
// Note that Chromium rejects service workers on https origins with an
// untrusted certificate, so point this at a plain-http localhost server
// (`python3 -m http.server -d public 8000`) or a host with a real cert.

import {spawn} from "node:child_process";
import {mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";

const args = process.argv.slice(2);
const url = args.find((a) => !a.startsWith("--"));
const opt = (name, fallback) => {
	const hit = args.find((a) => a.startsWith(`--${name}=`));
	return hit ? hit.slice(name.length + 3) : fallback;
};

if (!url) {
	console.error("usage: node tools/pwa-check.mjs <url> [--chrome=bin] [--wait=ms]");
	process.exit(2);
}

const chromeBin = opt("chrome", process.env.CHROME_BIN || "chromium");
const waitMs = Number(opt("wait", "6000"));
const port = 9222 + Math.floor(Math.random() * 1000);
const profile = mkdtempSync(join(tmpdir(), "seance-pwa-check-"));

const chrome = spawn(
	chromeBin,
	[
		"--headless=new",
		"--disable-gpu",
		"--no-first-run",
		"--no-default-browser-check",
		`--remote-debugging-port=${port}`,
		`--user-data-dir=${profile}`,
		"about:blank",
	],
	{stdio: "ignore"}
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForDevtools() {
	for (let i = 0; i < 50; i++) {
		try {
			const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
			const page = targets.find((t) => t.type === "page");

			if (page) {
				return page.webSocketDebuggerUrl;
			}
		} catch (e) {
			// not up yet
		}

		await sleep(200);
	}

	throw new Error(`Chromium (${chromeBin}) did not open a DevTools port`);
}

let failed = false;

try {
	const ws = new WebSocket(await waitForDevtools());
	let nextId = 0;
	const pending = new Map();
	const consoleErrors = [];

	const send = (method, params = {}) =>
		new Promise((resolve, reject) => {
			const id = ++nextId;
			pending.set(id, {resolve, reject});
			ws.send(JSON.stringify({id, method, params}));
		});

	ws.onmessage = (event) => {
		const msg = JSON.parse(event.data);

		if (msg.id && pending.has(msg.id)) {
			const {resolve, reject} = pending.get(msg.id);
			pending.delete(msg.id);
			msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
		} else if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
			consoleErrors.push(
				msg.params.args.map((a) => a.value ?? a.description ?? "").join(" ")
			);
		} else if (msg.method === "Runtime.exceptionThrown") {
			const d = msg.params.exceptionDetails;
			consoleErrors.push(d.exception?.description ?? d.text);
		}
	};

	await new Promise((resolve, reject) => {
		ws.onopen = resolve;
		ws.onerror = reject;
	});

	await send("Page.enable");
	await send("Runtime.enable");
	await send("Page.navigate", {url});
	await sleep(waitMs);

	const manifest = await send("Page.getAppManifest");
	console.log(`manifest: ${manifest.url || "(none)"}`);

	if (!manifest.url || !manifest.data) {
		console.log("  no manifest linked from the page");
		failed = true;
	}

	for (const err of manifest.errors ?? []) {
		console.log(`  ${err.critical ? "error" : "warning"}: ${err.message} (line ${err.line})`);
		failed = failed || err.critical;
	}

	if (manifest.data) {
		const parsed = JSON.parse(manifest.data);
		console.log(
			`  name=${JSON.stringify(parsed.name)} start_url=${parsed.start_url} scope=${
				parsed.scope
			} display=${parsed.display} icons=${(parsed.icons ?? []).length} protocol_handlers=${
				(parsed.protocol_handlers ?? []).map((p) => p.protocol).join(",") || "none"
			} launch_handler=${parsed.launch_handler?.client_mode ?? "default"}`
		);
	}

	const inst = await send("Page.getInstallabilityErrors");
	const errors = inst.installabilityErrors ?? [];
	console.log(`installability: ${errors.length === 0 ? "OK (installable)" : "NOT installable"}`);

	for (const err of errors) {
		const detail = (err.errorArguments ?? []).map((a) => `${a.name}=${a.value}`).join(" ");
		console.log(`  ${err.errorId}${detail ? ` ${detail}` : ""}`);
	}

	failed = failed || errors.length > 0;

	const sw = await send("Runtime.evaluate", {
		expression: `("serviceWorker" in navigator)
			? navigator.serviceWorker.getRegistration().then((r) =>
				r ? {scope: r.scope, state: (r.active || r.waiting || r.installing || {}).state || "none"} : null)
			: Promise.resolve("unsupported")`,
		awaitPromise: true,
		returnByValue: true,
	});
	const reg = sw.result.value;
	console.log(
		`service worker: ${
			reg === "unsupported"
				? "unsupported"
				: reg
				? `${reg.state} (scope ${reg.scope})`
				: "not registered"
		}`
	);

	if (reg !== "unsupported" && (!reg || reg.state !== "activated")) {
		failed = true;
	}

	console.log(`console errors: ${consoleErrors.length}`);

	for (const line of consoleErrors) {
		console.log(`  ${line}`);
	}

	failed = failed || consoleErrors.length > 0;
	ws.close();
} catch (e) {
	console.error(e.message);
	failed = true;
} finally {
	// Let Chromium and its helper processes exit before removing the profile;
	// a leftover temp dir is not worth failing the check over.
	const exited = new Promise((resolve) => chrome.once("exit", resolve));
	chrome.kill();
	await Promise.race([exited, sleep(5000)]);

	for (let attempt = 0; attempt < 10; attempt++) {
		try {
			rmSync(profile, {recursive: true, force: true});
			break;
		} catch (e) {
			if (attempt === 9) {
				console.warn(`could not remove ${profile}: ${e.message}`);
			}

			await sleep(300);
		}
	}
}

process.exit(failed ? 1 : 0);
