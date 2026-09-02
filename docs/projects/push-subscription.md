# Push subscription, phase 1: `draft/webpush` REGISTER round-trip

_Noted 2026-09-01. Status: **implemented 2026-09-01** (branch
`feat/webpush-subscribe`): M2–M8 as planned below, the probe at
`tools/webpush-probe.mjs` and the live test at `test/irc/webpush.live.ts` (M1),
unit tests at `test/irc/webpush.ts` (M9), and the browser scenario at
`tools/scenarios/webpush-subscribe.mjs` — all green against the testnet ircd.
One deviation from the text below: the Settings toggle ships **enabled**
(what the verification checklist requires), with the phase-2 caveat that a
push arriving before the worker has a `push` handler would be undeliverable.
Scope: **subscription only** — the client subscribes via the browser Push API
and registers the subscription with the ircd per the draft spec. Delivery
(the service-worker `push` handler) is phase 2 and keeps its plan in
`notifications.md`._

_Live-cycle findings 2026-09-02 (first real trigger attempt, testnet ircd):_

- **The client must send `PERSISTENCE SET ON`** after SASL (same flush as the
  ATTACH): it is the opt-in that _creates_ the server's bouncer session and
  turns its hold on. Without it no session ever exists — regardless of
  `PERSISTENCE STATUS DEFAULT ON` — and a disconnected client can never be
  pushed to. Implemented in `client.ts`/`persistence.ts`; the ack + STATUS
  are swallowed during registration.
- **The server needs `"BOUNCER_ENABLE" = "TRUE"`** — the feature defaults
  off, and with it off `bounce_should_hold` returns NULL before anything
  else is consulted (no session is ever created). testnet's conf now sets
  it; production needs the same.
- **nefarious2 bug found and fixed** (testnet submodule, commit `34d377e`):
  `parse_keys` passed the exact value length to `ircd_strncpy`, which copies
  len-1 chars — browser keys (87-char p256dh, 22-char auth) were stored one
  char short, decoded to 64 bytes, failed the 65-byte check, and every push
  silently skipped in `notify_iter_cb`. Pushes were stored correctly and
  never sent. Upstream-candidate commit in `testnet/nefarious`.
- **Notification actions and merging** (all covered by
  `test/tests/service-worker.ts`): Reply (inline text on desktop; a
  deep-linking button elsewhere) and Mute 30m both run over a throwaway SASL
  connection the worker opens from the stashed credentials — reply sends
  `PRIVMSG`, mute does a metadata GET-merge-SET on `draft/webpush/mute`.
  Same-target pushes merge into one notification whose body combines the
  recent messages with middle-ellipsis truncation; the `t:"read"` relay
  closes a target's notification once another device has read past it.
- **The worker handles nefarious2's tiered JSON payloads** (`{"t":"msg",…}`
  for PMs, `{"t":"hl",…}` for channel messages mentioning the account's
  nick, `{"t":"read",…}` to close what another device already read
  - `text` on the `full` tier — the server DEFAULT since d7dedfb (the
    payload is encrypted server-to-device, so there is nothing to leak;
    accounts can still opt down with `METADATA \* SET draft/webpush/payload
    - :route|ping`under`draft/metadata-2`), falling back to the spec's
      raw IRC line.
- The whole chain was verified to the edge of the sandbox: session HELD →
  PM → all server gates pass (flag/HOLDING/subscription/cooldown) → push
  emitted → FCM accepted a correctly-signed aes128gcm push for this
  browser's subscription (201 Created, direct-post test). The final
  FCM→headless-browser delivery could not be observed in this sandbox
  (headless Chrome's FCM socket + a test profile degraded by repeated
  subscribe/unsubscribe cycles); the same cycle in a headed browser is the
  remaining manual check.

