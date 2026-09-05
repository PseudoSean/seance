# Web push: spec-shaped payload, multiline through push, markdown-aware worker

**Date:** 2026-09-04 · **Status:** implemented on branch push-payload-multiline (client) and push-line-payload (server); 2026-09-05: the later lines of a multiline message carry no msgid (§3.2) after upstream review — client branch push-multiline-fallback
**Repos:** Seance (`client/`, this repo) and nefarious2 (`testnet/nefarious`,
the fork's `push-notifications` line)

## 1. Purpose

Push notifications should show a readable preview of what was said, with
IRC formatting bytes gone and, when the user has Markdown rendering on, the
Markdown markers gone too. Multiline messages (`draft/multiline`) must reach
the device at all — today they never push. And the payload the ircd sends
must follow the IRCv3 `draft/webpush` draft (ircv3-specifications PR 471),
which says:

> Each push notification MUST contain exactly one IRC message as the
> payload, without the final CRLF.
> Servers MAY drop some or all message tags from the original message.
> Servers MUST NOT drop the `msgid` tag if present.

The draft says nothing about rate limiting, coalescing, truncation or what
the client does with the payload.

## 2. Decisions

| Decision                  | Choice                                                                                                                | Why                                                                                                     |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Payload shape             | One raw IRC line per push, as the draft requires                                                                      | Spec compliance; nefarious2's tiered JSON was never an IRC message                                      |
| Aggregation on the server | None                                                                                                                  | Forbidden by "exactly one IRC message"; the worker already merges per target                            |
| Multiline                 | One push per line at batch close, capped; the worker reassembles by batch reference                                   | Meets "multiline can transmit"; each push is still one IRC message                                      |
| Cooldown                  | Kept as is for single messages; checked **once per batch** so a multiline message's lines are never split by it       | Bounded POST volume; a batch pushes whole or not at all                                                 |
| Markdown stripping        | In the worker (and the page), only when the user's `markdown` setting is on; IRC formatting bytes are always stripped | The renderer's rules live in the client; the server stays Markdown-agnostic                             |
| Stripper code             | The page's `layout()` + `toPlainText()`, bundled into a worker chunk                                                  | One source of truth; unclosed markers stay literal (CommonMark), so partial text never loses characters |
| Truncation                | None on the server for this tier: a single IRC line always fits the 4 KB push ceiling                                 | Removes the 3000-byte clamp and the `trunc` flag from this path                                         |

Superseded during design (recorded so nobody re-proposes them): a server-side
aggregate with a timer flush at cooldown end, and a JSON payload with the
newest message on top plus a `prev` list. Both were dropped when the spec
stance was chosen.

## 3. Payload contract (server → worker)

Applies to the `full` tier (the testnet default; account metadata
`draft/webpush/payload` unset or `full`). The `ping` and `route` opt-down
tiers keep their JSON shape: they carry no message, so the "one IRC
message" rule does not apply, and the worker already parses both shapes.

Encoding is unchanged: UTF-8 plaintext, aes128gcm (RFC 8291), VAPID
(RFC 8292). No CRLF.

### 3.1 Single message (PM, private NOTICE, channel highlight)

```
@msgid=<id>;time=<iso8601>[;account=<account>] :<nick>!<user>@<host> PRIVMSG|NOTICE <target> :<text>
```

Exactly what a client with `server-time`, `message-tags` and `account-tag`
receives. `account` is present when the sender is logged in. All other tags
are dropped (the draft allows it). `<host>` is the sender's displayed host.

### 3.2 Multiline message: one push per line

```
@batch=<base>;msgid=<base>;time=<iso8601>[;account=<account>];evilnet.github.io/line=1/<sent>/<total> :<nick>!<user>@<host> PRIVMSG|NOTICE <target> :<line 1>
@batch=<base>;time=<iso8601>[;account=<account>];evilnet.github.io/line=<i>/<sent>/<total>[;draft/multiline-concat] :<nick>!<user>@<host> PRIVMSG|NOTICE <target> :<line i>
```

- `<base>` is the batch's single msgid. It is the `batch` reference on
  **every** line — what the lines inside a `draft/multiline` batch carry,
  and the receiver's grouping key — and the `msgid` of the **first line
  only**. That is `draft/multiline`'s fallback form, what a server sends a
  client that did not negotiate the capability (a push consumer never
  has): "Any tags that would have been added to the batch, e.g. message
  IDs, account tags etc MUST be included on the first message line to be
  sent", and (message-ids) "Servers MUST only include a message ID on the
  first message of a batch when sending a fallback to non-supporting
  clients". (An earlier revision repeated `msgid=<base>` on every line;
  upstream review of the server change pointed at that rule.)
