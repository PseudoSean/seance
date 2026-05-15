# Initial Conversion: Socket.IO bouncer → direct IRCv3-over-WebSocket to nefarious2

## Goal

Replace TheLounge's Node/Socket.IO server with the browser talking IRCv3 directly to nefarious2 over a WebSocket (`text.ircv3.net` style framing — each WS message is one IRC protocol line). The Vue 3 client (`client/`) is kept; the Node server (`server/`) is removed. The deliverable is a client that an IRC network can rebrand and ship as a native app (iOS, Android, Electron, PWA) without any bouncer infrastructure.

## Architectural shape

- **Today:** `client/js/socket.ts` instantiates a `socket.io-client` typed against `shared/types/socket-events.d.ts`. Vue components and `client/js/socket-events/*` call `socket.on(...)` / `socket.emit(...)`. The Node server in `server/` translates these events to/from `irc-framework`.
- **Target:** A new transport module in `client/js/irc/` opens a WebSocket per network to nefarious2, parses/serializes IRC frames, and exposes an `EventBus` whose shape matches the current Socket.IO contract just closely enough that the bulk of `client/js/socket-events/*` and the Vue components keep working. Server-only concepts (multi-session sync, server-side message storage, push subscriptions, link previews proxied through the server, server-side auth) either move into the client, become opt-in IRCv3 features (CHATHISTORY, MARKREAD, draft/event-playback), or are deferred/removed.
- **Strategy:** keep `socket` as a façade as long as possible. Introduce an `IrcClient` that drives a Vuex/Pinia store update path identical to what the current `socket-events` handlers do. Re-implement events in-place rather than ripping out files — that lets us land the conversion in many small commits with a working app at each step.

## Migration boundary inventory

These are the surfaces that will move or change. Cross-referenced in TODO items below.

- `client/js/socket.ts` — the singleton being replaced.
- `client/js/socket-events/*.ts` — 26 files; each will become either an internal event-bus subscriber that handles a translated IRC event, or be deleted (e.g. `changelog`, `sessions_list`, `mute_changed`, server-side `search`).
- `shared/types/socket-events.d.ts` — the contract; will shrink dramatically. Stays as the internal client event-bus contract.
- `shared/types/{network,chan,msg,user}.ts` — kept mostly intact; these describe the in-memory model. `id: number` (server-assigned) will become client-assigned.
- `client/js/store.ts`, `client/js/store-settings.ts` — settings sync moves to `localStorage` only.
- `client/components/**/*.vue` — call sites of `socket.emit`. Most flow through `input` (text → IRC raw), a handful are bespoke (`network:new`, `network:edit`, `auth:perform`, `sessions:get`, `change-password`, `search`, `mentions:*`, `mute:change`, `history:clear`, `sort:*`, `setting:set`, `upload:*`, `push:*`, `msg:preview:toggle`, `sign-out`, `changelog`, `open`, `more`, `names`).
- `client/js/commands/*` — already client-side; safe.
- `server/` — entire tree deleted at the end. Some logic (input parsing, message shaping, condensing) is worth porting to `client/js/`.

# TODO

## 1. Discovery and pinning down the contract

1. [ ] **Document the nefarious2 WebSocket binding**
   - [ ] a. Confirm WS URL shape (path, subprotocol — `text.ircv3.net` vs custom), TLS expectations, and whether one WS connects to one IRC server or multiplexes networks.
   - [ ] b. Capture the exact CAP set nefarious2 advertises that we plan to require (`sasl`, `message-tags`, `server-time`, `account-tag`, `echo-message`, `away-notify`, `chghost`, `extended-join`, `multi-prefix`, `userhost-in-names`, `setname`, `cap-notify`, `batch`, `labeled-response`, `draft/chathistory`, `draft/event-playback`, `draft/typing`, etc.).
   - [ ] b. Record nefarious2-specific quirks (numerics, ISUPPORT tokens, custom modes) that the client must tolerate.
   - [ ] c. Decide which IRCv3 history mechanism to use first: `CHATHISTORY` (per-target pull) vs `draft/event-playback` (server-pushed on reconnect) vs both. Note implications for the `more` event and reconnect resync.
