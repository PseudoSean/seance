# Slow connect: the JOIN-time command burst vs. the server's flood penalty

_Noted 2026-08-27 ("it takes a long time to connect to an existing account…
we should not have a flood of crap to send"). Status: **root cause found and
fixed the same day** (`client/js/irc/catchup.ts`); follow-ups below._

## What was happening

Not WHOIS. On registration Seance sent one `JOIN` per saved channel, and as
each JOIN echoed back it immediately sent `MODE #chan`, `CHATHISTORY LATEST #chan * 50` and `MARKREAD #chan`. Measured with the real app in headless
Chromium against the dev ircd (`Network.webSocketFrameSent` timestamps),
15 channels:

- **65 commands in 0.14 s**: 5 for CAP/NICK/USER, 15 JOINs, then 3 per
  channel.
- Server replies stopped at **0.20 s** and nothing else arrived for
  **90 s** (then a PING); the last channels' history never came within the
  measurement window, and anything the user typed would have queued behind
  it.

Why: ircu-family fake lag. nefarious2 (`ircd/parse.c` ~L1620) charges every
command from a non-oper `lag = lagmin + len / lagfactor` seconds
(`2 + len/120` by default) onto `cli_since`, and `ircd/s_bsd.c` ~L1339 stops
reading the client's socket while `cli_since - CurrentTime >= 10`. So after
the first ~5 commands the budget is gone; 65 commands put the client ~2
minutes "ahead", the server ignores the socket until wall-clock time catches
up, and the queued lines (including the user's first message) drain only
then. The same applies on every reconnect. Exceeding the recvq while blocked
is "Excess Flood" and a disconnect.

## What changed (2026-08-27)

- **One `JOIN` for the autojoin list** (`IrcClient.joinChannels`):
  `JOIN #a,#b,#c key1,key2`, keyed channels first (keys are positional),
  split on `MAX_LINE_BYTES` and `TARGMAX=JOIN:<n>` when advertised. 15
  commands → 1.
- **No `MODE #chan` on JOIN.** The modes are asked for lazily, the first time
  the channel is opened (`IrcClient.open`, `Channel.modesKnown`, reset on
  re-JOIN). It only fed the "Channel modes: +nt" info line.
- **Paced catch-up** (`client/js/irc/catchup.ts`): the history + read-marker
  fetch for a channel is queued when its JOIN echoes. The channel the user is
  looking at is served immediately; the rest one channel every
  `CATCHUP_INTERVAL_MS` (4 s — two commands cost 4 s of lag, so the penalty
  stays flat and the user's own lines go out at once). Opening a waiting
  channel serves it now and restarts the pacing from there. `MARKREAD` is
  skipped when the server already volunteered the marker (nefarious2 does
  for logged-in accounts). The queue drops parted/removed channels and is
  cleared on close.
- Result for the same 15-channel connect: JOIN + the active channel's two
  commands go out at once (~4 commands after registration instead of 65),
  first message can go out immediately, remaining channels fill in over the
  next ~56 s in the background without blocking anything.
- Tests: `test/irc/catchup.ts` (fake timers); `client.ts`/`markread.ts`
  expectations updated (no MODE on JOIN, MODE on first open, single JOIN).

## Pipelining during registration (2026-08-27, suggested by ibutsu)

The lag clock is reset when registration completes (`s_auth.c:1483`
`cli_since = CurrentTime`), so commands sent before `001` are free — the
only cost of the registration exchange is round trips, and each "wait for
the reply before sending the next line" was one. The server processes
lines in order, so anything whose precondition is established by the
previous line can be sent in the same flush:

- `CAP REQ …` → **`CAP END` in the same flush** (`caps.ts`
  `pipelineEnd`). The ACK/NAK still arrive and are tracked; a NAKed
  multi-cap REQ is atomic, so its caps are re-requested one at a time
  (once each; works after `CAP END` too). With SASL configured the
  `AUTHENTICATE <mech>` opener is what follows the REQ instead (the cap
  is enabled by the time the server reads it); a NAK of `sasl` aborts the
  exchange (`AUTHENTICATE *`) and sends `CAP END`.
- `JOIN a,b,c` → **the active channel's `CHATHISTORY` + `MARKREAD` in the
  same flush** (`catchup.ts` `prefetchCatchup`, called from the
  registration hook): membership holds by the time the server reads them.
  The JOIN echo then only adds `MODE` for that channel.
- Not pipelined: the PLAIN payload behind `AUTHENTICATE PLAIN` (needs the
  server to accept data before it sent `AUTHENTICATE +`; untestable here,
  no services), and `CAP END` before the SASL result (registration must
  not complete unauthenticated).

Measured (localhost, 4 channels): socket open → history batch went from
five round trips (LS · REQ · END→001 · JOIN · history) to three
(LS · REQ+END→001 · JOIN+history), all commands for the visible channel
out by 0.07 s. On a 100 ms link that is ~200 ms off every connect and
reconnect.

## Follow-ups

- **`CHATHISTORY TARGETS <t1> <t2> <limit>`** — nefarious2 implements it
  (`m_chathistory.c`). On reconnect, one command would list which targets
  have messages since the newest we hold, so only those need an `AFTER`
  fetch; on first connect it tells which channels have any recent traffic.
  Would collapse the background queue to the channels that matter.
- **Server side:** read-only fetches (`CHATHISTORY`, `MARKREAD` query,
  `MODE` query) could carry a lower lag charge, or a client with
  `labeled-response`/`draft/chathistory` could get a larger burst budget on
  connect. Worth raising with MrLenin alongside the WebSocket fixes; the
  client-side pacing stays regardless (other ircds, and it is the right
  shape anyway).
- **Queries** are not caught up on connect at all today (no JOIN to hook);
  history for open PMs is fetched when opened (`more`). Fine, but note it.
- **Unread badges** for not-yet-caught-up channels only reflect live traffic
  until their turn comes (≤ 4 s × position). If that is too slow for large
  channel lists, prioritise channels with an unread marker mismatch once
  `TARGETS` is in.
- Show a subtle "catching up…" state on channels still queued (the UI has
  `moreHistoryAvailable`; a `catchingUp` flag would be the analogue).