Sources: [ircv3-specifications PR #471](https://github.com/ircv3/ircv3-specifications/pull/471)
(`extensions/webpush.md`, the `draft/webpush` cap), the nefarious2
`ircv3.2-upgrade` branch (`testnet/nefarious`), and a verified wire-level
round-trip (transcript below).

## What the draft spec requires (PR #471, `draft/webpush`)

- Capability `draft/webpush` (unprefixed `webpush` is forbidden until final).
- The server advertises its VAPID public key in a **`VAPID` ISUPPORT token**
  (URL-safe base64 P-256 ECDSA point, stable for the connection).
- `WEBPUSH REGISTER <endpoint> <keys>` — `<keys>` is message-tag encoded:
  `p256dh=<urlb64>;auth=<urlb64>` (client ECDH P-256 public key + 16-byte
  auth secret — i.e. exactly `PushSubscription.toJSON()`'s keys). Registers
  are idempotent per endpoint (re-REGISTER replaces). Clients SHOULD renew
  (identical REGISTER) periodically and on `pushsubscriptionchange`.
- Success reply: echo `WEBPUSH REGISTER <endpoint>`. `UNREGISTER` likewise
  echoes and MUST silently succeed for unknown endpoints.
- Errors via standard replies: `FAIL WEBPUSH INVALID_PARAMS|INTERNAL_ERROR| MAX_REGISTRATIONS <command> <endpoint> <message>`.
- The pushed payload (phase 2) is one raw IRC line, encrypted aes128gcm
  (RFC 8291) under the client's p256dh key, VAPID-signed (RFC 8292).

## What nefarious2 `ircv3.2-upgrade` implements

Inventory (all verified by reading the source; branch head `1d323e0`):

- **Cap + values** — `draft/webpush` in `capab.h`/`m_cap.c`; the CAP 302
  value is `vapid=<key>` when a VAPID key is available, absent otherwise.
  The same key goes out as ISUPPORT `VAPID=<key>` (`add_isupport_s` in
  `m_webpush.c` `webpush_setup()`); a `CAP NEW`/`CAP DEL` fires when the key
  appears/disappears. Note the ISUPPORT token reaches _every_ client, not
  only `draft/webpush`-enabled ones (minor spec deviation, harmless).
- **Command** — `m_webpush.c`: `WEBPUSH REGISTER <endpoint> <keys>` /
  `WEBPUSH UNREGISTER <endpoint>`, gated on `CapActive(CAP_DRAFT_WEBPUSH)`
  and `IsAccount(sptr)`. Failure codes actually sent: `INVALID_PARAMS`
  (bad keys / endpoint / unknown subcommand / missing cap),
  `ACCOUNT_REQUIRED` (non-spec code), `INTERNAL_ERROR` (store down).
  `MAX_REGISTRATIONS` is never sent (no limit implemented yet) — the client
  should still understand it.
- **Endpoint validation** — HTTPS-only, ≤ 512 bytes, and a hardcoded
  loopback/RFC1918/ULA blocklist (`is_valid_endpoint`). Real FCM/Mozilla
  push-service endpoints pass.
- **Keys parsing** — `p256dh=...;auth=...` split on `;`. **Quirk:** lengths
  are checked with `>=` against `WEBPUSH_MAX_P256DH = 128` /
  `WEBPUSH_MAX_AUTH = 32` _characters_. A 32-char auth string therefore
  FAILS (`INVALID_KEYS` behaviour via `INVALID_PARAMS`); the browser's real
  values (88-char p256dh, 22-char auth) fit with room to spare.
- **Storage + delivery** — subscriptions persist per **account** in the
  db\_\* store (`webpush_store.c`, RocksDB-backed via the branch's db
  abstraction; the "LMDB" comments predate it). Trigger paths
  (`webpush_notify_pm` v1, `webpush_notify_channel` v2, account metadata
  `draft/webpush/payload` = ping/route/full) landed 2026-08-28 and are
  phase-2 material. Delivery prunes HTTP 410 endpoints.
- **VAPID provisioning** — priority order: `WEBPUSH_VAPID_PRIVKEY` feature →
  persisted key in the store → auto-generate + persist. No services (X3)
  involvement despite the stale "from services" comment in `m_cap.c`.
- **Boot wiring** — the whole subsystem only comes up when feature
  `CAP_draft_webpush` is TRUE (default **off**); the store path is the
  `WEBPUSH_DB` feature (default `webpush` under DPATH).

### Wire behaviour verified by probe (`tmp/webpush-register-probe.mjs`)

Against the testnet ircd (below), with SASL PLAIN account `testaccount`:

```
CAP LS 302   →  ... draft/webpush=vapid=BLB6-4OioBPa__W4w93qeXLpdHYwSr8xONZjy_... draft/bouncer ...
CAP REQ :sasl draft/webpush → ACK
AUTHENTICATE PLAIN → + → 900 / 903 (account testaccount)
005 ... VAPID=BLB6-4OioBPa__W4w93qeXLpdHYwSr8xONZjy_...
WEBPUSH REGISTER https://push.example.com/send/... p256dh=<88>;auth=<22>
             →  WEBPUSH REGISTER https://push.example.com/send/...        ✓ echo
WEBPUSH REGISTER ... p256dh=<88>              (no auth)
             →  FAIL WEBPUSH INVALID_PARAMS REGISTER :Invalid keys format …
WEBPUSH REGISTER http://127.0.0.1/x ...
             →  FAIL WEBPUSH INVALID_PARAMS REGISTER :Invalid push endpoint …
WEBPUSH UNREGISTER <endpoint> (never registered)
             →  WEBPUSH UNREGISTER <endpoint>                             ✓ echo
WEBPUSH REGISTER ... (not logged in)
             →  FAIL WEBPUSH ACCOUNT_REQUIRED REGISTER :…
```

Two extra findings that shape the client:

- **A `WEBPUSH REGISTER` sent between 903 and `CAP END` is silently
  dropped** (no echo, no FAIL, no state). Registration commands must go out
  **after 001** — i.e. from `onRegistered()`, not from the SASL `beforeEnd`
  hook.
- The `sasl=PLAIN` mechanism list and the `VAPID` ISUPPORT token are
  advertised even without X3: iauthd-ts (the IAuth program) does SASL
  itself, so **accounts do not require services**.

### The payload-encryption roundtrip (`tmp/push-roundtrip.mjs`, `tmp/wpcrypto*`)

FCM accepts any octet-stream, so a broken server-side encryptor is
invisible in the delivery logs: FCM answers 2xx and the browser silently
discards what it cannot decrypt (no push event, no error anywhere).
After "posting to FCM succeeded but nothing ever showed on any device"
persisted across every other fix, the decisive test was a **local
crypto roundtrip**:

1. Generate a P-256 keypair + auth secret locally, `WEBPUSH REGISTER`
   them under an HTTPS endpoint the ircd can dial (`https:// irc.testnet.local:9099/` — a hostname, because the endpoint validator
   blocks IP literals; `/etc/hosts` maps it to 127.0.0.1 and the system
   CA store trusts the dev cert so libcurl connects).
2. Arm the hold (`PERSISTENCE SET ON`), `QUIT`, then PM the ghost from a
   second (SASL'd — anonymous loopback clients can stall in iauthd
   post-restart) connection.
3. The listener captures the exact POSTed `aes128gcm` body; the script
   decrypts it with the private key (RFC 8291 derivation, AAD empty per
   RFC 8188 §2.2 — "The additional data passed to each invocation of
   AEAD_AES_128_GCM is a zero-length octet sequence") and verifies the
   VAPID JWT signature against the announced key.
4. `tmp/wpcrypto.c` + `tmp/wpcrypto-diff.mjs` diff **every intermediate**
   (base64url decode, ECDH, ikm, cek, nonce) between the ircd's
   verbatim primitives and a reference implementation.

This caught the bug that explained every symptom: `webpush_encrypt`
declared its HKDF info strings with an explicit trailing `\0` **on top
of the implicit string terminator**, so `sizeof()` was one byte longer
than RFC 8291's info (29/25 instead of 28/24). The derived CEK and
nonce were unique garbage — no browser could decrypt anything. The IKM
derivation was unaffected (fixed 144-byte buffer, not a string
literal), which is why REGISTER, ECDH and the envelope all looked
healthy. Fixed in nefarious2 `72fdd37`; the whole chain (REGISTER →
hold → notify → parse → encrypt → VAPID → POST → decrypt) now verifies
end-to-end against reference crypto.

## The test environment (testnet, built and running natively)

`testnet/` ships as Docker Compose (nefarious + X3 + keycloak) but pins the
nefarious submodule to **master**, which has neither the WebSocket support
nor the webpush work — the submodule must move to `ircv3.2-upgrade` for any
of this (seance's target branch; the master pin `b265ced` is an ancestor, so
nothing is lost). In this sandbox Docker cannot run at all (no CAP_NET_ADMIN,
no overlay mounts), so the ircd was built and run **natively** instead; the
X3/keycloak containers are simply not needed for subscription work because
iauthd-ts handles SASL.

What was set up (all in gitignored scratch, reproducible):

```sh
cd /seance/testnet/nefarious
git checkout ircv3.2-upgrade            # submodule was pinned to master
autoreconf -fi
./configure --prefix=/seance/tmp/testnet-run/ircd-install \
    --with-dpath=/seance/tmp/testnet-run/conf \
    --with-maxcon=4096 --with-rocksdb=/usr --with-zstd=/usr --enable-keycloak
make -j && make install
(cd tools/iauthd-ts && npm ci && npm run build)   # IAuth program (SASL)
/seance/tmp/testnet-run/setup.sh        # assembles the conf dir (see below)
su ircrun -c 'cd /seance/tmp/testnet-run/conf && \
   /seance/tmp/testnet-run/ircd-install/bin/ircd -f ircd-docker.conf'
```

`/seance/tmp/testnet-run/setup.sh` derives the runtime config from testnet's
own files with a handful of edits, each of which is a documented trap:

- `base.conf` = `tools/docker/base.conf-dist` with the `%VAR%` substitution
  the Docker entrypoint would have done.
- `ircd.conf` = `testnet/data/ircd.conf`, plus:
  - the **second** duplicate `IAuth` block commented out (only one parses),
    and the program path pointed at `iauthd-ts/dist/index.js` (`tsconfig`
    outDir is `dist/`; the stock conf's `iauthd-ts/index.js` assumes a
    docker layout that flattens it);
  - static SASL users enabled as **`#IAUTH SASLDB <path>`** — iauthd-ts
    only reads `^#IAUTH <directive>` lines, which the ircd treats as
    comments; the stock `#DISABLED# SASLDB` form is invisible to _both_
    parsers, and the active keycloak provider line must be double-`#`
    commented to disable;
  - the X3 `Port`/`Connect` blocks commented out (no services running);
  - appended `Port { port = 8067; websocket = yes; }` and
    `Port { port = 8443; ssl = yes; websocket = yes; }` (the compose config
    has no WebSocket ports at all), and a `Features` block with
    `"CAP_draft_webpush" = "TRUE"`, `"WEBPUSH_DB" = ".../webpush"`, and the
    usual IPCHECK clone-limit relaxations for reconnect-heavy testing.
- `ircd-docker.conf` (the three `include`s), a self-signed `ircd.pem`, the
  `saslusers` file (`testaccount:mypassword`), and empty store dirs.
- The ircd refuses to run as root: it runs as user `ircrun`.

`tools/irc-ws-probe.mjs` shows the cap advertisement; the full REGISTER
round-trip probe lives at `tmp/webpush-register-probe.mjs` (promote it to
`tools/webpush-probe.mjs` as part of M1 below).

The seance client was then verified against this ircd in a real Chromium
(`tools/browser-drive.mjs`, `--chrome` wrapper adding `--no-sandbox` because
the sandbox runs as root):

```
http://127.0.0.1:8000/?host=127.0.0.1&port=8067&tls=false&nick=seance1
  &join=%23seance&sasl=plain&saslAccount=testaccount&saslPassword=mypassword
  &autoconnect=1
→ ws://127.0.0.1:8067/ handshake (text.ircv3.net), CAP LS 302, ACK,
  SASL PLAIN → 900/903, 001, PERSISTENCE STATUS DEFAULT ON,
  JOIN #seance, CHATHISTORY LATEST, MODE, names — screenshot taken
```

## Implementation plan (seance client)

Design baseline: `notifications.md` § "Client-side push design". One browser
`PushSubscription` per profile (the endpoint belongs to the service-worker
registration); the _same_ endpoint+keys get REGISTERed with every network
whose account we are logged in to. All state changes flow through
`client/js/webpush.ts`; no component touches the IRC layer directly.

**M1 — probe + fixtures (no product code).** Promote
`tmp/webpush-register-probe.mjs` → `tools/webpush-probe.mjs` (SASL +
REGISTER/UNREGISTER round-trip, `--insecure` for wss). Add a live mocha file
`test/irc/webpush.live.ts` (gated on `SEANCE_IRC_URL`, one-at-a-time rule
per CLAUDE.md) asserting the echo/FAIL behaviour — this is the acceptance
test for everything below.

**M2 — capability negotiation.** `client/js/irc/caps.ts`: add
`"draft/webpush"` to `SEANCE_CAPS.wanted`, with an `accept` hook entry
requesting it only when the CAP 302 value parses as `vapid=<urlb64>` (the
server lists the cap without a value when no key exists; requesting anyway
is useless). Store the advertised key on the client (see M4). NB: the
negotiator's `accept` is also consulted on NAK-retry; keep it pure.

**M3 — ISUPPORT.** `client/js/irc/isupport.ts`: typed accessor
`get vapid(): string | undefined` reading the `VAPID` token (spec source of
truth after registration; cross-check against the cap value — prefer
whichever is present, they are the same key on this branch).

**M4 — client lifecycle.** `client/js/irc/client.ts`:

- `onRegistered()` (post-001, the only correct point — see the probe
  finding): if `draft/webpush` is enabled and the store has a subscription
  for this network, send `WEBPUSH REGISTER`. Sent in `autojoin()`'s flush —
  one extra line against the ~2 s/command fake lag is fine, and
  re-registering on every connect satisfies the spec's renewal advice for
  free.
- New methods `webpushRegister(endpoint, keys)` /
  `webpushUnregister(endpoint)` building the lines (`formatLine`-style,
  mindful of `MAX_LINE_BYTES = 500`: a 500-byte cap must never split a
  REGISTER — guard and refuse before sending).

**M5 — inbound handlers.** New `client/js/irc/handlers/webpush.ts`
(`{WEBPUSH: handler}` → one entry in `handlers/index.ts` `modules`) handling
both echoes: dispatch a bus event `webpush:state {network, endpoint, ok, reason?}`. Extend `handlers/standard-replies.ts` so `FAIL WEBPUSH …`
(`INVALID_PARAMS`, `ACCOUNT_REQUIRED`, `INTERNAL_ERROR`,
`MAX_REGISTRATIONS`) routes to the same event instead of falling into the
generic FAIL path — follow the `REDACT`/`CHATHISTORY` precedent there. The
`ACCOUNT_REQUIRED` code is non-spec but real; map it to a distinct reason.

**M6 — bus contract.** `shared/types/socket-events.d.ts`
(`ClientToServerEvents`): `webpush:register {network: string; endpoint: string; keys: {p256dh: string; auth: string}}` and `webpush:unregister {network: string; endpoint: string}`. Wire them in `client/js/irc/bus.ts`
(`bus.handle(...)` → look up the client by uuid → M4 methods), exactly like
`network:*`. Update `docs/resources/bus-contract.md` (§ client→server
events) — the IRC layer dispatches against that contract.

**M7 — `client/js/webpush.ts` (replaces the stub).** The state machine:

- `pushNotificationState`: `unsupported` (no `PushManager`/no SW/ insecure
  context — Electron and Capacitor shells included, per the platform
  matrix) / `not-installed` (iOS: PWA not on the Home Screen) / `denied` /
  `blocked` (server refused) / `subscribed` / `unsubscribed`. The store
  already has the field (`store.ts`).
- `subscribe(networks)` — user-gesture entry point (Settings button):
  `Notification.requestPermission()` → `registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8Array(vapid)})`
  → persist `{endpoint, keys, vapid}` under `thelounge.push` (localStorage;
  keys stay `thelounge.*` per convention) → emit `webpush:register` for each
  logged-in network advertising the cap. The VAPID key comes from the
  network's negotiated cap/ISUPPORT; refuse to subscribe against a network
  whose server did not advertise one.
- `unsubscribe()` — `pushManager.unsubscribe()` + `webpush:unregister` to
  every network it was registered with. Note the endpoint is shared across
  networks: only unsubscribe from the _push service_ after the last network
  dropped it (per-account removal on the server is independent).
- Re-subscribe triggers: VAPID key change observed on a later connect
  (`pushsubscriptionchange` has no ircd trigger — the ISUPPORT comparison on
  reconnect is our detection), and the daily renewal recommended by the
  spec is covered by the on-connect re-REGISTER (M4).
- The SW itself needs no changes in phase 1 (the `push` handler is phase
  2); `userVisibleOnly` means the first real push will show a notification,
  so do not subscribe users before the worker can render one — phase 1
  ships the subscription UI **behind the existing disabled button**, enabled
  in phase 2. (Revisit if we want phase 1 user-testable in the wild.)

**M8 — Settings UX.** `client/components/Settings/Notifications.vue`: the
"Subscribe to push notifications" button (today hardcoded `disabled`)
becomes driven by `pushNotificationState` + per-network capability (server
supports `draft/webpush`?). Status text per state; the iOS Home-Screen hint
from the matrix. No new settings keys yet (`desktopNotifications` is the
in-app layer, independent).

**M9 — tests.** `test/irc/webpush.ts` (FakeTransport + `sinon.spy(socket, "dispatch")`, honouring the root-level spy convention in `test/irc/client.ts`):
cap acceptance/rejection of the `vapid=` value; REGISTER line shape and the
500-byte guard; echo/FAIL dispatch, including `ACCOUNT_REQUIRED`;
on-register/off-register lifecycle around `onRegistered()`. Run with
`SEANCE_IRC_URL` set: `test/irc/webpush.live.ts` from M1.

## Verification checklist (phase 1 done = all of these)

1. `corepack yarn test` green (lint + mocha).
2. `node tools/webpush-probe.mjs ws://127.0.0.1:8067/` prints the full
   echo/FAIL transcript above.
3. Live mocha: `SEANCE_IRC_URL=ws://127.0.0.1:8067/ … test/irc/webpush.live.ts`.
4. `tools/browser-drive.mjs` scenario: Settings → subscribe → frames show
   `WEBPUSH REGISTER` → echo → state `subscribed`; reload reconnects and
   re-REGISTERs; toggling off sends `UNREGISTER` and the echo lands.
5. Manual on a real browser+account (FCM endpoint, needs https or
   localhost): subscription endpoint is a real `https://fcm.googleapis.com/…`
   URL, ircd accepts it (check the store grows), no 410 path touched.

## Deliberately out of scope (phase 2+, tracked in `notifications.md`)

- The service-worker `push` handler + worker-built-from-TS webpack entry,
  grouping/badging/actions; payload tier (`draft/webpush/payload` account
  metadata via `draft/metadata-2`, which the branch also offers);
  server-side mute/snooze semantics; `pushgarden`-style relay for the
  Capacitor shells; VAPID rotation UX (the server keeps one key per ircd;
  rotation invalidates every subscription — the client must surface
  `pushsubscriptionchange`-style recovery).

## Open questions

- Multi-network endpoint sharing vs. per-network privacy: one endpoint
  registered with N networks means each server can push the same device.
  Fine for a single-network rebrand (this repo's goal); revisit if seance
  ever connects to third-party networks.
- Should the client set the account's `draft/webpush/payload` metadata
  (`METADATA SET`) from a Settings choice, or leave the server default
  (`route`)? Phase 2 decision.
- `FAIL WEBPUSH MAX_REGISTRATIONS` is currently unreachable server-side
  (no limit implemented); if a limit lands upstream, wire our handling to
  it and re-check.
- Upstream niceties worth a nefarious2 PR: the `>=` key-length quirk, the
  stale "from services" comment, and the silently-dropped pre-registration
  REGISTER (a `FAIL` would have saved a probe iteration).