2. [ ] **Inventory and classify every current Socket.IO event**
   - [ ] a. For each event in `shared/types/socket-events.d.ts`, record one of: `keep-as-internal-bus`, `derived-from-irc`, `client-local-only`, `delete`, `defer`. The output is a table checked into this doc.
   - [ ] b. For each `derived-from-irc` event, name the IRC numerics / CAP / tag that produces it (e.g. `topic` ← TOPIC + RPL_TOPIC + RPL_TOPICWHOTIME; `names` ← RPL_NAMREPLY + RPL_ENDOFNAMES; `nick` ← NICK; etc.).
   - [ ] c. For each `delete`/`defer` event, decide whether the calling Vue component or socket-event handler is also deleted, or whether it degrades gracefully.
3. [ ] **Pick an IRC parser/serializer for the browser**
   - [ ] a. Evaluate options: `irc-framework` (Node-leaning, works in browser with bundling?), `irc-parser-ts`, `@ircv3/parser`, or hand-roll. Criteria: tag/CAP support, batch handling, ISUPPORT, tree-shakeable, no Node built-ins.
   - [ ] b. Prototype a 50-line WS-to-parser-to-event-bus loop against a real nefarious2 instance to confirm the choice.
   - [ ] c. Decide on serializer: usually same lib provides it. Confirm tag escaping and CR/LF framing match `text.ircv3.net`.

## 2. Skeleton: parallel transport without removing anything

The point of this section is to introduce the IRC client alongside the Socket.IO client, behind a build/runtime flag, so we can develop incrementally on a real connection.

1. [ ] **Create `client/js/irc/`**
   - [ ] a. `client/js/irc/transport.ts` — opens the WebSocket, handles reconnection backoff, exposes `send(line)` and an `onLine(cb)` callback.
   - [ ] b. `client/js/irc/parser.ts` — wraps the chosen parser; produces a typed `IrcMessage { tags, prefix, command, params }`.
   - [ ] c. `client/js/irc/cap.ts` — implements CAP LS/REQ/ACK negotiation, SASL PLAIN/EXTERNAL, tracks enabled caps.
   - [ ] d. `client/js/irc/isupport.ts` — parses RPL_ISUPPORT (005) into `serverOptions` (PREFIX, CHANTYPES, NETWORK, CHANMODES, CASEMAPPING, STATUSMSG).
   - [ ] e. `client/js/irc/client.ts` — top-level `IrcClient` that owns transport+parser+cap+state and emits high-level events to mirror `ServerToClientEvents`.
2. [ ] **Introduce an internal event bus that mirrors today's `socket` API**
   - [ ] a. Add `client/js/irc/bus.ts` exposing `on(event, cb)` / `emit(event, payload)` typed against the *current* `ServerToClientEvents` / `ClientToServerEvents`. Same shape on purpose — existing handlers swap by changing the import only.
   - [ ] b. Add a config switch (`window.__seance_transport` or a build flag) so `client/js/socket.ts` can return either the Socket.IO client or the new bus, behind the same type.
   - [ ] c. Verify the app still builds and behaves identically when the switch is set to `socket.io`. No behavior change yet.
3. [ ] **Stand up a dev harness for hitting nefarious2**
   - [ ] a. Document the local nefarious2 setup needed for development (config, ports, TLS, test users) in a `docs/resources/nefarious2-dev.md`.
   - [ ] b. Add a tiny standalone dev page or a `yarn dev:irc` script that just instantiates `IrcClient` against a configured host and logs frames — independent of the Vue app, used to iterate on parsing and CAP.

## 3. Connection lifecycle: auth, init, network bootstrap

