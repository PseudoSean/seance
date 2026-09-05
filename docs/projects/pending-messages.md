# Pending outgoing messages

_Started 2026-09-04 on the `pending-messages` branch (from `origin/develop`
at `3bdb536`). Status: **implemented**; this file records the decisions and
what was verified, so the PR can be read without the session._

Spec: `docs/resources/bus-contract.md` § 1.9. Vocabulary: `CONTEXT.md`
§ Sending ("pending copy", "settled").

## The problem

With `echo-message` the server, not the client, produces the copy of a sent
message that goes into the timeline. `IrcClient.sendMessage` therefore showed
nothing until the echo came back — on a quiet link a few milliseconds, behind
fake lag or a bad connection whole seconds of "did that go?". Without the cap
the client re-injects a synthetic echo and the message shows at once, so the
gap only existed on servers that do the right thing.

## What was built

- **A pending copy** (`client/js/irc/pending.ts`): the moment a line is on
  the wire, an ordinary `msg` with `msg.pending: true` goes to the store,
  dispatched directly rather than through `pushMessage` (no read marker, no
  history total, no catch-up reference for a line the server has not taken).
  `Message.vue` puts `pending` on the row; `style.css` fades it with
  `opacity: 0.55`, which reads the same on both themes and needs no new
  variable. No msgid, so no hover toolbar.
- **Settlement** (`msg:settled {chan, id}`): the store drops the copy, and
  the `msg` that settles it follows in the same tick — the echo, or an ERROR
  line `Not sent (<reason>): <text>` for a rejection numeric, 60 s of silence
  (`PENDING_TIMEOUT_MS`; fake lag can hold a burst that long) or the
  connection closing. A labelled `ACK` and a multiline `FAIL` settle silently
  (the `FAIL` is already reported once).
- **The bottom slot** (`helpers/messageUpdates.ts` `insertMessage`): copies
  are a trailing block of `channel.messages`, and every other message is
  inserted ahead of that block. Since the echo lands after everything that
  reached us before it, the copy already occupies the slot the echo will
  take, and the swap is visually in place — "always at the bottom" and
  "replaced in its correct location" turn out to be the same rule.
- **Multiline** (`multiline.ts`): each batch of a plan shows its copy when
  queued (to the user they are one message), labelled on its opener, armed
  for the timeout when it actually goes out, re-armed on a cooldown re-send.

## The correlation key

Nothing tied an outgoing line to its echo before this. `labeled-response`
was already requested but only used for `CHATHISTORY`. Probed 2026-09-04
against the testnet ircd (nefarious2 `ircv3.2-upgrade`, `u2.10.12.14+Nefarious(2.0.0)`):

```
>> @label=p1 PRIVMSG #lblprobe :labeled privmsg
<< @label=p1;msgid=BjAAAaBrWgwjO4;time=… :lblprobe!… PRIVMSG #lblprobe :labeled privmsg
>> @label=p2 NOTICE #lblprobe :labeled notice
<< @label=p2;msgid=…;time=… :lblprobe!… NOTICE #lblprobe :labeled notice
>> @label=p3 PRIVMSG #lblprobe :\x01ACTION waves\x01
<< @label=p3;msgid=…;time=… :lblprobe!… PRIVMSG #lblprobe :\x01ACTION waves\x01
>> @label=p4 PRIVMSG #notjoined :not joined
<< @label=p4;time=… :irc.testnet.local 403 lblprobe #notjoined :No such channel
>> @label=p5 PRIVMSG nosuchnick12345 :no such nick
<< @label=p5;time=… :irc.testnet.local 401 lblprobe nosuchnick12345 :No such nick
>> @label=p6;+draft/reply=abc PRIVMSG #lblprobe :with a client tag
<< @+draft/reply=abc;msgid=…;label=p6;time=… :lblprobe!… PRIVMSG #lblprobe :with a client tag
>> @label=m1 BATCH +b1 draft/multiline #lblprobe2
>> @batch=b1 PRIVMSG #lblprobe2 :line one
>> @batch=b1 PRIVMSG #lblprobe2 :line two
>> BATCH -b1
<< @label=m1;time=…;msgid=… :lblprobe2!… BATCH +Bj1452850520 draft/multiline #lblprobe2
<< @batch=Bj1452850520 :lblprobe2!… PRIVMSG #lblprobe2 :line one
…
>> MODE #lblprobe2 +c
>> @label=c1 PRIVMSG #lblprobe2 :\x02bold\x02 and \x0304red\x03 text
<< @label=c1;time=… :irc.testnet.local 404 lblprobe2 #lblprobe2 :Cannot send to channel
```

