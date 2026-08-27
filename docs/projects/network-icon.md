# Network icon next to the server tab

_Noted 2026-08-27. Status: idea, not started._

## Idea

IRCv3 lets a network advertise an icon. Fetch it and show it small next to the
server-status (lobby) entry in the sidebar, in place of / alongside the
generic network icon.

## What we know

- Spec: [Network Icon](https://ircv3.net/specs/extensions/network-icon)
  (work-in-progress; [ircv3-specifications#563](https://github.com/ircv3/ircv3-specifications/pull/563)).
  The server sends an ISUPPORT token `draft/ICON=<url>`; the value MUST be an
  image URL, SHOULD be `https`. Draft software must use the `draft/ICON` name,
  never bare `ICON`.
- nefarious2's `ircv3.2-upgrade` branch already emits it (`s_user.c:3280-3316`
  on the branch; listed in `docs/resources/nefarious2-websocket.md` § ISUPPORT).
  Check what `tools/nefarious-dev/ircd.conf` needs to set to get a value.
- Client side: `client/js/irc/isupport.ts` (`ISupport.get("draft/ICON")`),
  exposed via `client.ts` `serverOptions` (~L270, where `NETWORK` is read) →
  `network:options` → `network.serverOptions` in the store
  (`socket-events/network.ts`). Rendered by `client/components/NetworkLobby.vue`
  (the lobby row) — `NetworkList.vue` wraps it.

## Design notes

- Treat it as a remote image: `<img>` with `referrerpolicy="no-referrer"`,
  fixed size (16 px), `alt=""`, fall back to the current icon on error / when
  the URL is not `https:` (or is `data:`?). Same privacy stance as link
  previews — consider gating on the existing "prefetch/preview" setting since
  it discloses the client's IP to whatever host serves the icon.
- Cache-friendly: nothing to do on our side; the browser caches by URL. Do not
  persist the URL in `thelounge.networks`; it is re-advertised on every connect.
- Could also feed the PWA notification `icon` for that network.

## Done when

- Dev ircd advertises `draft/ICON`, the lobby row shows it, a bad/missing
  URL degrades to today's look, unit test in `test/irc/` for the ISUPPORT →
  `serverOptions` plumbing.
