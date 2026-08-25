# IRC line parser/serializer for the browser

Plan item 0.2a. Evaluated 2026-08-24 by installing candidates into a scratch dir (not into this repo) and reading their sources. Nothing was added to `package.json`.

## Requirements (from the plan)

1. IRCv3 `message-tags` parsing and serialising, including the escape table (`\:` `\s` `\\` `\r` `\n`, and the rule that a lone trailing `\` is dropped and unknown escapes yield the bare character).
2. Friendly to CAP / `BATCH` / `labeled-response` handling (i.e. gives us tags + command + params and gets out of the way).
3. ISUPPORT (005) token parsing (can be a separate small module).
4. No Node built-ins (`net`, `tls`, `stream`, `events`, `buffer`, `util`).
5. Tree-shakeable ESM, TypeScript types, maintained.

## Candidates

### `irc-framework` (kiwiirc) — 4.14.0, last publish 2024-09

Already in `package.json` (`github:kiwiirc/irc-framework#9578e59`) because TheLounge's server used it. It is a whole client, not a parser.

- Parser lives in `src/irclineparser.js` (76 lines), `src/ircmessage.js` (50), `src/messagetags.js` (70), `src/helpers.js` (125). Their only external import is `lodash/map`; no Node built-ins in those four files. Tag escaping is correct and includes the "strip invalid backslash" rule.
- Everything else does pull Node modules: `src/transports/net.js` imports `net`, `tls`, `events`, `socks`, `iconv-lite`; `src/client.js` pulls `middleware-handler`, `eventemitter3`, lodash. The package's `browser` field points to `dist/browser/src/`, which is **not present** in the git-pinned install (`node_modules/irc-framework/` has no `dist/`), so the "does it bundle for the browser" answer is: only if you build it yourself with its own webpack/babel config, which drags in `stream-browserify`, `buffer`, `util`, `core-js` and `regenerator-runtime` (see its `dependencies`).
- CommonJS only, no `.d.ts`, no `sideEffects` flag: not tree-shakeable, no types.
- Deep-importing just `irc-framework/src/irclineparser` would work today (~320 lines, lodash/map only) but couples us to un-typed internals of a package we are otherwise removing.

Verdict: usable as a _reference_ for edge cases; not worth keeping as a dependency for 320 lines of code.

### `irc-message-ts` — 3.0.6, last publish 2022-05

TypeScript port of `irc-message`. `dist/parser.js` is 114 lines, zero imports, typed (`IRCMessage { tags, prefix, command, params, raw, param, trailing }`).

- **Does not unescape tag values** (`parser.js:26-33` just splits on `=`), and has no serialiser. Fails requirement 1.
- `dist/stream.js` imports `through2` (Node streams); the barrel `index.js` re-exports it, so importing the package root pulls a Node stream shim into the bundle. You would have to deep-import `irc-message-ts/dist/parser`.
- Unmaintained (3 years).

### `irc-message` — 3.0.2, last publish 2022-06

JavaScript original. Depends on `through2` (streams) and `irc-prefix-parser`; no types; no tag unescaping. Not a fit.

### `ircv3` (d-fischer) — 0.33.1, last publish 2026-04

Actively maintained (Twurple's IRC layer). ESM + CJS builds (`exports` map with `./es/index.mjs`), full TypeScript types, `parseMessage()` / `parseTags()` / `parsePrefix()` exported from `lib/Message/MessageParser`. Handles tag escaping via `@d-fischer/shared-utils`.

- It is a full client framework: `lib/` is 1.4 MB, `IrcClient` imports `@d-fischer/connection` whose `DirectConnection` requires `net`/`tls` (it has a `browser` field to swap to WebSocket, so it does bundle for the browser). `parseMessage` returns class instances with a `MessageTypes` registry and `ServerProperties`; the parser is not separable from the type registry without importing most of the library.
- Its message model (typed command classes with parameter validation, `NotEnoughParametersError`) is opinionated and Twitch-shaped. We would fight it around nefarious2's non-standard numerics (see `nefarious2-websocket.md`).
- Seven runtime dependencies for what we need.

Verdict: the best-maintained candidate, but heavy and opinionated; we would use ~2% of it.

### `irc-parser-ts`, `@ircv3/parser`, `ircv3-parser`, `irc-parser`, `@kiwiirc/irc-framework`

Not on npm (404, or unpublished in 2021). There is no official "ircv3.net" JS parser package.

### Reference implementations

- `~/src/goguma/lib/irc/message.dart` (26-230): a ~200-line hand-rolled parser + serialiser with correct tag escaping, `IrcSource` parsing, and a `toString()` that decides when a trailing param needs `:`. `lib/irc/isupport.dart` is a ~300-line ISUPPORT registry, `lib/irc/caps.dart` a CAP LS 302 value parser. Goguma is the client most aligned with what Seance wants (chathistory, read-marker, webpush) and its parser boundaries are a good template.
- `~/src/thelounge/` (upstream) just uses `irc-framework` server-side; nothing browser-side.

## Recommendation

**Hand-roll it in `client/js/irc/` (or `shared/irc/`), ~250 lines total, no dependency.** Rationale:

- Every off-the-shelf option either lacks tag escaping (`irc-message*`), is an untyped CommonJS client framework (`irc-framework`), or is a large typed client framework we would use a sliver of (`ircv3`). The parsing problem itself is small and completely specified (RFC 1459 §2.3.1 + IRCv3 message-tags), and goguma's Dart version is a direct crib.
- Owning the parser means the `IrcMessage` type is exactly the shape the rest of the client wants (`tags: Map<string, string | null>`, `source`, `command` (uppercased), `params: string[]`), with no adapter layer.
- It is trivially tree-shakeable and testable with mocha under `test/` (port the irc-framework/goguma edge-case tests: empty trailing param, `:` inside a middle param, tag with no value, `\` at end of value, multiple spaces between params).

Proposed module layout (names only; not part of phase 0):

| Module                | Responsibility                                                                                                                                                                                                              |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `irc/message.ts`      | `parseLine(line): IrcMessage`, `formatLine(msg): string`, `parseTags`/`formatTags`, `parseSource`, `escapeTag`/`unescapeTag`. Rejects/strips CR LF. Enforces the ~500-byte outbound cap noted in `nefarious2-websocket.md`. |
| `irc/isupport.ts`     | Token map with typed accessors (`prefix`, `chanmodes`, `casemapping`, `nicklen`, `chathistory`, `extban`/`extbans`, `targmax`, `bot`). Accepts both `EXTBAN` and `EXTBANS`.                                                 |
| `irc/caps.ts`         | CAP LS 302 accumulator (handles `*` continuation and `key=value` caps), `CAP NEW`/`DEL` diffing, the "required vs. optional" list from the plan.                                                                            |
| `irc/casemap.ts`      | `rfc1459` / `ascii` folding for nick/channel comparison.                                                                                                                                                                    |
| `irc/transport-ws.ts` | `WebSocket` wrapper: subprotocol negotiation, one line per frame, reconnect backoff. The prototype in `tools/irc-ws-probe.mjs` is the sketch.                                                                               |

If we later want a second opinion on correctness, `irc-framework/src/irclineparser.js` can be vendored into the test suite as a differential oracle without shipping it.
