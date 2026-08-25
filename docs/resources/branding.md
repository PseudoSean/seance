# Branding a deploy

Seance is a static SPA: `yarn build` writes everything to `public/`, and an IRC network ships that directory as its own client. Two layers of branding exist:

| Layer          | Source                                 | Applied when    | Covers                                                                                                              |
| -------------- | -------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------- |
| **Runtime**    | `public/config.json` (fetched)         | Every page load | Everything the Vue app renders: title, connect-form defaults, help links, UI strings, feature flags, default theme  |
| **Build-time** | `client/config.json` (read by webpack) | `yarn build`    | `index.html` `<title>`, `application-name`, `theme-color`, the loading splash text, and the web app manifest fields |

Both read the **same file**: `client/config.json` is copied to `public/config.json` unchanged. A deploy that only edits `public/config.json` gets full runtime branding without rebuilding; the pre-JavaScript bits (browser tab title before boot, PWA manifest name, splash text) keep whatever was in `client/config.json` at build time. Rebuild (or overwrite those files, see below) to change them.

`client/js/branding.ts` owns the schema, defaults and loader. `boot.ts` awaits `loadBranding()` before anything renders, commits the result to `store.state.branding`, sets `document.title`, and folds `theme` / `themeColor` into the configuration.

## `config.json` schema

```json
{
  "appName": "TestNet IRC",
  "shortName": "TestNet",
  "description": "Chat on TestNet from your browser",
  "defaultNetwork": {
    "name": "TestNet",
    "host": "irc.testnet.example",
    "port": 8443,
    "tls": true,
    "channels": ["#lobby", "#help"],
    "nick": "guest????",
    "lockHost": true
  },
  "theme": "morning",
  "themeColor": "#1d3557",
  "links": {
    "website": "https://testnet.example/",
    "help": "https://testnet.example/help",
    "privacy": "https://testnet.example/privacy"
  },
  "features": {
    "multiNetwork": false,
    "saveNetworks": true,
    "allowCustomServer": false
  },
  "strings": {
    "connect.title": "Join TestNet",
    "connect.submit": "Join"
  }
}
```

Every field is optional; `{"appName": "Seance"}` (the shipped default) is a complete file. Unknown or malformed fields are dropped one by one and the rest still applies. A missing file, a 404 or invalid JSON falls back to the defaults with a single `console.warn`.

| Field                                  | Type                    | Default                                   | Notes                                                                                                                                                               |
| -------------------------------------- | ----------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `appName`                              | string                  | `"Seance"`                                | Document title, About heading, "Add … to Home screen", notification/protocol-handler name, `<title>` at build time.                                                 |
| `shortName`                            | string                  | `appName`                                 | Build time only: manifest `short_name`.                                                                                                                             |
| `description`                          | string                  | `"IRC client"`                            | Build time only: manifest `description`.                                                                                                                            |
| `defaultNetwork.name`                  | string                  | host                                      | Label shown on the connect form when the host is locked.                                                                                                            |
| `defaultNetwork.host`                  | string                  | —                                         | Required for `defaultNetwork` to count; otherwise the whole object is ignored.                                                                                      |
| `defaultNetwork.port`                  | integer                 | 8443 / 8067 by `tls`                      | 1–65535; strings are accepted.                                                                                                                                      |
| `defaultNetwork.tls`                   | boolean                 | `true`                                    |                                                                                                                                                                     |
| `defaultNetwork.channels`              | string[]                | none                                      | A comma-separated string also works. Names without a prefix get `#`.                                                                                                |
| `defaultNetwork.nick`                  | string                  | empty                                     | Every `?` (or `%`, TheLounge style) becomes a random digit: `"guest????"` → `guest4821`.                                                                            |
| `defaultNetwork.lockHost`              | boolean                 | `false`                                   | Hide the host/port/TLS fields; the form always connects to `defaultNetwork`.                                                                                        |
| `theme`                                | string                  | `"default"`                               | Must be a theme in the build (`default`, `morning`). Applies until the user picks a theme in Settings.                                                              |
| `themeColor`                           | `#rgb(a)`/`#rrggbb(aa)` | `#415364`                                 | `<meta name="theme-color">`; build time also fills the manifest `theme_color` / `background_color`.                                                                 |
| `links.website` / `.help` / `.privacy` | `http(s)` URL           | thelounge.chat, thelounge.chat/docs, none | Links in the Help window. Set `privacy` to add a "Privacy policy" link.                                                                                             |
| `features.multiNetwork`                | boolean                 | `true`                                    | `false` hides the sidebar "connect" button once one network exists.                                                                                                 |
| `features.saveNetworks`                | boolean                 | `true`                                    | `false` hides the saved-networks picker, "remember password" and "connect automatically" on the connect form (see follow-ups).                                      |
| `features.allowCustomServer`           | boolean                 | `true`                                    | `false` behaves like `lockHost` and also ignores hosts from saved networks and `?host=` URL parameters. Requires `defaultNetwork`.                                  |
| `strings.<key>`                        | string                  | built-in copy                             | Keys: `connect.title`, `connect.savedNetworks`, `connect.savedNetworksEmpty`, `connect.submit`, `help.about`, `help.website`, `help.documentation`, `help.privacy`. |

