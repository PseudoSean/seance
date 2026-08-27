# "Connecting…" indicator stays on after cancelling by other means

_Noted 2026-08-27. Status: bug, not yet reproduced/diagnosed._

## Symptom

The red "Connecting… (click to cancel)" state on the server (lobby) row in the
sidebar only clears when the connection attempt is cancelled by clicking that
row. Cancelling any other way leaves it showing.

## Where to look

- The row: `client/components/NetworkLobby.vue` ~L90-115 — `is-connecting`
  class and label come from `network.status.connecting`; clicking sends
  `/disconnect` through the `input` bus event.
- The state: `network.status.connecting` is set only by the `network:status`
  bus event (`client/js/socket-events/network.ts` L35-51; contract in
  `docs/resources/bus-contract.md` § `network:status`). The IRC layer dispatches
  it from `client/js/irc/client.ts` at ~L340 (`connect()`, `connecting: true`),
  ~L371 (registered, `false`), ~L738 (socket closed, `connecting: willReconnect`)
  and ~L796 (`disconnect()`, `false`).
- Other ways to stop an attempt, each a candidate for a missing
  `network:status {connecting: false}`:
  - "Cancel" in the network edit form (`client/components/NetworkForm.vue`
    ~L383; `Windows/NetworkEdit.vue`) and the connect form's own status row
    (`Windows/Connect.vue` ~L474-480).
  - `/disconnect` or `/quit` typed in a channel that is not the lobby (does
    `commands/` route it to the same `IrcClient.disconnect()`?).
  - Removing the network (`network:remove` / `removeNetwork` mutation) while
    it is still dialling — the client object may keep retrying and re-dispatch.
  - The reconnect-backoff wait: `connecting: willReconnect` is deliberately
    `true` while waiting for the retry (see the 0e572a59 / b25e22be commits),
    so "cancel" must also cancel the pending timer, not only the socket.
  - The transport's own reconnect (`client/js/irc/transport.ts`) resuming
    after a `disconnect()` that raced a close event.

## Plan

1. Reproduce with the dev ircd stopped (`docker stop nefarious-dev`) so the
   attempt hangs: try each cancel path above, note which leave the row red.
2. Make `IrcClient.disconnect()` the single cancel path and have every UI
   route call it; it should always end with `network:status {connected:false, connecting:false}` and clear any retry timer.
3. Unit test in `test/irc/` (FakeTransport + `sinon.spy(socket, "dispatch")`,
   see `test/irc/client.ts` for the pattern): connect → cancel via each
   route → last `network:status` has `connecting: false`.
