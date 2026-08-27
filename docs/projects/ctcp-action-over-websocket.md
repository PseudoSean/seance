# CTCP ACTION (and all control codes) mangled over WebSocket; replies to `/me`

_Noted 2026-08-27. Status: **root cause found, upstream (nefarious2) bug**; not
yet fixed. Second item (replies to actions) is a Seance UX todo._

## Symptom

`/me waves` shows up as a normal line reading `<nick> �ACTION waves�`
instead of `* nick waves` — for actions received from others, for our own
echoed ones, and in chathistory replay.

## Root cause (verified 2026-08-27 against the dev ircd, `nefarious2:ircv3-fixed`)

Not Seance: `handlers/privmsg.ts` `parseCtcp()` is correct, and so is the
parser. The `\x01` bytes never reach the browser. nefarious2's WebSocket
path sanitises every text frame **in both directions** with
`string_is_valid_utf8()` and replaces "invalid" bytes with U+FFFD:

- `ircd/s_bsd.c` ~L382-388 (outbound: "RFC 6455: Servers MUST NOT relay
  non-UTF-8 content … We replace invalid bytes with U+FFFD") and ~L1266-1274
  (inbound complete text frames; fragmented frames at ~L1229 **disconnect**
  the client instead).
- `ircd/ircd_string.c` L68-86 `string_is_valid_utf8()` only accepts
  `0x09`, `0x0A`, `0x0D` and `0x20–0x7E` as single-byte sequences. The
  comment even says "use bytes[0] <= 0x7F to allow ASCII control characters"
  — but the code doesn't. Every other C0 byte and `0x7F` are treated as
  invalid UTF-8, which they are not (RFC 3629: U+0000–U+007F are one byte).

So besides CTCP `\x01` (ACTION, VERSION, PING, …) this also destroys the
mIRC formatting codes `\x02` bold, `\x03` colour, `\x0F` reset, `\x16`
reverse, `\x1D` italic, `\x1E` strikethrough, `\x1F` underline — anything
sent or received by a WebSocket client loses formatting and CTCP.

Evidence (scripts were in the session scratchpad; easy to redo with
`tools/irc-ws-probe.mjs`-style clients):

| Path                            | Payload bytes after `:`                       |
| ------------------------------- | --------------------------------------------- |
| TCP 6667 → TCP 6667             | `01 41 43 54 49 4f 4e 20 …` (intact)          |
| TCP 6667 → WS 8067 (text frame) | `ef bf bd 41 43 54 49 4f 4e 20 …` (U+FFFD)    |
| WS 8067 → TCP 6667              | `ef bf bd 41 43 54 …` (mangled on the way in) |

The Seance UI dump: `data-type="message"` `<actB> �ACTION waves at everyone�` — live and from `CHATHISTORY`. The relay code
(`ircd/ircd_relay.c` L109/L121, L471/L480 under `FEAT_UTF8ONLY`) uses the
same validator, so plain-TCP clients are affected too once `UTF8ONLY` is on.

## Fix

Upstream, one line: in `string_is_valid_utf8()` accept `bytes[0] <= 0x7F`
(or at least `0x01–0x1F` and `0x7F`; NUL is already the terminator). Keep
the sanitiser for real invalid sequences. Land it on the local
`seance/websocket-fixes` series in `tmp/nefarious2` (current branch there is
`seance/websocket-client-cert` at `21ec6d2`), rebuild `nefarious2:ircv3-fixed`
(`tools/nefarious-dev/run.sh` header), re-export `tmp/nefarious2-fixes.patch`,
and add it to the upstream PR after #100. Document it as bug **#4** in
`docs/resources/nefarious2-websocket.md` next to #97/#98/#99.

Seance side, while waiting / for other servers:

- Add a unit test for a live inbound `PRIVMSG … :\x01ACTION …\x01` →
  `MessageType.ACTION` in `test/irc/client.ts` (today only the history
  replay path is tested, `test/irc/history.ts` L453).
- Optionally tolerate the mangled form: if a message text starts with
  `�ACTION ` and ends with `�`, treat it as an action (with a
  console warning naming the server bug). Cheap, and keeps old servers
  usable — but it hides the bug; decide.
- Send in **binary frames** instead? The server's inbound sanitiser only
  runs for `WS_OPCODE_TEXT`; outbound `text_mode` is per client. Binary
  mode would sidestep the bug entirely (the probe has `--binary`), but
  browsers then get `Blob`/`ArrayBuffer` messages and `transport.ts` would
  need to decode; also the `text.ircv3.net` subprotocol implies text frames.
  Worth a test, not the default.

## Todo: replies to actions

Poxchat/`+draft/reply` allow replying to (and with) `/me` lines, and
`commands/me.ts` already attaches the reply tag. Gaps:

- `helpers/messageUpdates.ts` `replyQuote()` returns `{nick, text}` and the
  quote renders `nick text`; for an ACTION parent it should read `* nick waves` (and the `msg-reply-quote` on the `action` branch of `Message.vue`
  is only shown when `replyTo` is set, fine). Add the parent's `type` to
  the quote and format accordingly.
- `ChatInput.vue` compose bar: "Replying to **nick**: text" → for an
  action parent show "Replying to **\* nick** text" (`composeNick` /
  `composePreview`).
- `startReply()` (`helpers/compose.ts`) accepts any message with a msgid —
  good; `MessageActions.vue` hover bar is shown for `ACTION` too (`canAct`).
  Check `findLastEditable` / edit paths keep excluding actions (they do).
- Replying **with** `/me` while a reply is pending: `ChatInput.vue` passes
  `reply` on `input`; `commands/index.ts` honours `opts.reply` for `/me`.
  Verify end-to-end once ACTIONs survive the wire, and add a test in
  `test/irc/reactions.ts` (the replies suite).
- Notifications: `socket-events/msg.ts` L173 adds " says:" to the title only
  for `MESSAGE`; use "\* nick waves" as the body for actions.
- `inputHistory.ts` filters own `MESSAGE`s only, so `/me` lines are not in
  the up-arrow history — include actions as `/me …`.
