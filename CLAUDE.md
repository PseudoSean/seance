# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**Seance** — a new project starting from a TheLounge checkout. The plan is:

- **Keep** TheLounge's Vue 3 frontend (`client/`).
- **Replace** TheLounge's Node/Socket.IO backend (`server/`) with direct connections to **nefarious2** (EvilNet's ircd) using its new **IRCv3-over-websocket** capabilities — no bouncer-style server in the middle.
- **Goal**: a codebase IRC networks can rebrand and ship as their own native client (iOS, Android, possibly Electron or installable PWA).

TheLounge's Node server has been moved to `attic/` (phase A of `docs/projects/initial_conversion.md`). It is **reference only** — not built, not linted, not tested, never imported. Look there for "how did the old server parse modes / handle kicks" when porting behaviour to the client. The biggest rewrite surface lives in `shared/types/socket-events.ts` (the Socket.IO contract being replaced) and `client/js/socket.ts` + `client/js/socket-events/` (where the frontend consumes it). Right now the client still tries to open a Socket.IO connection at boot and sits on the loading splash; phase B stubs that out.

Upstream remains `github.com/thelounge/thelounge` for now; divergence will grow. The local checkout directory is `seance` but the package name in `package.json` is still `thelounge`. Node.js ≥ 22, Yarn 1 (classic) — if `yarn` is not on PATH use `corepack yarn`. MIT licensed.

## Common commands

All commands use Yarn.

| Task                                            | Command                            |
| ----------------------------------------------- | ---------------------------------- |
| Install deps                                    | `yarn install`                     |
| Production build (webpack → `public/`)          | `NODE_ENV=production yarn build`   |
| Development build                               | `yarn build`                       |
| Webpack watch                                   | `yarn watch`                       |
| Serve the built SPA locally                     | `python3 -m http.server -d public` |
| Lint everything (eslint + prettier + stylelint) | `yarn lint`                        |
| Auto-format                                     | `yarn format:prettier`             |
| Full test (lint + mocha)                        | `yarn test`                        |
| Mocha only                                      | `yarn test:mocha`                  |
| Coverage                                        | `yarn coverage`                    |
| Install git pre-commit hook                     | `yarn githooks-install`            |

Run a single test file:

```sh
cross-env NODE_ENV=test TS_NODE_PROJECT='./test/tsconfig.json' \
  mocha --config=test/.mocharc.yml test/path/to/file.ts
```

Note: `yarn test:mocha` runs `webpack --mode=development` first because `test/tests/build.ts` checks the built output. Skip the build with `yarn test:nospec` only if you know the test doesn't need it.

## Architecture

Two TypeScript trees share `tsconfig.base.json`:

- **`client/`** — Vue 3 + Vuex + Vue Router SPA built by webpack. Components in `client/components/` (`.vue` SFCs), app logic in `client/js/` (`store.ts`, `router.ts`, `socket.ts`, `socket-events/`, `commands/`). Themes in `client/themes/`. Service worker at `client/service-worker.js`. `client/index.html` is copied to `public/` by webpack with `__HASH__` replaced by a cache-bust token (see `webpack.config.ts`). Webpack outputs to `public/`.
- **`shared/`** — Cross-cutting type definitions and helpers. `shared/types/socket-events.ts` defines the typed Socket.IO contract between today's server and client — **this is the migration boundary**: the eventual replacement is raw IRCv3 frames over websocket to nefarious2.
- **`attic/`** — Not a build target. TheLounge's old `server/` (Express + Socket.IO, `ClientManager`/`Client`/`Network` models wrapping `irc-framework`, `plugins/irc-events/` handlers, `plugins/inputs/` slash commands, message storage, auth, packages), its CLI entry `index.js`, `defaults/config.js`, and the server-side tests. See `attic/README.md`. Excluded from ESLint, Prettier, and `tsconfig.json` references — do not import from it.

## Conventions

- Prettier formatting is enforced; a git hook runs it pre-commit if installed via `yarn githooks-install`. If linting fails, try `yarn format:prettier` first.
- `noImplicitAny: false` is set in `server/tsconfig.json` and `test/tsconfig.json` with a "TODO: Remove eventually" — prefer adding explicit types in new code rather than relying on the loose setting.
- When changing `client/js` or `client/components`, run `yarn build` (or `yarn watch` while iterating).
- Tests live under `test/`: `test/shared/` (pure helpers from `shared/` and `client/js/helpers/`), `test/tests/build.ts` (checks the webpack output), and `test/client/` (browser-side specs bundled by webpack in development mode into `test/public/testclient.js`). Mocha config: `test/.mocharc.yml`; uses `tsx` as the loader.

## Documentation

`docs/` uses PARA (`projects/`, `areas/`, `resources/`, `archives/`) for in-repo planning and notes — see `docs/README.md`. Public end-user docs live in a separate repo (`thelounge/thelounge.chat`).
