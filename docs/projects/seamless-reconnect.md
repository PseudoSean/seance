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

## Follow-ups

- **Settings toggle for the hold** (`PERSISTENCE SET ON|OFF|DEFAULT`): today
  `/persistence set off` works raw and the reply is shown; a switch in the
  network settings would be the friendly place, with the STATUS shown next
  to it.
- **Batch later than 1 s after the MOTD.** Then the JOIN goes out anyway
  and, attached as an alias, the duplicate topic/NAMES burst is back
  (cosmetic; state stays right). The clean fix is server-side: an explicit
  "resumed" signal before the MOTD end (a `NOTE` or the STATUS line saying
  so), or sending the restoration batch before 376. Worth raising with
  MrLenin with the WebSocket fixes.
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