- `time` is the batch's timestamp and `account` the sender's account (when
  logged in, same as §3.1), on every line: "Tags MAY also be included on
  subsequent lines where it makes sense to do so", and for a line that
  stands on its own as a notification they do. (A nefarious2 multiline
  batch has one msgid and one timestamp for all its lines —
  `testnet/nefarious/ircd/m_batch.c:891`, `:949`.)
- `evilnet.github.io/line` is our vendor tag, not part of the multiline
  shape: `<i>` is the 1-based line index in the original message, `<sent>`
  how many lines were pushed for this batch, `<total>` how many lines the
  message had. `<sent> = min(<total>, WEBPUSH_MULTILINE_LINES)`, and the
  server caps the feature at 64. Lines beyond `<sent>` are not pushed. Push
  delivery has no ordering guarantee, unlike a stream, so a receiver needs
  the tag to reassemble; the payload is still one IRC message. Noted in
  `docs/projects/push-subscription.md`.
- `draft/multiline-concat` is present exactly when the line was a concat
  chunk in the original batch (join to the previous line with no separator;
  otherwise join with a newline). The spec's own advice for concat lines —
  leave the trailing space on the line before — keeps each line readable on
  its own.
- The lines of one batch are sent back-to-back in index order; the worker
  orders by `<i>`.

The batch reference is the batch's base msgid — a held session has no
connection-scoped batch id — and it is the msgid the live page records
when it receives the batch itself (`client/js/push-seen.ts`, from the
`BATCH` opener), which is how the worker knows the page already has the
message whichever line a push service delivers, though only the first
line carries a msgid (§5.3).

### 3.3 Cross-device read

```
:<servername> MARKREAD <target> timestamp=<iso8601>
```

Replaces `{"t":"read","target":…,"ts":…}`. Same trigger and coalesce
window as today (`WEBPUSH_READ_COALESCE`, 3 s). With no marker the relay is
`:<server> MARKREAD <target> *` (the read-marker spec's own no-marker
form; the worker then sees no `timestamp`).

### 3.4 Size

An IRC line is at most 512 bytes of body plus nefarious2's tag budget, far
under the 4096-byte plaintext ceiling. The oversize guard remains as a
safety check and **logs** (`LS_SYSTEM`, warning) instead of dropping
silently.

## 4. Server (`testnet/nefarious`)

Branch: new, off the fork's `push-notifications` head (`8e7b844`).

### 4.1 Line builder (new module, dependency-free)

