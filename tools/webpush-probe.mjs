#!/usr/bin/env node
/* eslint-disable no-console */
// WEBPUSH (draft/webpush) round-trip probe — phase 1 acceptance from the
// client side of the wire (docs/projects/push-subscription.md).
//
//   node tools/webpush-probe.mjs ws://host:port/ [--account name --password pw]
//        [--endpoint https://…] [--insecure] [--stay]
//
// Logs in via SASL PLAIN when --account is given, negotiates draft/webpush,
// then sends REGISTER (expecting the `WEBPUSH REGISTER <endpoint>` echo),
// REGISTER with bad keys (expecting FAIL WEBPUSH INVALID_PARAMS), and
// UNREGISTER (expecting the echo). Prints every line; exit code 0 iff all
// three behaved. Without --account it only checks that the server refuses
// WEBPUSH with FAIL WEBPUSH ACCOUNT_REQUIRED.

import {createRequire} from "node:module";

const argv = process.argv.slice(2);
const positional = argv.filter((a) => !a.startsWith("--"));
const flagValue = (name) => {
	const i = argv.indexOf(name);

	return i !== -1 ? argv[i + 1] : undefined;
};
const url = positional[0];
const account = flagValue("--account");
const password = flagValue("--password") ?? "";
const endpoint = flagValue("--endpoint") ?? "https://push.example.com/send/seance-probe-1";
const nick = account ? `pushprobe${Math.floor(100 + Math.random() * 900)}` : "pushprobe";

if (!url) {
	console.error(
		"usage: node tools/webpush-probe.mjs ws://host:port/ [--account name --password pw] [--endpoint https://…] [--insecure]"
	);
	process.exit(1);
}

// Shape-real subscription material: 87-char p256dh (65-byte uncompressed
// P-256 point) + 22-char auth (16 bytes), URL-safe base64 — what
// PushSubscription.toJSON() hands out.
const P256DH =
	"BNbxR4Jd7rN9P6bVzUJKlOZYFfM2bGhF7vW9hB0cQKJ3qXGfL6mYvXrP8nSdWqT4A1cUeZiO5tRlKyHsMwNvXu8A";
const AUTH = "dGhpc0lzQVRlc3RBdXRoQQ";

const expectations = {
	registerEcho: false,
	badKeysFail: false,
	unregisterEcho: false,
	accountRequiredFail: false,
};

function openSocket() {
	if (argv.includes("--insecure")) {
		process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
	}

	try {
		const WS = createRequire(import.meta.url)("ws");
		return new WS(url, ["text.ircv3.net"], {rejectUnauthorized: !argv.includes("--insecure")});
	} catch {
		return new WebSocket(url, ["text.ircv3.net"]);
	}
}

const ws = openSocket();
// The `ws` package uses .on(); Node's global WebSocket uses addEventListener().
const on = (ev, fn) => (typeof ws.on === "function" ? ws.on(ev, fn) : ws.addEventListener(ev, fn));
let saslStarted = false;
let registered = false;
let sawWebpushCap = false;
let vapid;

const b64 = (s) => Buffer.from(s, "utf8").toString("base64");
const send = (line) => {
	console.log(`>> ${line}`);
	ws.send(line);
};

on("open", () => {
	console.log(`-- open (${url})`);
	send("CAP LS 302");
	send(`NICK ${nick}`);
	send(`USER ${nick} 0 * :Seance webpush probe`);
});

on("message", (event) => {
	// `ws` hands the raw data; the browser MessageEvent wraps it in .data.
	const data = event && event.data !== undefined ? event.data : event;
	const line = data.toString();
	console.log(`<< ${line}`);

	if (/\bCAP .* LS\b/.test(line)) {
		const list = line.split(/CAP [^ ]+ LS \*? :?/)[1] ?? "";
		const names = list.trim().split(/\s+/);
		const webpush = names.find((n) => n.startsWith("draft/webpush"));

		if (webpush) {
			sawWebpushCap = true;
			vapid = webpush.split("vapid=")[1];
			send(account ? "CAP REQ :sasl draft/webpush" : "CAP REQ :draft/webpush");
		}
	} else if (/\bCAP .* ACK\b/.test(line)) {
		if (line.includes("sasl") && !saslStarted) {
			saslStarted = true;
			send("AUTHENTICATE PLAIN");
		} else if (line.includes("draft/webpush")) {
			send("CAP END");
		}
	} else if (/^AUTHENTICATE \+$/.test(line)) {
		send(`AUTHENTICATE ${b64(`\0${account}\0${password}`)}`);
	} else if (/ 903 /.test(line)) {
		send("CAP END");
	} else if (/( 90[1-9] )|FAIL SASL/.test(line)) {
		console.error("-- SASL failed; the rest of the probe cannot run");
		finish(1);
	} else if (/ 001 /.test(line)) {
		registered = true;

		if (!sawWebpushCap) {
			console.error("-- server never offered draft/webpush");
			finish(1);
			return;
		}

		console.log(
			`-- draft/webpush offered${
				vapid ? ` with VAPID key (${vapid.length} chars)` : " without a VAPID key"
			}`
		);

		if (!account) {
			// Not logged in: the server must refuse the registration.
			send(`WEBPUSH REGISTER ${endpoint} p256dh=${P256DH};auth=${AUTH}`);
		} else {
			send(`WEBPUSH REGISTER ${endpoint} p256dh=${P256DH};auth=${AUTH}`);
			send(`WEBPUSH REGISTER ${endpoint} p256dh=${P256DH}`);
			send(`WEBPUSH UNREGISTER ${endpoint}`);
		}
	} else if (line.startsWith("WEBPUSH REGISTER")) {
		expectations.registerEcho = line.includes(endpoint);
	} else if (line.startsWith("WEBPUSH UNREGISTER")) {
		expectations.unregisterEcho = line.includes(endpoint);
	} else if (/^FAIL WEBPUSH /.test(line)) {
		if (line.includes("ACCOUNT_REQUIRED")) {
			expectations.accountRequiredFail = true;
		}

		if (line.includes("INVALID_PARAMS") && line.includes("REGISTER")) {
			expectations.badKeysFail = true;
		}
	}
});

let done = false;

function finish(code) {
	if (done) {
		return;
	}

	done = true;

	if (registered) {
		try {
			send("QUIT :probe done");
		} catch {
			// socket may already be gone
		}

		setTimeout(() => process.exit(code), 300);
	} else {
		process.exit(code);
	}
}

on("close", (event) => {
	const code = event && event.code !== undefined ? event.code : event;
	console.log(`-- closed (${code})`);

	if (!done) {
		finish(expectations.registerEcho ? 0 : 1);
	}
});

const check = setInterval(() => {
	if (!registered) {
		return;
	}

	const wanted = account
		? [expectations.registerEcho, expectations.badKeysFail, expectations.unregisterEcho]
		: [expectations.accountRequiredFail];

	if (wanted.every(Boolean)) {
		clearInterval(check);
		console.log("-- all expected WEBPUSH replies seen");
		finish(0);
	}
}, 200);

setTimeout(() => {
	console.error("-- TIMEOUT");
	finish(1);
}, 30_000);