The current flow is `auth:start` → `auth:perform` → `init` (full networks list) → `configuration` → `setting:all`. We need a client-side analogue that ends with the store populated.

1. [ ] **Replace `auth:start`/`auth:perform`/`auth:failed`/`auth:success`**
   - [ ] a. Decide where credentials come from: a "Connect" form that already exists (`client/components/Windows/Connect.vue` / `SignIn.vue`) repurposed to capture network host + SASL creds + nick.
   - [ ] b. Persist credentials in `localStorage` (or pass through OAuth if a network supplies a bearer for SASL EXTERNAL/OAUTHBEARER). Decide encryption-at-rest stance for the password field; document it.
   - [ ] c. `IrcClient.connect()` opens WS, does CAP LS/REQ, USER/NICK, SASL, waits for 001/005/376, then emits a synthetic `auth:success` and `init`.
   - [ ] d. Delete `client/js/socket-events/auth.ts` once equivalent logic lives in `IrcClient`.
2. [ ] **Synthesize `init`**
   - [ ] a. Build the `SharedNetwork[]` payload from CAP+ISUPPORT+the user's stored channel list. `id` allocation moves client-side — keep a monotonic counter on `IrcClient`.
   - [ ] b. Auto-join the user's stored channel set after registration; for each, push a placeholder `SharedNetworkChan` and let JOIN/NAMES/TOPIC populate it.
   - [ ] c. Drop the server-driven "last active channel" — read it from `localStorage` instead and pass it via the synthetic `init`.
3. [ ] **Multi-network support**
   - [ ] a. Decide: one `IrcClient` per network with a `NetworkManager` aggregator, or one client multiplexing many connections. Recommend per-network — keeps state isolation and reconnects independent.
   - [ ] b. `NetworkManager` is what `client/js/socket.ts` ultimately exports — it dispatches `emit` based on the target network UUID.
   - [ ] c. Implement `network:new` (open new WS), `network:edit` (close+reopen with new params), `quit`/network removal.
4. [ ] **Configuration and settings**
   - [ ] a. `configuration` becomes a static, client-built object (themes shipped with the build, no server fileUpload, no LDAP, no public-mode flag from server). Hardcode a sensible default and surface a settings UI for whatever remains user-configurable.
   - [ ] b. `setting:all` / `setting:new` / `setting:get` / `setting:set` collapse into `localStorage`-backed reactive settings. Remove the round-trip; remove `client/js/socket-events/setting.ts`.
   - [ ] c. Remove `change-password`, `sessions:get`/`sessions:list`, `sign-out` (or replace `sign-out` with "disconnect and forget creds"). Delete the corresponding Vue components or stub them as no-ops.

## 4. Channel / message plumbing (the largest surface)

The bulk of the work. Each item below is "make this event come from IRC frames, then delete the server-side counterpart."

