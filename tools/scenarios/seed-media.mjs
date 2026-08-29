#!/usr/bin/env node
/* eslint-disable no-console */
// Post media links into a channel so a browser scenario has something to
// preview. Not a scenario itself — run it directly:
//
//   node tools/scenarios/seed-media.mjs [wss://localhost:8443/] [#seance] [url…]
//
// With no URLs it posts one working image — the Seance logo, served by the
// same host as the app when you serve `public/` on :8000 — with a unique
// query string, so each run posts a distinct URL and a scenario can tell its
// own preview apart from the scrollback. Pass URLs to post something else,
// e.g. `https://media.invalid/x.mp3` for the veil's error state.
// Dependency-free; uses Node's global WebSocket and skips TLS verification
// for the dev ircd's self-signed certificate.

const [target = "wss://localhost:8443/", channel = "#seance", ...urls] = process.argv.slice(2);

const links = urls.length
	? urls
	: [`http://localhost:8000/img/logo-art.png?run=${Date.now().toString(36)}`];

if (target.startsWith("wss:")) {
	process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

const nick = `seedbot${Math.floor(Math.random() * 1000)}`;
const ws = new WebSocket(target, ["text.ircv3.net"]);
const send = (line) => {
	console.log(`>> ${line}`);
	ws.send(line);
};

ws.onopen = () => {
	send(`NICK ${nick}`);
	send(`USER ${nick} 0 * :seance seed`);
};

ws.onmessage = (ev) => {
	const line = String(ev.data);

	if (line.startsWith("PING")) {
		ws.send(`PONG${line.slice(4)}`);
		return;
	}

	const params = (line.startsWith("@") ? line.slice(line.indexOf(" ") + 1) : line).split(" ");

	if (params[1] === "001") {
		send(`JOIN ${channel}`);
	} else if (params[1] === "JOIN" && params[0].includes(nick)) {
		for (const link of links) {
			send(`PRIVMSG ${channel} :seeded media ${link}`);
		}

		setTimeout(() => {
			send("QUIT :seeded");
			setTimeout(() => process.exit(0), 300);
		}, 800);
	} else if (params[1] === "433") {
		send(`NICK ${nick}${Math.floor(Math.random() * 1000)}`);
	}
};

ws.onerror = (e) => {
	console.error("websocket error:", e.message ?? e);
	process.exit(1);
};

setTimeout(() => {
	console.error("timed out");
	process.exit(1);
}, 20000);