`ircd/webpush_line.c` + `include/webpush_line.h`: builds §3.1–3.3 lines
into a caller buffer from plain C strings (nick, user, host, command,
target, text, msgid, timestamp, account, batch ref, line index triple,
concat flag). Responsibilities: tag-value escaping per the message-tags
spec (`;` → `\:`, space → `\s`, `\` → `\\`, CR/LF → `\r`/`\n`), omitting
empty optional tags, and returning failure when the line would exceed the
buffer. No ircd headers beyond string helpers, so `ircd/test/` can link it
directly (the `webpush_attention.c` pattern).

### 4.2 Emit path

`webpush_emit_push` (`ircd/m_webpush.c:999`) gains the sender's identity
(nick/user/host) and the command. For the `full` tier it calls the line
builder and hands the line to `webpush_notify_account`; `ping`/`route`
keep the JSON code. The 3000-byte clamp and `trunc` are removed from the
`full` path. `webpush_notify_read` (`:930`) emits the `MARKREAD` line.

### 4.3 Triggers

`webpush_notify_pm` (`:947`) and `webpush_notify_channel` (`:1205`) keep
their call sites in `ircd/ircd_relay.c:354` and `:183`. The per-member
gate inside `webpush_notify_channel` (zombie, held-and-local, has account,
not the sender's own account, holding session, has subscriptions, not
silenced, mentioned, cooldown) is lifted into a static helper that takes
an array of texts to scan for the mention (one text for a single message,
the batch's lines for a multiline message), so the multiline hook reuses
it rather than copying it.

### 4.4 Multiline hook

`webpush_notify_multiline(sptr, target, lines, nlines, batchid, base_msgid, timestamp, is_notice)` where `lines` is an array of `{concat, text}`.
Called from `process_multiline_batch` after `history_store_multiline`
succeeds, on both the local path (`ircd/m_batch.c:1723`) and the
server-to-server path (`:2571`); each caller passes its own line list.

- PM target: the same account / held-session / subscription gate as
  `webpush_notify_pm`.
- Channel target: the member walk from §4.3; the mention test runs over
  every line (`ircd_text_mentions` per line; the `\x01ACTION ` prefix is
  stripped from a first line that has it; any other CTCP first line means
  no highlight).
- Cooldown: `webpush_cooldown_ok(account, origin, …)` is called **once per
  batch per recipient**, before any line is pushed; on failure the whole
  batch is skipped for that recipient.
- Then, for `i` in `1..sent`, one push per line via the emit path with the
  §3.2 tags.

New feature: `WEBPUSH_MULTILINE_LINES` (int, default 8, minimum 1) in
`ircd/ircd_features.c` next to `WEBPUSH_COOLDOWN` (`:1322`).

### 4.5 Out of scope on the server

The legacy per-line fallback toward servers without multiline
(`m_batch.c` `send_multiline_fallback`) keeps its current behaviour: on
the receiving server those lines are ordinary PRIVMSGs and the cooldown
applies per line as today.

## 5. Worker and page (Seance)

Branch: `push-payload-multiline`, off `develop`.

### 5.1 The push module (`client/js/push/`)

Plain TypeScript, no DOM, no Vue, no store, so mocha loads it:

- `line.ts` — `parsePushLine(raw)` (moved out of the service worker):
  tags with proper unescaping, valueless tags as `true`, prefix, command,
  params, trailing; returns `{tags, nick, command, target, text, timestamp?}`
  (`timestamp` is only present for `MARKREAD`, from its `timestamp=` param);
  `lineIndexOf(tags)` reads the ordering tag.
- `strip.ts` — `stripFormatting(text)` (the `matchFormatting` regex from
  `shared/irc.ts`, shared, not copied), `stripMarkdown(text)` =
  `toPlainText(layout(text, {markdown: true}))`, and `notificationText(text, {markdown})`
  (CTCP `ACTION` rewrite, then `stripFormatting` and, when `markdown` is
  true, `stripMarkdown`) — the function the worker and the page both call.
- `merge.ts` — the notification's stored message list: entries
  `{from, text, msgid?, batch?, lines?: Record<string, {text, concat}>, sent?, total?}`
  (`batch` is the batch reference, the `batch` tag; `msgid` is filled in by
  whichever line brings it, since only the first carries one and it may not
  arrive first);
  `addMessage(entries, incoming, keep) → {entries, isNew}` finds or creates
  the batch entry, inserts by index (idempotent), and `joinLines(entry)`
  rebuilds the text with the concat rule and `…` for a missing index or for
  lines beyond `sent`; `renderMergedBody(entries, isChannel, render)` (moved
  from the worker; `render` is the stripper callback, e.g.
  `(text) => notificationText(text, {markdown})`) applies render →
  middle-ellipsis → line budget.
- `worker-entry.ts` — assigns
  `self.seancePush = {parsePushLine, lineIndexOf, CONCAT_TAG, notificationText, stripFormatting, addMessage, renderMergedBody, MERGE_KEEP}`
  (no `stripMarkdown` export — the worker only ever needs it through
  `notificationText`).

### 5.2 Build

A second webpack configuration, exported alongside the main one from
`webpack.config.ts`: entry `client/js/push/worker-entry.ts` → output
`public/js/push.js`, `target: "webworker"`, `splitChunks: false`, no
runtime chunk, so the main config's vendor cache group (`:200`) cannot
capture its dependencies (`linkify-it`, `emoji-regex`). The service worker
loads it at top level:

```js
try {
  importScripts(`js/push.js?v=${cacheName}`);
} catch (e) {
  /* strip inline, no markdown */
}
```

and lists `js/push.js?v=${cacheName}` in `shellPaths`. The test-mode branch
of the config (`:324`) applies to the main configuration only.

The chunk is fetched once, at the worker's initial evaluation, before
install; if that fetch fails the registration runs on the inline fallback
until the next worker update.

### 5.3 Worker pipeline (`client/service-worker.js`)

`handlePush`: JSON → today's paths (`read`, tiers). Otherwise
`self.seancePush.parsePushLine`:

1. `MARKREAD` → `closeForTarget(target, timestamp)`, badge, return.
2. `PRIVMSG`/`NOTICE`: dedupe against the `seen` ring (the raw-line path
   never deduped; now it does) on three keys: the line's msgid (a plain
   message, or a batch's first line), the batch reference (the `batch` tag
   on every line — the base msgid the page recorded from the `BATCH`
   opener, so a page that received the batch live blocks every line though
   only the first carries a msgid), and `<batch>#<index>` (what this worker
   records after showing a line, so a redelivered line shows nothing while
   the rest of the batch still lands). Consequence: a page that records the
   message while its lines are still in flight suppresses the lines that
   arrive after the record, and the notification keeps its `…`
   placeholders for them (as §6 already allows).
