# Multi-line messages (`draft/multiline`) — design

Date: 2026-08-29. Branch: `multiline-messages` (from `origin/develop`).

## Goal

Send and receive IRCv3 `draft/multiline` messages so that a message can carry
newlines: one message, one msgid, rendered as one timeline entry. Without the
capability the client behaves exactly as today (one message per line).

Reference: https://ircv3.net/specs/extensions/multiline (draft). nefarious2
`ircv3.2-upgrade` advertises `draft/multiline=max-bytes=16384,max-lines=100`.

## Capability

- `draft/multiline` joins `SEANCE_CAPS.wanted`. The CAP 302 value is parsed
  into `{maxBytes, maxLines}`; a value missing either number is vetoed through
  the negotiator's `accept()` hook (the cap is then treated as absent).
- Requires `batch` and `message-tags` (both already wanted); if the server
  ACKs `draft/multiline` without `batch`, multiline is treated as absent.
- The stale "blocked by the 528-byte inbound frame bug" notes in `caps.ts` and
  `docs/resources/nefarious2-websocket.md` are corrected: #98 was fixed
  upstream on 2026-08-28. `MAX_LINE_BYTES = 500` stays — each PRIVMSG inside a
  batch is still its own line.

## Receive

`handlers/multiline.ts` registers a `draft/multiline` batch handler:

- Target = the batch's first param. Every buffered line must be a `PRIVMSG`
  or `NOTICE` (all the same command) to that target; otherwise the batch is
  malformed and its lines are delivered individually (today's behaviour).
- Text = lines joined in order: a line carrying the `draft/multiline-concat`
  tag is appended to the previous text without a separator; any other line is
  preceded by `\n`. An empty batch produces nothing.
- The synthetic message takes `msgid`, `time`, `account`, `label`,
  `+draft/reply`/`+reply`, `+seance/edit` and any other tags from the **batch
  opener**; the first line's `nick!user@host` is the source. It is then run
  through the ordinary PRIVMSG/NOTICE handler, so CTCP ACTION, highlights,
  mentions, `echo-message` self-detection, edits and replies all work on the
  joined text.
- Nested batches: when the multiline batch is inside an open parent (a
  `chathistory` replay, `labeled-response`, bouncer replay), the synthetic
  message is folded into the parent's buffer in the batch's position instead
  of being delivered live, so history replays stay in order and in collect
  mode. The two existing tests that pin "unknown batch type folds into its
  parent line by line" are updated to expect one joined message.

## Send

- `dispatchInput` (commands/index.ts): when multiline is available and the
  text contains `\n`:
  - first line is not a command → the whole text is one `say`;
  - first line is `/me`, `/notice`, `/msg` or `/query` → that command receives
    the multi-line rest (multi-line action / notice / private message);
  - any other command → today's per-line loop.
    Without multiline: today's behaviour, unchanged.
- `IrcClient.sendMessage(target, text, opts)`: if `text` contains `\n` and
  multiline is available, send a batch:
  ```
  @label=…;+draft/reply=…;+seance/edit=… BATCH +<ref> draft/multiline <target>
  @batch=<ref> PRIVMSG <target> :line 1
  @batch=<ref>;draft/multiline-concat PRIVMSG <target> :…continuation of a line over the byte cap
  @batch=<ref> PRIVMSG <target> :line 2
  BATCH -<ref>
  ```
  Client-only tags (reply, edit, label) go on the opener only. Lines longer
  than the 500-byte line budget are split with `splitMessage` and every chunk
  after the first carries `draft/multiline-concat`. `ref` comes from a
  per-client allocator (`m1`, `m2`, …). Action messages wrap each line in
  `\x01ACTION …\x01` exactly as the server expects (per the draft, the CTCP
  framing is on each line; verify against the server and record the finding).
- Limits: if the text exceeds `maxLines` (counting concat chunks) or
  `maxBytes` (sum of line bodies), it is split into consecutive batches at
  line boundaries; each batch is its own message.
- Without `echo-message`, the joined text is synthesised locally as one
  message, as the single-line path does today. With it, the server's echoed
  batch is the source of truth.
- Edits: `client.editMessage` uses the same path, so a multi-line edit is a
  batch whose opener carries `+seance/edit`. The old "collapse newlines to
  spaces" behaviour applies only when multiline is unavailable.

## Errors

`FAIL BATCH MULTILINE_MAX_BYTES`, `MULTILINE_MAX_LINES`,
`MULTILINE_INVALID_TARGET`, `MULTILINE_INVALID` are recognised in
`handlers/standard-replies.ts` and shown as an error line in the active
channel (or the lobby when the target is unknown). The client splits
proactively, so these are unexpected; the draft is not restored.

## UI

No new controls: `Shift+Enter` already inserts a newline in `#input`; the
timeline already renders `\n` (`white-space: pre-wrap`). Messages render in
full. `docs/resources/bus-contract.md` § `input` is amended: multi-line text
is one message when `draft/multiline` is negotiated.

## Tests

- `test/irc/multiline.ts` (`FakeTransport`, sinon spy on `socket.dispatch`,
  following the `test/irc/batch.ts` conventions): cap value parsing and veto;
  receive join with and without concat, opener tags (msgid/time/reply/edit),
  ACTION, NOTICE, malformed batch fallback, nested inside `chathistory`;
  send batching (line shape, opener tags, concat chunking of a >500-byte line,
  splitting at `maxLines`/`maxBytes`, `/me` and `/notice` multi-line, other
  commands per line), no-cap fallback identical to today, no-echo synthesis;
  FAIL replies.
- `test/irc/multiline.live.ts` (gated on `SEANCE_IRC_URL`): round-trip a
  3-line message through the dev ircd and assert one `msg` with `\n`.
- `test/e2e/multiline.spec.ts` (Playwright, gated on `SEANCE_E2E_IRC_URL`):
  type three lines with Shift+Enter, send, assert one `.msg` whose `.content`
  contains all three lines.

## Out of scope

Collapsing long messages, TAGMSG batches, rewriting how legacy per-line
sends were split, `draft/multiline` for `/raw`.
