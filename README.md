<h1 align="center">Seance</h1>

<h3 align="center">
	A static, bouncer-less web IRC client that talks IRCv3 straight to the ircd
</h3>

<p align="center">
	<a href="https://github.com/evilnet/seance/actions/workflows/pages.yml"><img
		alt="Pages build"
		src="https://github.com/evilnet/seance/actions/workflows/pages.yml/badge.svg"></a>
</p>

<p align="center">
	<strong>Try it:</strong> <a href="https://evilnet.github.io/seance/">evilnet.github.io/seance</a>
	— the latest build of <code>develop</code>, straight from GitHub Pages
</p>

## Overview

Seance is a browser IRC client with **no server of its own**. The page opens a
WebSocket directly to the IRC server (one IRC line per frame, `text.ircv3.net`
subprotocol) and speaks IRCv3 itself — CAP 302, SASL, `message-tags`,
`server-time`, `batch`, `echo-message`, `labeled-response`, `draft/chathistory`,
`draft/read-marker`, `draft/message-redaction`, `+typing`, STS and more. There is
nothing to host but a directory of static files.

- **Just files.** Build once, drop `public/` on any web server (or GitHub Pages),
  done. No Node process, no database, no accounts on the client side.
- **Yours to brand.** One `config.json` sets the network name, default server,
  theme, logo, help links, uploader and feature switches; see
  [`docs/resources/branding.md`](docs/resources/branding.md).
- **History without a bouncer.** Backlog, read markers and catch-up after a
  reconnect come from the ircd's `CHATHISTORY` support.
- **Modern chat features.** Replies, reactions, editing and deletion, typing
  indicators, inline media previews, search, mentions, multiple networks.
- **Installable.** A Chrome/Edge/Android PWA out of the box
  ([`docs/resources/pwa.md`](docs/resources/pwa.md)), with Electron and
  Capacitor shells for desktop and mobile stores under [`shells/`](shells/).

The target server is **nefarious2** (`ircv3.2-upgrade` branch), EvilNet's ircd
with a WebSocket listener and the IRCv3.2 capability set; any ircd that offers
IRC over WebSocket and the same caps should work, degrading gracefully where a
cap is missing.

Seance began as a fork of [The Lounge](https://github.com/thelounge/thelounge)
— its Vue client, themes and years of interface polish are the foundation this
is built on, and its Node/Socket.IO server is what Seance removed. Thank you to
The Lounge contributors, and to [Shout](https://github.com/erming/shout) before
it. Seance is MIT licensed like both.

## Building and serving

Requires [Node.js](https://nodejs.org/) 22 or newer and Yarn 1 (classic), which
ships with Node's `corepack`.

```sh
git clone https://github.com/evilnet/seance.git
cd seance
corepack yarn install
NODE_ENV=production corepack yarn build
```

That produces `public/`. Serve it from any static host:

```sh
python3 -m http.server -d public 8000
```

and open http://localhost:8000/. Brand it by editing `client/config.json`
before the build (or `public/config.json` after — runtime settings are read
from there on every page load).

The IRC server has to accept WebSocket connections from the page's origin over
`wss://` (a browser will not open a plain `ws://` socket from an `https://`
page). Running nefarious2 for local development, including a Docker script
with a self-signed certificate, is described in
[`docs/resources/nefarious2-dev.md`](docs/resources/nefarious2-dev.md).

## Development

```sh
corepack yarn watch      # rebuild public/ on change
corepack yarn lint       # eslint + prettier + stylelint
corepack yarn test       # lint + mocha
corepack yarn test:mocha # mocha only (builds first)
```

Run `corepack yarn githooks-install` once to get the pre-commit lint hook. If
linting fails, `corepack yarn format:prettier` usually fixes it.

Live tests against a real ircd (`test/irc/*.live.ts`) run when
`SEANCE_IRC_URL` points at one, e.g. `SEANCE_IRC_URL=wss://localhost:8443/`.

Where things live:

- `client/js/irc/` — the IRC layer: WebSocket transport, parser, CAP/SASL,
  one handler per command, one file per slash command.
- `client/components/`, `client/js/` — the Vue 3 app.
- `docs/` — design notes and plans:
  [`bus-contract.md`](docs/resources/bus-contract.md) (the events between the
  IRC layer and the UI), [`nefarious2-websocket.md`](docs/resources/nefarious2-websocket.md)
  (what the server actually does on the wire), and `docs/projects/` for
  in-progress work.
- `tools/` — the dev ircd runner, a WebSocket IRC probe and a PWA
  installability check.
- `attic/` — the original server code, kept for reference only.

See [`CLAUDE.md`](CLAUDE.md) for a fuller map of the codebase and its
conventions.

## Status

Usable as a daily client against nefarious2; branding, PWA, and Electron
packaging are in place, mobile shells are scaffolded, web push is not yet
available (it needs the ircd's `draft/webpush` to send). The plan and its
checklist are in
[`docs/projects/initial_conversion.md`](docs/projects/initial_conversion.md).