3. Load `prefs` from IndexedDB `seance-push` (`{markdown: boolean}`;
   absent → `true`, the app default in `client/js/settings.ts`).
4. Per-target merge as today (`tag: push-<target>`, `getNotifications`):
   `addMessage` for a batch line or a plain append; the unread count rises
   once per message (first line of a batch only).
5. `renderMergedBody(entries, isChannel, render)`; title and actions
   unchanged; `data.messages` carries the entries so they survive worker
   restarts.

If `self.seancePush` is missing (chunk failed to load), an inline copy of
the formatting regex still strips control bytes and no Markdown stripping
happens.

### 5.4 Setting mirror

`client/js/settings.ts` `markdown` gains an `apply(store, value)` that
calls `mirrorPushPrefs({markdown: value})` (`client/js/push-prefs.ts`,
merge-writing `idbSet("prefs", …)`, `client/js/idb.ts`). The settings store
calls `apply` from `applyAll` at boot and from `update` on every change —
there is no separate write from `webpush.ts`. The worker never reads
localStorage.

### 5.5 In-page notifications

`client/js/socket-events/msg.ts:196` uses `stripFormatting` and, when
`store.state.settings.markdown`, `stripMarkdown` from the push module, so a
live page and the worker show the same body.

## 6. Error handling

Server: no subscriptions → skip (as today); cooldown failure for a batch →
the whole batch is skipped for that recipient; line builder failure or
oversize → logged, push skipped; push-service 410 → existing reap.

Worker: not JSON and not a parseable line → the generic "New activity"
notification (as today); chunk missing → raw text with formatting bytes
stripped inline; a batch whose lines never all arrive → shown with `…`
placeholders, never blocked on completeness; duplicate or out-of-order
line pushes → idempotent by index.

## 7. Testing

Server:

- cmocka unit tests for `webpush_line.c` (`ircd/test/webpush_line_cmocka.c`,
  same pattern as the existing `webpush_*_cmocka.c`): tag escaping, optional
  tags omitted, concat flag, index triple, `MARKREAD` shape, buffer overflow
  refusal.
- Live run against the testnet ircd through the push-listener harness
  (`docs/projects/push-subscription.md`, the decrypting listener under
  `tmp/`): a PM, a channel highlight, a multiline message with a concat and
  a newline line, a mention on a later line only, a batch over the line cap,
  two PMs inside the cooldown (second dropped, as today), a batch inside
  the cooldown (whole batch dropped), and a `MARKREAD` relay. Assert the
  decrypted plaintext byte for byte.

Client:

- mocha: `test/push/line.ts` (parser, unescaping, `MARKREAD`),
  `test/push/strip.ts` (formatting, Markdown on/off, unclosed markers stay
  literal, math to TeX), `test/push/merge.ts` (index insert idempotent,
  concat join, placeholders, count per batch, body budget).
- `yarn test` (lint, build test sees `public/js/push.js`), `yarn build`,
  headless smoke.
- Browser (`docs/resources/browser-testing.md`, `browser-check` skill):
  deliver synthetic push lines to the real worker over DevTools
  (`ServiceWorker.deliverPushMessage`) and assert the notification body
  for a single line and a two-line batch, with the markdown pref on and
  off.

## 8. Out of scope

Aggregation of any kind; changing the cooldown value or semantics for
single messages; the `ping`/`route` tiers; native shells; renaming the
`thelounge.*` storage keys.

## 9. Rollout

The client and the server change this payload's shape together, but an
installed service worker cannot be pushed to a browser out of band — it is
only re-checked (and, if changed, re-installed) on the browser's own
schedule, at most once every 24 hours. An old worker (pre this branch)
handed one of the new §3.1/§3.2 lines titles the notification `undefined`
(it does not know the line shape) and turns every `MARKREAD` relay into
the generic "New activity" notification (it does not recognise the
command). Deploy this client — so the worker in the field already
understands the new payload — before the server's `full` tier starts
sending lines, and allow up to 24 hours after that for browsers to pick up
the new worker before assuming every client has it.
