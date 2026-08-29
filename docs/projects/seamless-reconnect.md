# Seamless reconnect (mobile): no join/topic replay, back the moment the app is

_Noted 2026-08-27 ("when on mobile, it disconnects right the instant you
switch away… it almost is [seamless] but I'm seeing topic posted on channels
again, and a session message from nef"). Status: **fixed the same day**;
follow-ups below._

## What was happening

Three things stacked up on every return to the app:

1. **Late reconnect.** Mobile browsers drop the WebSocket the instant the
   app is backgrounded (or the OS kills it without a close event). The
   transport then waits out its backoff (1 s → 60 s), and while the page is
   hidden its timers are throttled anyway. Only the Capacitor shells poked
   the connection on foreground (`native.ts` `appStateChange`); the PWA and
   plain browser had no hook at all.
2. **The server's restoration burst shown as activity.** AfterNET's
   nefarious2 runs the built-in bouncer (`draft/persistence`, see
   `docs/resources/nefarious2-websocket.md` § Session persistence): a
   logged-in user's session is held across the drop, and the reconnect
   resumes it. Right after the MOTD the server replays the membership it
   kept — a `BATCH draft/persistence` of JOIN (original `@time`/`msgid`),
   332, 333, MARKREAD and NAMES per channel. Seance rendered those like a
   fresh join: "Rubin … has joined the channel", "The topic is: …", "Topic
   set by …".
3. **A second topic burst.** On top of the restoration Seance sent its own
   `JOIN #a,#b,…` at 376. Resumed as the primary the server ignores it;
   attached as an _alias_ (another client of the same account — the
   desktop — is still the primary) `m_join.c` answers each channel with a
   synthetic 332/333/NAMES burst: the third "The topic is" line.

Without persistence (hold expired, another ircd) the plain re-JOIN after a
drop showed the same join/topic lines as well.

## What changed (2026-08-27)

- **Foreground hooks for the browser build** (`client/js/foreground.ts`,
  installed from `boot.ts`): `visibilitychange` → visible, `online` and a
  back/forward-cache `pageshow` call `reconnectAll()`, which now de-bounces
  (one poke per second; the native `appStateChange` fires alongside).
  Networks waiting to reconnect dial immediately; open ones are probed.
- **Socket probe** (`WsTransport.probe()`, `Transport.probe?`): sends
  `PING :probe`; if nothing at all arrives within 10 s the socket is dropped
  and reported as an unclean close, so the normal reconnect follows. Any
  inbound data cancels it. Replaces the bare `PING :resume` that could sit
  on a dead socket for minutes.
- **Quiet re-join** (`Channel.rejoining`): set for every channel we were in
  when the connection dropped (not on our own QUIT), cleared by the end of
  the re-JOIN's NAMES (366). While set, `join.ts` does not show our own
  JOIN and `topic.ts` hides a 332 whose topic we already show (and its
  333). A topic that changed while we were away is shown as before.
- **`draft/persistence`** (`client/js/irc/persistence.ts`,
  `handlers/persistence.ts`): the cap is requested; the registration-time
  `PERSISTENCE STATUS ON` sets `client.persistenceHold` and, at 376, the
  autojoin is held back (`awaitRestoration`) until the `draft/persistence`
  batch has been applied — or `RESTORE_WAIT_MS` (1 s) passed without one.
  The batch is run through the normal handlers with `client.restoring` set:
  JOIN/332/333/NAMES update the model, show nothing (a topic we did not
  know yet — fresh page load — is still shown), and each restored JOIN
  starts the usual paced catch-up (`CHATHISTORY AFTER` the newest line we
  hold). Afterwards only the channels the server did _not_ restore are
  JOINed. `STATUS OFF`, no STATUS, or no cap: JOIN at 376 as before. A
  `PERSISTENCE` reply the user asked for (`/persistence status`) is shown in
  the lobby.
- Tests: `test/irc/persistence.ts` (fake timers; both paths),
  `test/irc/transport.ts` § probe, `caps.ts` updated.

## Round two: it was still repeated (2026-08-28)

What a reconnect on the phone actually looked like after the first round
(the JOIN lines were gone — the topic was not):

```
07:46 *** The topic is: Not Just Linux - All OS & Hardware. …
07:46 ***  Topic set by Rubin on 28 May 2026, 10:19:49
07:46 ***  Channel mode is +tn
07:47 BOUNCER: Attached to session AZ7Rzi… as alias on FractalRealities.AfterNET.Org [NOTE ALIAS_ATTACHED]
07:47 *** The topic is: Not Just Linux - All OS & Hardware. …
07:47 ***  Topic set by Rubin on 28 May 2026, 10:19:49
```

So the reattach delivered **two** channel-state bursts: the first one
restored the session (its JOIN was correctly silent, and the topic was news
because the page had been reloaded — the app is killed in the background),
then the bouncer attached this connection as an _alias_ of the account's
session and sent the whole burst again behind its `NOTE BOUNCER ALIAS_ATTACHED`. The first round only silenced topics inside the
`draft/persistence` batch, so the second burst printed the topic again.

Anything that keys off "which burst is this" is guessing at a sequence the
server does not announce, so the rule is now about the _content_:

- **An unchanged topic is never printed** (`handlers/topic.ts`): a 332 is
  shown when the topic differs from the one the channel already displays,
  and its 333 follows it or is dropped with it. Whatever produces the
  repeat — session restore, re-JOIN, the alias burst, a third burst — it is
  silent. `/topic` sets `Channel.topicAsked` so a query still answers (and
  now says "No topic is set." on 331 instead of nothing).
- **A JOIN for a channel we are already in is a no-op**: no join line
  (`handlers/join.ts`), and no second `CHATHISTORY`/`MARKREAD`/`MODE`
  either (`IrcClient.handleMessage` only starts a catch-up when the JOIN
  actually moved the channel from PARTED to JOINED). That is also what
  stops the repeat burst from spending ~6 s of fake lag.
- **The autojoin waits for a burst that is still arriving**: the wait after
  `PERSISTENCE STATUS ON` is 2 s, but every sign of a restoration in
  progress — one of the server's JOINs, a bouncer NOTE — extends it to
  `RESTORE_QUIET_MS` (750 ms) of quiet, capped at `RESTORE_MAX_WAIT_MS`
  (8 s) from registration. An unbatched burst (no `batch` cap, or the
  second burst) is covered as well as a batched one, and a JOIN we send
  into a restoration is what makes nefarious2 answer with the extra topic +
  NAMES burst in the first place.
- **The routine attach note is not shown**: `NOTE BOUNCER ALIAS_ATTACHED`
  inside the settling window (`inRestorationWindow`, the same 8 s) is setup
  chatter that would arrive on every switch back to the app. The same note
  later — or any other bouncer NOTE — is shown as before.

## Round three: the server does the catch-up (2026-08-28)

`PERSISTENCE ATTACH <profile> [<msgid>]` (nefarious2 `9bc57d4`) replaces our
`TARGETS` + N × `CHATHISTORY AFTER` with one server-driven replay. What the
client does now:

- **Track the cursor.** `IrcClient.cursor` is the newest msgid we have shown
  on the network, over every channel and query, picked by `@time`
  (`IrcClient.noteCursor`, called wherever a message gets its id — live,
  appended catch-up, and the prepended history pages, which by definition
  cannot move it backwards). Only messages that carry a msgid count.
- **Persist it.** `saved-networks.ts` keeps `cursor: {msgid, time}` next to
  the network in `thelounge.networks` (`setCursor`, normalised and preserved
  by `save()` like `lastUsed`), written at most once a second and flushed
  synchronously when the transport closes. The phone's PWA is killed between
  sessions, so memory is not enough. A network the user never saved simply
  gets no cursor.
- **Offer it.** After a _successful_ SASL, in the same flush as `CAP END` and
  before it (`client.ts` `offerAttachCursor` → `persistence.ts`
  `attachCursorLine`): `PERSISTENCE ATTACH default <msgid>`. Only when the
  `draft/persistence` CAP 302 value carries the `attach-cursor` token and the
  msgid fits the server's 64-byte buffer. Never without SASL — the server
  answers `FAIL PERSISTENCE ACCOUNT_REQUIRED` — and never after 001.
- **Read the answer.** `:server PERSISTENCE ATTACH default` sets
  `client.serverReplay`; every `FAIL PERSISTENCE … ATTACH …` clears it
  silently and the old dance takes over. `FAIL PERSISTENCE CURSOR_UNKNOWN <msgid>` is _not_ a failure: the msgid aged out of the server's index and it
  replays from its own derived point instead, so it is swallowed too
  (`console.debug` at most).
- **Take the replay as news.** The server wraps it in an outer
  `BATCH +ref evilnet.github.io/bouncer-replay` around one
  `BATCH +ref chathistory <target>` per channel and then per PM counterparty.
  `history.ts` `chathistoryBatch` recognises an inner batch inside that
  wrapper — or an unsolicited one arriving while `serverReplay` is set, for a
  server that replays without the wrapper — and **appends** it as
  ordinary `msg` events — no `more`, no highlight, no unread — instead of
  prepending it as older history, deduplicating on msgid against what the
  channel already shows. A PM from someone we have no window for opens one.
- **Stand down.** With the cursor accepted, a channel the server restores
  does not get a `CHATHISTORY AFTER` of its own (`persistence.ts`
  `serverReplayCovers`, consulted by `IrcClient.handleMessage` before
  `enqueueCatchup`): that is exactly what the cursor replaces. A channel this
  page load holds nothing for still gets its `CHATHISTORY LATEST` fill — the
  replay only carries the gap, which is often empty — and a channel the
  autojoin had to JOIN itself was not in the session when the replay ran, so
  it catches up as before. `MARKREAD` comes from the server inside the
  restoration batch; `MODE` stays lazy.
- **Hide the closing chatter.** The replay ends with a plain
  `NOTICE … :Session resumed. Replayed N message(s) …` outside the wrapper.
  Inside the settling window (`inRestorationWindow`, the same 8 s that hides
  `NOTE BOUNCER ALIAS_ATTACHED`) it is not shown; the same text later is.
- Tests: `test/irc/attach-cursor.ts` (20, fake timers + an in-memory storage
  backend).

Nothing changes when the server does not offer the token, SASL is not
configured or fails, or there is no stored cursor: the paced per-channel
catch-up of `catchup.ts` runs exactly as before.

## What the ircd offers next (read 2026-08-28)

MrLenin's design guide — [gist 8d644eb…](https://gist.github.com/MrLenin/8d644eb37878d7bcaa91d1a68ae23d94),
"Seamless Mobile Sessions Over Nefarious" — describes the intended shape of
all this, and `origin/ircv3.2-upgrade` is **17 commits ahead** of our
`tmp/nefarious2` checkout with the pieces already in it. What it changes for
us, in the order it is worth doing:

1. **`PERSISTENCE STATUS` is two arguments now** — done, see above; without
   this fix the hold is never detected against a current server, which is
   what let our JOIN land inside a reattach in the first place.
2. **`PERSISTENCE ATTACH <profile> [<msgid>]`** (`9bc57d4`) — done, see
   "Round three" above: the cursor is tracked, persisted, offered in the
   `CAP END` flush after SASL, and the server's replay is appended instead
   of being asked for channel by channel.
3. **Web push is wired** (`414b147` PMs, `9fbcb3b` channel highlights, via
   `ircd_relay.c`): the trigger our notifications note calls missing exists
   now, with per-account payload tiers (`ping`/`route`/`full`). D.11 is
   unblocked — see `notifications.md`.
4. **Post-registration fake-lag grace** (`a1215e6`, `9c9c89a`): ~15 free
   commands after registration for authenticated clients. It does not make
   `catchup.ts` unnecessary (other ircds, and the burst is still charged),
   but the 4 s pacing could start after a small free burst once we target a
   server that has it.
5. Our own WebSocket fixes were **merged upstream** (`fceb160`, PR #101), so
   the dev image no longer needs the local patch — re-pull and rebuild.

## Follow-ups

- **The replay is capped and says so to nobody.** `replay_next_channel` /
  `replay_next_pm` ask the store for at most `FEAT_BOUNCER_AUTO_REPLAY_LIMIT`
  (default 100) messages **per target**, and the closing NOTICE only counts
  what was sent — there is no truncation marker, no `draft/chathistory-end`
  on those batches, nothing a client can test. A busy gap therefore comes
  back silently short, and the client cannot tell "you missed 40 lines" from
  "you missed 40 of 900". Worth asking MrLenin for a signal (a gap marker at
  the head of a truncated batch, or a `WARN`/`NOTE` with the count); until
  then the user's escape hatch is the ordinary "show older messages" button.
  Per-channel read markers can also move the start point forward
  (`replay_next_channel` prefers a marker newer than the cursor), so a
  channel read on another device replays less than the cursor asks for — by
  design, but worth remembering when a gap looks too small.
- **Cold start still trickles.** With the cursor accepted, channels the page
  holds nothing for are filled with the usual paced `CHATHISTORY LATEST`
  (one per 4 s) so a quiet channel is not empty on a fresh load. That is the
  one case the cursor does not make cheaper; a server-side "replay N latest
  per channel as well as the gap" option would.
- **Settings toggle for the hold** (`PERSISTENCE SET ON|OFF|DEFAULT`): today
  `/persistence set off` works raw and the reply is shown; a switch in the
  network settings would be the friendly place, with the STATUS shown next
  to it.
- **Restoration later than the 8 s cap.** Then the autojoin goes out anyway
  and, attached as an alias, the server answers with another topic + NAMES
  burst — now invisible and cheap, but still bytes. The clean fix is
  server-side: an explicit "resumed / restoring N channels" signal before
  the MOTD end (a `NOTE`, or the STATUS line saying so), or sending the
  restoration before 376 so a client can simply not JOIN. Worth raising
  with MrLenin with the WebSocket fixes.
- **Why two bursts at all** (resume, then alias attach) is worth asking
  about too: from the client's side one would do.
- **`no-implicit-names`**: `Channel.rejoining` is cleared by 366. If that
  cap is ever requested, clear it elsewhere (the batch end, or MARKREAD).
- **Lobby noise on every reconnect** (close report, "Reconnecting in…",
  MOTD, "Enabled capabilities…") is fine on a desktop and clutter on a
  phone; consider collapsing repeats or hiding the MOTD on a resume.
- **iOS**: `visibilitychange` is reliable there, `online` is not; verify on
  a device that the foreground poke is enough (it should be — the socket
  close is what matters and Safari reports it on return).
- The hold is what makes the background time cheap: messages while away
  live in CHATHISTORY and come back via the catch-up. Push notifications
  for that window are the open item in `notifications.md`.