URL parameters (`?host=…&port=…&nick=…&join=…&autoconnect=1`, `?uri=irc://…`) still pre-fill the form and beat `defaultNetwork`, except for host/port/TLS when the host is locked.

## Files a rebranded deploy overwrites in `public/`

`config.json` covers the app itself. Icons and the manifest are static files; replace them with your own after building (or before, in `client/`, so the build copies them):

- `thelounge.webmanifest` — the build already fills `name`, `short_name`, `description`, `theme_color`, `background_color` from `client/config.json`. Overwrite it to change the icon list. Keep the filename: `client/service-worker.js` precaches it by name and `index.html` links it.
- `favicon.ico` and `img/favicon-alerted.ico` (the red "unread" variant).
- `img/logo-grey-bg-120x120px.png`, `-152x152px.png`, `-167x167px.png`, `-180x180px.png`, `-192x192px.png`, `-512x512px.png`, `img/logo-grey-bg.svg` — manifest and Apple touch icons.
- `img/logo-transparent-bg.svg`, `img/logo-transparent-bg-inverted.svg`, `img/logo-horizontal-transparent-bg.svg`, `img/logo-horizontal-transparent-bg-inverted.svg` — the sidebar logo.
- `img/logo-vertical-transparent-bg.svg`, `img/logo-vertical-transparent-bg-inverted.svg` — the loading splash.
- `img/icon-black-transparent-bg.svg` — Safari pinned-tab icon.

`index.html` also hard-codes `msapplication-TileColor` and the `mask-icon` colour (`#415364`); edit `client/index.html` if those matter to you.

## Subpath deploys

`config.json` is resolved relative to the document (`new URL("config.json", document.baseURI)`), so serving from `https://host/chat/` or through a `<base href>` works as long as the file sits next to `index.html`. The service worker treats it like any other same-origin asset (network first, cache fallback), so the last fetched copy is still used offline.

## Follow-ups

- **localStorage keys** still use the `thelounge.*` prefix (`thelounge.networks`, `thelounge.mentions`, `thelounge.sort.*`, `thelounge.state.*`, `thelounge.ignore.*`, `thelounge.muted`, `thelounge.networks.collapsed`, and `settings`). They are deliberately untouched: renaming them would drop every user's saved networks and settings. A rename needs a one-off migration.
- `features.saveNetworks: false` hides the saved-network UI, but `client/js/irc/manager.ts` still records the last-used network in localStorage. Make persistence conditional there.
- The Changelog window still says "based on The Lounge x.y.z" on purpose (upstream attribution); the "Report an issue" link in Help still points at the upstream tracker.
- Native shells (E.4) can call `setBranding()` from `client/js/branding.ts` instead of fetching, if they bundle the config.
