# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**Seance** — a new project starting from a TheLounge checkout. The plan is:

- **Keep** TheLounge's Vue 3 frontend (`client/`).
- **Replace** TheLounge's Node/Socket.IO backend (`server/`) with direct connections to **nefarious2** (EvilNet's ircd) using its new **IRCv3-over-websocket** capabilities — no bouncer-style server in the middle.
- **Goal**: a codebase IRC networks can rebrand and ship as their own native client (iOS, Android, possibly Electron or installable PWA).

The current `server/` tree is still TheLounge's and is on borrowed time. Don't invest in extending it unless the work is a stepping stone toward the websocket transition. The biggest rewrite surface lives in `shared/types/socket-events.ts` (the Socket.IO contract being replaced) and `client/js/socket.ts` + `client/js/socket-events/` (where the frontend consumes it).

Upstream remains `github.com/thelounge/thelounge` for now; divergence will grow. The local checkout directory is `seance` but the package name in `package.json` is still `thelounge`. Node.js ≥ 22, Yarn-managed, MIT licensed. `.thelounge_home` pins the runtime config directory to `~/.thelounge` when running from this checkout.

## Common commands

All commands use Yarn.

| Task | Command |
| --- | --- |
| Install deps | `yarn install` |
| Production build (client + server) | `NODE_ENV=production yarn build` |
| Build client only (webpack → `public/`) | `yarn build:client` |
| Build server only (tsc → `dist/`) | `yarn build:server` |
| Run (requires prior build) | `yarn start` (or `node index start`) |
| Dev server with HMR | `yarn dev` |
| Webpack watch for client | `yarn watch` |
| Lint everything (eslint + prettier + stylelint) | `yarn lint` |
| Auto-format | `yarn format:prettier` |
| Full test (lint + mocha) | `yarn test` |
| Mocha only | `yarn test:mocha` |
| Coverage | `yarn coverage` |
| Install git pre-commit hook | `yarn githooks-install` |

Run a single test file:

```sh
cross-env NODE_ENV=test TS_NODE_PROJECT='./test/tsconfig.json' \
  mocha --config=test/.mocharc.yml test/path/to/file.ts
```

Note: `yarn test:mocha` runs `webpack --mode=development` first because some tests depend on built client assets. Skip the build with `yarn test:nospec` only if you know the test doesn't need them.

The `thelounge` CLI binary is not created when running from source — use `node index <command>` (e.g. `node index start`, `node index install <package>`). CLI subcommands live in `server/command-line/`.

## Architecture (current, inherited from TheLounge)

Three TypeScript trees share `tsconfig.base.json`:

- **`client/`** — *Keeping this.* Vue 3 + Vuex + Vue Router SPA built by webpack. Components in `client/components/` (`.vue` SFCs), app logic in `client/js/` (`store.ts`, `router.ts`, `socket.ts`, `socket-events/`, `commands/`). Themes in `client/themes/`. Service worker at `client/service-worker.js`. Webpack outputs to `public/`.
- **`shared/`** — Cross-cutting type definitions and helpers. `shared/types/socket-events.ts` defines the typed Socket.IO contract between today's server and client — **this is the migration boundary**: the eventual replacement is raw IRCv3 frames over websocket to nefarious2.
- **`server/`** — *Replacing this.* Node backend. Express + Socket.IO server (`server/server.ts`) owned by a `ClientManager` (`server/clientManager.ts`) which spawns one `Client` per logged-in user. Each `Client` owns one or more `Network` instances (`server/models/network.ts`) wrapping `irc-framework` connections. Models in `server/models/` (`network`, `chan`, `msg`, `user`, `prefix`). Entry point `server/index.ts` → `server/command-line/` (commander-based CLI: `start`, `install`, `uninstall`, `upgrade`, `outdated`, `storage`, `users`).

Server plugin subsystems under `server/plugins/`:

- `irc-events/` — handlers for incoming IRC events (join, part, message, mode, etc.), one file per event.
- `inputs/` — user slash-command implementations (`/msg`, `/ban`, `/mode`, ...). `inputs/index.ts` wires them up.
- `messageStorage/` — pluggable persistence: `sqlite.ts`, `text.ts` (plus `types.d.ts`).
- `auth/` — auth backends (local, LDAP).
- `packages/` — runtime extension/theme loading (`thelounge install` plumbing).
- Standalone: `changelog.ts`, `clientCertificate.ts`, `uploader.ts`, `webpush.ts`, `sts.ts`, `dev-server.ts`, `storage.ts`.

Default user config lives in `defaults/config.js`; `scripts/generate-config-doc.js` produces the website docs from it (`yarn generate:config:doc`).

## Conventions

- Prettier formatting is enforced; a git hook runs it pre-commit if installed via `yarn githooks-install`. If linting fails, try `yarn format:prettier` first.
- `noImplicitAny: false` is set in `server/tsconfig.json` and `test/tsconfig.json` with a "TODO: Remove eventually" — prefer adding explicit types in new code rather than relying on the loose setting.
- When changing `client/js` or `client/components`, run `yarn build:client`. When changing `server/`, run `yarn build:server`. `yarn dev` handles both with HMR for iterative work.
- Tests live under `test/` mirroring the source tree (`test/server.ts`, `test/client.ts`, `test/models/`, `test/plugins/`, `test/commands/`, `test/shared/`, `test/tests/`). Mocha config: `test/.mocharc.yml`; uses `tsx` as the loader.

## Documentation

`docs/` uses PARA (`projects/`, `areas/`, `resources/`, `archives/`) for in-repo planning and notes — see `docs/README.md`. Public end-user docs live in a separate repo (`thelounge/thelounge.chat`).
