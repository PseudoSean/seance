# Seance as a Chrome PWA

What makes a Seance deploy installable from Chrome/Edge (desktop, Android,
ChromeOS), how the installed app behaves, and how to check a deploy. The
Electron and Capacitor shells (`shells/`) are separate; this is the
zero-install path where the network just hosts `public/`.

## Deploy requirements

Chrome's install criteria, and what satisfies them here:

| Requirement                                | Where it comes from                                                                                                                                                      |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Served from a secure context               | **Your job**: `https://` with a certificate the browser trusts. `http://localhost` also counts (dev). A self-signed cert blocks service-worker registration and install. |
| Web app manifest linked from the page      | `client/manifest.webmanifest` → `public/manifest.webmanifest`, `<link rel="manifest">` in `index.html`; `name`/`short_name`/colours filled from `config.json` at build   |
| `start_url`/`scope` inside the deploy path | Both `./`, relative to the manifest, so a deploy under `https://irc.example.org/chat/` scopes to `/chat/`                                                                |
| 192×192 and 512×512 PNG icons, purpose any | `img/logo-grey-bg-*.png`; the same 192/512 files are declared `maskable` separately (Chrome warns on the combined `"maskable any"`)                                      |
| `display` standalone/minimal-ui/fullscreen | `standalone`                                                                                                                                                             |
| A service worker (offline fallback)        | `client/service-worker.js`, registered by `client/js/pwa.ts` in any secure context. Chrome no longer strictly requires one to install, but the offline shell needs it    |

No server-side piece is needed. The static host must serve
`manifest.webmanifest` with a JSON content type (`application/manifest+json`
or `application/json`) — most do by extension; nginx needs
`types { application/manifest+json webmanifest; }` if it doesn't already.

`yarn build` without `NODE_ENV=production` is a **dev** build: the service
worker's cache name is `dev`, it caches nothing and never precaches, so the
app is installable but not offline-capable and no update is ever detected.
Ship `NODE_ENV=production corepack yarn build`.

## What the installed app does

- **One window.** The manifest's `launch_handler: {client_mode: "focus-existing"}`
  makes Chrome focus the running window for any later launch (taskbar/app
  icon, `web+irc://` link, `?uri=` URL) and hand the URL to
  `window.launchQueue`. `pwa.ts` feeds that into the same `handleQueryParams`
  path `boot.ts` uses for a fresh open, so a `web+irc://host/#chan` link joins
  the channel on an already-approved (saved) network — or opens the connect
  form pre-filled for approval — **without reloading** and dropping live IRC
  connections. Without this, every launch was a reload.
- **`web+irc:` links.** `protocol_handlers` in the manifest registers the app
  for the scheme at install time (Chrome asks once, on first use). The
  Settings → General "Open web+irc:// links with …" button is the pre-install
  equivalent (`navigator.registerProtocolHandler`) and still works in a tab.
  We deliberately do not claim `irc:`/`ircs:` — those name a TCP port we
  cannot dial, and a web app may only register `web+…` schemes of its own; see
  `irc-links.md`.
- **Install entry point.** Chrome shows its own install icon in the address
  bar; in addition, when `beforeinstallprompt` fires, `pwa.ts` sets
  `store.state.installPromptAvailable` and Settings → General shows
  "Install _App_ as an app". The button disappears once the prompt is shown
  or the app is installed (`appinstalled`).
- **Offline cold start.** On install the service worker precaches the shell:
  `index.html`, the manifest, `config.json`, the three JS bundles, `style.css`,
  the default theme, the FontAwesome woff2 and the splash logos. So an installed
  app launched with no connectivity still opens to the UI (saved networks show
  as disconnected and reconnect with backoff when the host comes back) instead
  of Chrome's error page. Runtime fetches are network-first with a cache
  fallback for everything else under the scope; WebSocket traffic never touches
  the worker.
- **Updates.** Every build carries a _build token_ (`resolveBuild` in
  `webpack.config.ts`: a hash of the version and the commit, so two builds of
  different commits never share one; a dirty tree or a checkout without git
  makes every build distinct): `?v=` on the asset URLs, the worker's cache
  name, and `process.env.SEANCE_BUILD` in the bundle (`client/js/build.ts`).
  A deploy is a byte-different `service-worker.js`, which the browser
  installs when it next looks: on a page load, or when the app asks —
  `pwa.ts` `checkForUpdate()`, from the foreground hooks (throttled to one
  check per five minutes) and hourly while a window stays open, because
  browsers never look on their own for a page that stays put. The new worker
  precaches its shell, `skipWaiting`s, deletes every cache from an older
  build (but never the translation engines' model caches —
  `transformers-cache` and `webllm/*`, see `docs/resources/translation.md`
  § Weights), claims every window and announces
  `{type: "build", build}` to them; a page whose own token differs commits
  `updateAvailable`, which lights the Help icon ("update available") and
  shows "Reload to update" at the top of Help. A page that has just loaded
  already runs the new bundle (runtime fetches are network-first) and its
  token matches, so it stays quiet — `controllerchange` alone could not tell
  the two apart. Installed windows have no reload button, hence the in-app
  one (Ctrl/Cmd+R also works). Browser check:
  `tools/scenarios/update-signal.mjs` (needs a production build). The
  per-network **push-only workers** (`push/<uuid>/`, see
  `client/js/webpush.ts`) get none of that for free: no navigation ever lands
  inside their scope, a push event re-checks the script at most once a day,
  and `register()` with the same URL checks nothing — so the page calls
  `registration.update()` on every stored network's registration as it boots
  (`syncStoredWithBrowser`) and whenever a subscribe reuses one
  (`ensureRegistration`). Browser check:
  `tools/scenarios/push-worker-update.mjs`.
- **Notifications.** In-page `Notification`s are routed through the worker
  (`socket-events/msg.ts` → `{type: "notification"}` → `showNotification`), so
  clicking one focuses the app window, or reopens it on `#/chan-<id>` if it was
  closed. Web Push (`draft/webpush`, the ircd holds the subscriptions) covers
  the app when it is closed or the OS has suspended its WebSocket — one
  push-only registration per network; see `docs/projects/push-subscription.md`
  and `push-per-network.md`.

## Verifying a deploy

```sh
NODE_ENV=production corepack yarn build
python3 -m http.server -d public 8000 &
node tools/pwa-check.mjs http://localhost:8000/
```

`pwa-check.mjs` launches headless Chromium, loads the page, and prints the
manifest parse errors, `Page.getInstallabilityErrors` (the same list DevTools
→ Application → Manifest shows), the service-worker state and any console
errors; exit code 1 if anything is wrong. Point it at the real host once
deployed (`--chrome=/path/to/chrome` if the binary is not `chromium`).

Manual: DevTools → Application → Manifest ("Installability" section) and →
Service workers. `chrome://web-app-internals` lists installed apps with their
resolved manifest, protocol handlers and launch handler.

## Not done / ideas

- `screenshots` (with `form_factor`) would give Chrome's richer install
  dialog; they are deploy-specific artwork, so a network adds them to its own
  `manifest.webmanifest` copy.
- No explicit manifest `id`: Chrome derives it from `start_url`, which is
  right per deploy path. Set one only if `start_url` must change later.
- `display_override: ["window-controls-overlay"]` (custom title bar on
  desktop) needs layout work in `App.vue`.
- Web Push (plan item D.11) needs a relay; see `client/js/webpush.ts`.
- Badging API (`navigator.setAppBadge`) for unread/mention counts on the
  taskbar icon.