So the label comes back on the echo, on the multiline batch opener and on
the numeric that rejects the line, which makes every outcome of a labelled
send attributable. Every outgoing PRIVMSG / NOTICE and multiline opener now
carries `@label=s<n>` when both caps are on (`sendMessage` budgets
`LABEL_TAG_BYTES` for it), and an unlabelled message of ours is another
session of the account speaking, which settles nothing. Without
`labeled-response` the fallback takes the oldest copy of the same kind in
the channel, an exact text match first.

## Decisions

- **Fresh id for the echo, not the copy's.** Reusing the copy's id would keep
  the DOM node (and allow a fade transition) but break the "ids increase
  with time" assumption `ids.ts` documents for the unread marker and the
  `more` cursor. The row re-mounts with the same text; nothing moves.
- **Error line, not a "failed" row.** A rejected or unacknowledged copy
  becomes an ERROR message carrying the text, which is the pattern edits
  already use and needs no new rendering. A retry affordance is a possible
  follow-up.
- **Silence for the multiline `FAIL`.** `multilineFailed` already reports
  it once, where it was typed; a second line per copy would be noise. On a
  close `IrcClient.onClose` reports every copy ("connection lost") before
  `resetMultiline` runs, so those are not silent.
- **The label is a fast path, not a requirement** (fixed 2026-09-04). The
  first cut settled a copy _only_ by the echoed `@label` when
  `labeled-response` was negotiated. nefarious2 relays that label, but the
  spec does not oblige a server to carry it on the propagated echo-message
  copy, and a server that drops it left every copy stuck faded next to the
  real message that had already loaded — the reported bug. `settleEcho` now
  matches by label first and then by content: the oldest unsettled copy of
  the same kind whose text is an exact match. Only copies we are holding are
  candidates, so the same account speaking from another device (a self echo
  with no matching copy) settles nothing and shows as a line. Reproduced and
  fixed with `tools/scenarios/pending-no-label.mjs`, which strips
  `label=s<n>` from inbound frames to stand in for such a server.

## Verified

- `yarn test`: the full mocha run, including `test/irc/pending.ts` (the
  label-fast-path, the content fallback, and a same-account-other-device
  case) and `test/helpers/messageUpdates.ts`; the wire-line expectations
  that pin an outgoing PRIVMSG / NOTICE carry the `@label=s<n>` prefix.
- `tools/scenarios/pending-messages.mjs` in headless Chromium against the
  testnet ircd: an eight-message burst with the echo of the last four held
  back 3 s inside the page — all eight rows at once, the slow half faded
  (`opacity 0.55`) at the bottom, a second user's line landing above the
  block, every copy replaced exactly once, in order, at full opacity, no
  console errors. (The server itself echoed the whole burst within 400 ms;
  fake lag did not hold anything on this rig, hence the shim.)
- `tools/scenarios/pending-no-label.mjs` in headless Chromium: with
  `label=s<n>` stripped from inbound frames (a server that does not relay
  it), the copy still settles by content — one opaque self row, the echo
  confirmed to have reached the app without the label. Against the same
  build before the fix this scenario shows the bug: the faded copy and the
  loaded message side by side.

## Follow-ups

- A retry action on the "Not sent" line, or keeping a failed copy in place
  with a marker, if the error line proves too easy to miss.
- The `/msg nick` case: a pending copy for a query that is not open yet
  would need the query announced before the echo, which is a behaviour
  change on its own.