1. [ ] **`msg`** — incoming PRIVMSG / NOTICE / ACTION / TAGMSG
   - [ ] a. In `IrcClient`, on `PRIVMSG`/`NOTICE`, construct a `SharedMsg` (id from local counter, time from `@time` tag or now, `msgid` from `@msgid`, `from` populated, `self` if echo-message tagged with our nick).
   - [ ] b. Resolve `chan` id from the channel name (or open a QUERY channel on first PM from a new nick).
   - [ ] c. Implement self/highlight detection client-side using the user's current nick + the `highlight` keyword settings already in the store.
   - [ ] d. Port the unread/highlight counter logic from `server/client.ts` to the client (it's already partially on the client in `socket-events/msg.ts`).
   - [ ] e. Handle CTCP and CTCP_REQUEST framing into `MessageType.CTCP`/`CTCP_REQUEST`.
2. [ ] **`join` / `part` / `quit` / `kick` / `nick` / `chghost` / `away` / `account`**
   - [ ] a. JOIN: if it's us, allocate a channel id and emit synthetic `join` event; otherwise push a JOIN message and update `chan.users`.
   - [ ] b. PART: if us, emit `part`; otherwise remove user from `chan.users` and push a PART message.
   - [ ] c. QUIT: walk all channels we share with the user, push a QUIT, remove from each `users`.
   - [ ] d. KICK: like PART but for the target nick, with kicker info.
   - [ ] e. NICK: update `network.nick` if self; rename across all channels' user lists.
   - [ ] f. CHGHOST/AWAY/ACCOUNT: emit appropriate message types; update user state.
3. [ ] **`topic`** — TOPIC + RPL_TOPIC (332) + RPL_TOPICWHOTIME (333)
   - [ ] a. Update `chan.topic`; push a TOPIC message with setter and timestamp.
4. [ ] **`names`** — RPL_NAMREPLY (353) + RPL_ENDOFNAMES (366)
   - [ ] a. Accumulate per-channel during a 353 batch; emit `names` payload at 366.
   - [ ] b. Apply `userhost-in-names` parsing (set `hostmask` on the SharedUser).
   - [ ] c. Implement the `names` request flow used by the active channel — `IrcClient` issues `NAMES #chan` on demand.
5. [ ] **`mode`** — MODE
   - [ ] a. Channel modes: update the channel state; for prefix changes (op/voice/etc.) update the relevant user's `modes`/`mode`.
   - [ ] b. User modes (umode): emit a `MODE_USER` message.
   - [ ] c. Bans / ban list (`+b`, RPL_BANLIST 367 / RPL_ENDOFBANLIST 368) — populate the existing `list_bans` special channel. Same for invite list / exception list.
6. [ ] **`more`** — history backfill
   - [ ] a. Replace the current `more` round-trip with `CHATHISTORY BEFORE` (or `BETWEEN`) targeting the channel/query.
   - [ ] b. Handle the `batch` reply (`+chathistory`), accumulate messages, then deliver in one bus emit.
   - [ ] c. Track `moreHistoryAvailable` based on batch length vs requested count.
7. [ ] **`network:status` and reconnection**
   - [ ] a. Emit on WS open/close + on registration completion.
   - [ ] b. On reconnect, replay the user's joined channels list; rely on `event-playback` if the server supports it for catch-up, otherwise issue CHATHISTORY for each open channel since last seen msgid.
   - [ ] c. Mirror the existing channel-state reset (clear users, mark PARTED) on disconnect.
8. [ ] **`open` / unread / read markers**
   - [ ] a. `open` becomes a purely client-side state change (set active channel). If the server supports `draft/read-marker` / MARKREAD, send it.
   - [ ] b. Use stored read markers to compute `firstUnread` on init.

## 5. Outbound: replacing `socket.emit` call sites

1. [ ] **`input`** — the single highest-traffic outbound event
   - [ ] a. Port `server/plugins/inputs/index.ts` dispatch (`/msg`, `/join`, `/part`, `/nick`, `/mode`, `/topic`, `/whois`, `/kick`, `/ban`, `/list`, `/notice`, `/ctcp`, `/away`, `/back`, `/quit`, `/raw`, `/connect`, `/disconnect`, `/rejoin`, `/invite`, `/kill`, `/ignore`, `/ignorelist`, `/mute`, `/action`) into `client/js/irc/commands/`.
   - [ ] b. Keep the same trigger surface: anywhere the codebase does `socket.emit("input", {target, text})` now lands in this dispatcher.
   - [ ] c. Decide which "passthrough" service commands (`/ns`, `/cs`, etc.) stay — they're just `PRIVMSG NickServ :...` shortcuts and can stay client-side.
   - [ ] d. `/ignore` and `/mute` are client-local; persist to `localStorage`. `/ignorelist` reads from there.
2. [ ] **`open`, `more`, `names`, `mentions:*`, `mute:change`, `history:clear`, `sort:*`, `msg:preview:toggle`**
   - [ ] a. `open` — local.
   - [ ] b. `more` — issues `CHATHISTORY` (see 4.6).
   - [ ] c. `names` — issues `NAMES`.
   - [ ] d. `mentions:get`/`mentions:dismiss*` — back by `localStorage` (or IndexedDB if size grows). The current server-side mentions log is no longer relevant in a single-client model.
   - [ ] e. `mute:change` — local channel state in `localStorage`.
   - [ ] f. `history:clear` — local-only (it never deleted server logs anyway in single-client mode).
   - [ ] g. `sort:networks` / `sort:channels` — `localStorage`.
   - [ ] h. `msg:preview:toggle` — local; preview state is per-message client state.
3. [ ] **`network:new`, `network:edit`, `network:get`**
   - [ ] a. Persist network configs in `localStorage`; `NetworkManager` reads them at startup.
   - [ ] b. `network:get` becomes a local lookup feeding `NetworkEdit.vue`.
4. [ ] **`search`** — `Windows/SearchResults.vue`
   - [ ] a. Decide: drop search entirely in v1, or do best-effort local search across the in-memory message buffer. CHATHISTORY has no full-text search, so server-side search is not coming back without a separate service.
   - [ ] b. If we drop it, route `SearchResults.vue` to a "search not available" stub and keep the route for later.
5. [ ] **Push, upload, sessions, change-password**
   - [ ] a. Web push — defer. Requires a push service that knows your IRC state, which is what we just removed. Stub the UI off in settings; revisit later (could be a tiny dedicated push relay or an OS-level notification on native).
   - [ ] b. File upload — defer or wire directly to a network-provided uploader endpoint (configurable URL). Current `uploader.ts` server flow is removed.
   - [ ] c. Sessions — delete (single-client; no server to track sessions).
   - [ ] d. Change-password — delete from UI; password lives in SASL creds and is managed by NickServ.

## 6. Link previews

The current server fetches OG/oEmbed previews to avoid CORS and IP leaks. In a no-server world:

1. [ ] **Decide policy**
   - [ ] a. Option A: drop previews entirely in v1. Simplest, ships fastest.
   - [ ] b. Option B: best-effort client-side `<img>`/`<video>` for image/video URLs only (no metadata fetch). No CORS issues, no IP-leak surprise beyond what the user already does by clicking.
   - [ ] c. Option C: optional small preview service URL (configurable per-deploy) that the rebrander can run if they want rich previews.
2. [ ] **Strip the wire events**
   - [ ] a. Remove `msg:preview` from the bus contract once the chosen option is implemented.
   - [ ] b. Update `LinkPreview.vue` / `LinkPreviewToggle.vue` accordingly.

## 7. Server-side concepts to relocate or remove

1. [ ] **Message id allocation**
   - [ ] a. Move to a monotonic counter on the client, per session. Persist last id in `localStorage` so it survives reload.
   - [ ] b. Audit code that compares message ids across networks — should already be channel-scoped but verify.
2. [ ] **Condensed message collapsing (`shared/irc.ts:condensedTypes`)**
   - [ ] a. Already shared; verify it works without the server importing it.
3. [ ] **Highlight keyword evaluation**
   - [ ] a. Currently runs in `server/client.ts`. Port the regex builder to a `client/js/highlight.ts`. The settings UI already exists for highlight keywords.
4. [ ] **STS, client cert, WEBIRC**
   - [ ] a. STS — implement client-side STS policy cache (per host, in `localStorage`); upgrade `ws://` to `wss://` when policy says so.
   - [ ] b. Client certs — defer; browsers handle mTLS at the OS level. Native shells (Electron/iOS/Android) can ship a per-network cert later.
   - [ ] c. WEBIRC — irrelevant: the ircd sees the real client IP directly.
5. [ ] **`server/` deletion**
   - [ ] a. Delete `server/`, `server/tsconfig.json`, `server/command-line/`, `server/plugins/`, root scripts that target the server (`build:server`, server-side test files).
   - [ ] b. Update `package.json` scripts, remove server-only deps (express, socket.io, irc-framework if not reused, ldapjs, sqlite, web-push, ws, ...).
   - [ ] c. Remove `index.ts` CLI entry; replace with a static-site build target (the client + a tiny SPA index page).
   - [ ] d. Update `CLAUDE.md` to reflect the new architecture.

## 8. Build, packaging, and shipping

1. [ ] **Static-site build**
   - [ ] a. The output of `yarn build` becomes `public/` only (already is, basically). Confirm the index page no longer references the server.
   - [ ] b. Decide on a default config injection mechanism — a `config.json` fetched at boot for branding (network name, default host/port, theme, branding strings).
   - [ ] c. Make sure dev-mode HMR works without `server/plugins/dev-server.ts` (replace with webpack-dev-server or vite-dev — possibly migrate to Vite while we're here, separate decision).
2. [ ] **PWA / installable**
   - [ ] a. Audit `client/service-worker.js` — remove server-coordinated push registration; keep offline shell.
   - [ ] b. Ensure `manifest.json` is parametrized for rebranding.
3. [ ] **Native shells**
   - [ ] a. Electron: trivial wrapper over the SPA; carry the WS connection in the renderer.
   - [ ] b. iOS / Android: decide between Capacitor (reuse SPA) vs a thin native shell with a WebView. Note the WebSocket + background-keep-alive caveats per platform.
   - [ ] c. Plan a per-platform branding pipeline (icons, names, default network) downstream of the static build.
4. [ ] **Rebrand surface**
   - [ ] a. Catalogue every "The Lounge" string, asset, and meta tag the codebase still uses. Replace with values read from build-time branding config.

## 9. Testing and migration tooling

1. [ ] **Test strategy**
   - [ ] a. Existing `test/` runs against the Node server — most of those tests die with the server. Identify which tests cover `shared/` and `client/` and keep those.
   - [ ] b. Add a mock IRC server harness (in-memory, drives the same WS interface) for client-side integration tests of `IrcClient`.
   - [ ] c. Add a small e2e smoke test that boots the SPA against a local nefarious2 (manual or scripted).
2. [ ] **Telemetry / debugging**
   - [ ] a. Keep a "raw IRC log" view (the existing debug.raw concept) accessible from a developer toggle.
   - [ ] b. Add a CAP / ISUPPORT inspector UI for diagnosing connectivity against unfamiliar servers.

## 10. Sequencing checkpoints

Suggested milestones (each is a working app):

1. [ ] **M1: Bus parity** — Socket.IO replaced by an internal bus, but the bus is still backed by the Node server. No user-visible change. (Sections 1, 2.1, 2.2.)
2. [ ] **M2: Direct connect, single channel** — `IrcClient` can connect to nefarious2, send/receive PRIVMSG in a single hardcoded channel, no auth UI yet. Toggleable; Socket.IO still works in parallel. (Sections 2.3, 3.1, 3.2, 4.1.)
3. [ ] **M3: Feature parity for the active-channel experience** — JOIN/PART/NAMES/TOPIC/MODE/NICK/QUIT, multi-channel, multi-network, input dispatch, CHATHISTORY backfill. (Sections 3.3, 4.2–4.7, 5.1, 5.2.)
4. [ ] **M4: Settings, networks UI, persistence** — Connect/NetworkEdit screens drive WS, settings/sort/mute/mentions on localStorage. Search stubbed, previews per chosen policy, push stubbed. (Sections 3.4, 5.3, 5.4, 5.5, 6.)
5. [ ] **M5: Server deletion** — `server/` removed, build is static-only, branding hooks in place, CLAUDE.md updated. (Sections 7, 8.)
6. [ ] **M6: Shipping shells** — Electron + at least one mobile target running the SPA, branded build pipeline documented. (Section 8.3, 8.4.)
