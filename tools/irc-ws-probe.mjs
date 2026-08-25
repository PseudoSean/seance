#!/usr/bin/env node
/* eslint-disable no-console */
// Minimal IRCv3-over-WebSocket probe (plan item 0.2b).
//
//   node tools/irc-ws-probe.mjs wss://host:port/path nick [--insecure] [--binary] [--stay]
//
// Opens the socket with the IRCv3 subprotocols, sends CAP LS 302 / NICK / USER,
// prints every inbound line, answers PING, ends CAP negotiation once LS is
// complete, and QUITs 5 s after 001 unless --stay is given.
// Uses `ws` from node_modules when available (lets --insecure skip TLS
// verification); otherwise falls back to Node 22's global WebSocket.

import {createRequire} from "node:module";

const positional = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const flags = new Set(process.argv.slice(2).filter((a) => a.startsWith("--")));
const url = positional[0];
const nick = positional[1] ?? "seance-probe";

if (!url) {
	console.error(
		"usage: node tools/irc-ws-probe.mjs wss://host:port/path nick [--insecure] [--binary] [--stay]"
	);
	process.exit(1);
}

const protocols = flags.has("--binary")
	? ["binary.ircv3.net", "text.ircv3.net"]
	: ["text.ircv3.net", "binary.ircv3.net"];

function openSocket() {
	if (flags.has("--insecure")) {
		process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
	}

	try {
		const WS = createRequire(import.meta.url)("ws");
		return new WS(url, protocols, {rejectUnauthorized: !flags.has("--insecure")});
	} catch {
		return new WebSocket(url, protocols);
	}
}

const ws = openSocket();
ws.binaryType = "arraybuffer";
const decoder = new TextDecoder();
let registered = false;

function send(line) {
	console.log(`>> ${line}`);
	ws.send(line); // one IRC line per frame, no CR LF (IRCv3 websocket spec)
}

function handleLine(line) {
	console.log(`<< ${line}`);
	const params = line.startsWith(":") ? line.split(" ").slice(1) : line.split(" ");
	const command = params[0]?.toUpperCase();

	if (command === "PING") {
		send(`PONG ${params.slice(1).join(" ")}`);
	} else if (command === "CAP" && params[2] === "LS" && params[3] !== "*") {
		send("CAP END"); // LS complete (a "*" in the 4th slot means more lines follow)
	} else if (command === "001" && !registered) {
		registered = true;
		console.log("-- registered");

		if (!flags.has("--stay")) {
			setTimeout(() => send("QUIT :probe done"), 5000);
		}
	} else if (command === "ERROR") {
		ws.close();
	}
}

ws.addEventListener("open", () => {
	console.log(`-- open (subprotocol: ${ws.protocol || "none"})`);
	send("CAP LS 302");
	send(`NICK ${nick}`);
	send(`USER ${nick} 0 * :Seance WS probe`);
});

ws.addEventListener("message", (event) => {
	const text = typeof event.data === "string" ? event.data : decoder.decode(event.data);

	// Spec says one line per frame; split defensively anyway.
	for (const line of text.split(/\r?\n/)) {
		if (line.length > 0) {
			handleLine(line);
		}
	}
});

ws.addEventListener("close", (event) => {
	console.log(`-- closed (${event.code} ${event.reason || ""})`);
	process.exit(0);
});

ws.addEventListener("error", (event) => {
	console.error("-- error:", event.message ?? event.error ?? event);
});

process.on("SIGINT", () => {
	if (ws.readyState === 1) {
		send("QUIT :interrupted");
	} else {
		process.exit(130);
	}
});
