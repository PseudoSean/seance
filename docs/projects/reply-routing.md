# Reply routing: replies come to the tab that asked (≈ the active tab)

_Spec agreed 2026-09-11 (audit + rubin's answers). Status: implemented
2026-09-11 (branch `feat/reply-routing`)._

## The contract

1. **A reply to a command shows where the user is.** Making a request and
   instantly switching tabs is rare, so "the tab the command was typed in"
   is approximated by the existing `showInActive` mechanism (the active tab,
   same network only; else lobby). `/whois`, `/map`, `/stats`, `/links`,
   `/topic #foo`, `/mode #foo`, `/away`, `/raw`, unknown-command
   passthrough — whatever comes back (numerics, standard replies, the raw
   `unhandled` rendering) follows the active tab. `/whois` stops
   opening/switching to a query window for the target.
2. **Unsolicited but personal traffic also follows the active window**
   (unchanged today): NOTICEs from users without a query window, incoming
   CTCP requests, WALLOPS, INVITEs to channels not open.
3. Join-burst quiet rules are untouched: unsolicited 332/324 from reattaches
   stay suppressed/routed to their channel as today (CLAUDE.md "Reconnects
   are quiet"). The special windows (`/list`, ban/invite/except lists,
   `/ignorelist`) keep their windows; only their error/empty fallbacks
   follow rule 1.

The stricter version — a `labeled-response` label per command with a
`{label → tab}` registry, exact asking-tab routing, and lobby-only for
server-volunteered FAIL/WARN/NOTE — was considered and parked; see
"Future: exact correlation" below. Nothing here paints us into a corner:
`showInActive` call sites are exactly where a label lookup would slot in.

## Why (audit findings, 2026-09-11)

There is no command→tab correlation anywhere: `Command.input()` gets
`ctx.chan` and nothing stores it, and `IrcClient.send()` sends unlabelled.
Routing is per-handler, and the gaps against the contract are:

- `unhandled` (`handlers/index.ts` ~L92-118): STATS/MAP/LINKS/INFO/ADMIN/
  TIME/VERSION/WHO/305/306/HELP etc. render raw into the **lobby** (first
  param looked up as a channel name, else lobby; **no `showInActive`**), so
  asked-for output hides in the lobby.
- `/whois` navigates: 318 pushes the summary into the target's query window,
  creating it with `shouldOpen: true` (`handlers/whois.ts` ~L134).
- 332/324 go to the named channel, gated by `Channel.topicAsked` /
  `modesAsked` — visibility flags only: `/topic #foo` typed elsewhere shows
  nothing when unchanged (the flag is only set by a bare `/topic`,
  `commands/topic.ts` ~L30), or shows in #foo, not where the user is. Same
  shape for `/mode #foo` (`commands/mode.ts` ~L71 sets the flag on the
  _named_ channel, but the 324 renders there, or is dropped when we are not
  in it, `handlers/mode.ts` ~L132).
- Already correct under this contract: `numericError` (lobby +
  `showInActive`, `handlers/numerics.ts` ~L134-171), standard replies
  default (`standard-replies.ts` ~L223), 432/433, 221, empty list
  fallbacks, WALLOPS/CTCP/NOTICE/INVITE (rule 2).

Known store wart, unchanged by this project: a `showInActive` message is
_stored_ in the channel the IRC layer chose (usually the lobby) and only
_displayed_ in the active tab, so a reload moves it back
(`socket-events/msg.ts` ~L38-60).

## Changes

- `handlers/index.ts` `unhandled`: set `showInActive: true` on the
  `MessageType.UNHANDLED` push. (Server-volunteered unknown numerics are
  rare enough that they may follow the active tab too.) `ACK` turned out to
  be handled already (`history.ts` exports an `ACK` handler that is silent
  for unknown and missing labels) — the audit's claim it printed raw was
  wrong.
- `handlers/whois.ts` `finish()`: push the whois summary to `client.lobby`
  with `showInActive: true`; never create/open a query window. (The failure
  path already does this.) Keep folding 301 into an open query.
- `commands/topic.ts`: the command grows a target — `/topic [#chan] [text]`
  (a first argument starting with a CHANTYPES prefix names the channel;
  query when no text follows). A query sets `topicAsked` on the named
  channel when open, else `client.markInfoAsked(name)` (a small
  casefolded-name set on the client, the `requestedJoins` pattern).
  `handlers/topic.ts`: an asked-for 332/331/333 pushes with
  `showInActive: true`; for a channel not in the list, an asked-for 332/331
  renders as plain text in the lobby + `showInActive`
  ("Topic for #x: …") and is otherwise dropped as before
  (`topicAskedActive` on `Channel` carries the flag from the 332 to its
  333). The unflagged join-burst path is unchanged.
- `commands/mode.ts` / `handlers/mode.ts`: same shape for `modesAsked`/324
  (`markInfoAsked` for a channel-typed name not in the list; the 324 then
  renders `MODE_CHANNEL` with the name in the text, lobby + `showInActive`,
  instead of being dropped).
- `handlers/away.ts`: 305/306 render as self `BACK`/`AWAY` messages with the
  server's own text, lobby + `showInActive`, instead of the raw `[305] …`.
- `docs/resources/bus-contract.md`: note the widened `showInActive` senders.

## Future: exact correlation (parked)

If instant tab-switching ever matters: mint `c<n>` labels in a
`client.sendAsked(line, chan)` used by `dispatchInput`, keep a
`{label → chanId}` registry with expiry, resolve it in the same places that
now set `showInActive`, and register a `labeled-response` batch handler —
today an unregistered batch type is unwrapped with the batch's `label`
discarded (`handlers/batch.ts` ~L103-122). Would need a probe of what
nefarious2 `ircv3.2-upgrade` actually labels (known: PRIVMSG echoes and
rejecting numerics, CHATHISTORY batches; unknown: everything else). The
`s<n>` (pending) and `h<n>` (chathistory) label namespaces are taken.

## Tests

- `test/irc/`: whois summary dispatches a `msg` on the lobby chan id with
  `showInActive`, and **no** `join` with `shouldOpen`; unhandled numerics
  carry `showInActive`; `/topic #foo` from another tab → 332 rendered with
  `showInActive` (and still suppressed without the flag when unchanged);
  `/mode #foo` when not in #foo → 324 rendered, not dropped; labelled `ACK`
  renders nothing. Update any tests pinning today's whois/unhandled routing.
- Browser: drive `/whois`, `/stats`, `/topic #other` from a channel tab and
  assert the replies render there; reload still shows them in the lobby
  (the known wart, not a regression).
