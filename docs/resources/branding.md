# Branding a deploy

Seance is a static SPA: `yarn build` writes everything to `public/`, and an IRC network ships that directory as its own client. Two layers of branding exist:

| Layer          | Source                                 | Applied when    | Covers                                                                                                              |
| -------------- | -------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------- |
| **Runtime**    | `public/config.json` (fetched)         | Every page load | Everything the Vue app renders: title, connect-form defaults, help links, UI strings, feature flags, default theme  |
| **Build-time** | `client/config.json` (read by webpack) | `yarn build`    | `index.html` `<title>`, `application-name`, `theme-color`, the loading splash text, and the web app manifest fields |

Both read the **same file**: `client/config.json` is copied to `public/config.json` unchanged. A deploy that only edits `public/config.json` gets full runtime branding without rebuilding; the pre-JavaScript bits (browser tab title before boot, PWA manifest name, splash text) keep whatever was in `client/config.json` at build time. Rebuild (or overwrite those files, see below) to change them.

`client/js/branding.ts` owns the schema, defaults and loader. `boot.ts` awaits `loadBranding()` before anything renders, commits the result to `store.state.branding`, sets `document.title`, and folds `theme` / `themeColor` / `uploads` into the configuration.

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
  },
  "uploads": {
    "endpoint": "https://files.testnet.example/upload",
    "maxSizeBytes": 10485760
  }
}
```

Every field is optional; `{"appName": "Seance"}` (the shipped default) is a complete file. Unknown or malformed fields are dropped one by one and the rest still applies. A missing file, a 404 or invalid JSON falls back to the defaults with a single `console.warn`.

| Field                                  | Type                    | Default                            | Notes                                                                                                                                                               |
| -------------------------------------- | ----------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `appName`                              | string                  | `"Seance"`                         | Document title, About heading, "Add … to Home screen", notification/protocol-handler name, `<title>` at build time.                                                 |
| `shortName`                            | string                  | `appName`                          | Build time only: manifest `short_name`.                                                                                                                             |
| `description`                          | string                  | `"IRC client"`                     | Build time only: manifest `description`.                                                                                                                            |
| `defaultNetwork.name`                  | string                  | host                               | Label shown on the connect form when the host is locked.                                                                                                            |
| `defaultNetwork.host`                  | string                  | —                                  | Required for `defaultNetwork` to count; otherwise the whole object is ignored.                                                                                      |
| `defaultNetwork.port`                  | integer                 | 8443 / 8067 by `tls`               | 1–65535; strings are accepted.                                                                                                                                      |
| `defaultNetwork.tls`                   | boolean                 | `true`                             |                                                                                                                                                                     |
| `defaultNetwork.channels`              | string[]                | none                               | A comma-separated string also works. Names without a prefix get `#`.                                                                                                |
| `defaultNetwork.nick`                  | string                  | empty                              | Every `?` (or `%`, TheLounge style) becomes a random digit: `"guest????"` → `guest4821`.                                                                            |
| `defaultNetwork.lockHost`              | boolean                 | `false`                            | Hide the host/port/TLS fields; the form always connects to `defaultNetwork`.                                                                                        |
| `theme`                                | string                  | `"default"`                        | Must be a theme in the build (`default`, `morning`). Applies until the user picks a theme in Settings.                                                              |
| `themeColor`                           | `#rgb(a)`/`#rrggbb(aa)` | `#415364`                          | `<meta name="theme-color">`; build time also fills the manifest `theme_color` / `background_color`.                                                                 |
| `links.website` / `.help` / `.privacy` | `http(s)` URL           | the Seance repo, its `docs/`, none | Links in the Help window. Set `privacy` to add a "Privacy policy" link.                                                                                             |
| `features.multiNetwork`                | boolean                 | `true`                             | `false` hides the sidebar "connect" button once one network exists.                                                                                                 |
| `features.saveNetworks`                | boolean                 | `true`                             | `false` hides the saved-networks picker, "remember password" and "connect automatically" on the connect form (see follow-ups).                                      |
| `features.allowCustomServer`           | boolean                 | `true`                             | `false` behaves like `lockHost` and also ignores hosts from saved networks and `?host=` URL parameters. Requires `defaultNetwork`.                                  |
| `strings.<key>`                        | string                  | built-in copy                      | Keys: `connect.title`, `connect.savedNetworks`, `connect.savedNetworksEmpty`, `connect.submit`, `help.about`, `help.website`, `help.documentation`, `help.privacy`. |
| `uploads`                              | object                  | none (uploads off)                 | Network-provided file uploader; see [Uploads](#uploads). Dropped unless `endpoint` is an `https:` URL.                                                              |
| `uploads.endpoint`                     | `https` URL             | —                                  | Receives a multipart `POST` per file.                                                                                                                               |
| `uploads.maxSizeBytes`                 | integer                 | 10485760 (10 MiB)                  | Client-side limit; larger files are refused with "File … is over the maximum allowed size".                                                                         |
| `uploads.fieldName`                    | string                  | `"file"`                           | Multipart form field carrying the file.                                                                                                                             |
| `uploads.responseUrlKey`               | string                  | `"url"`                            | JSON key holding the public URL in the response.                                                                                                                    |
| `uploads.withCredentials`              | boolean                 | `false`                            | Send cookies with the request (`credentials: "include"`).                                                                                                           |
| `uploads.headers`                      | object of strings       | none                               | Extra request headers, e.g. `{"X-Api-Key": "…"}`. `Content-Type` is ignored: the browser sets the multipart boundary.                                               |

URL parameters (`?host=…&port=…&nick=…&join=…&autoconnect=1`, `?uri=irc://…`) still pre-fill the form and beat `defaultNetwork`, except for host/port/TLS when the host is locked.

## Uploads

Seance has no server of its own, so the file goes straight from the browser to an uploader the network runs. Files reach it by drag & drop anywhere on the page, by pasting an image into the input, or from the paperclip button. Running that service is the network's responsibility; Seance only needs it to honour this contract:

- **Request**: `POST` to `uploads.endpoint` with a `multipart/form-data` body whose `uploads.fieldName` field (default `file`) holds the file, filename included. Any `uploads.fields` are sent as extra form fields and any `uploads.headers` as headers; cookies only when `uploads.withCredentials` is `true`.
- **CORS**: the endpoint is on another origin, so its `POST` response must carry `Access-Control-Allow-Origin` for the app's origin (plus `Access-Control-Allow-Headers` for any custom headers, `Access-Control-Allow-Credentials: true` when cookies are used, and an `OPTIONS` answer when either of those makes the request non-simple). Without that header the browser blocks the response even though the upload itself succeeded, so the user sees "Upload failed: Failed to fetch".
- **Response**: `2xx` with either a JSON body holding the URL at `uploads.responseUrlKey` (default `url`) or a plain-text body that is the URL. Relative URLs resolve against the endpoint. The key may be a dotted path into nested objects and arrays, e.g. `results.0.filePath`. On failure, a non-`2xx` status or an error message at `uploads.responseErrorKey` (default `error`), which is shown to the user verbatim; otherwise "Upload failed: HTTP _status_".

The client checks `uploads.maxSizeBytes` before sending and refuses types outside `uploads.accept` (exact MIME types or `type/*` wildcards) without contacting the endpoint. The uploader should enforce its own limit, authentication and retention rules, since anyone with the app can call it. With `uploads` absent the upload button is hidden and dropped or pasted files are ignored after a single "File uploads are not configured in this client." notice.

`uploads.optionalFields` names fields that may be dropped for one retry when the uploader's error message blames them — the fallback that lets an upload through when the service cannot strip metadata off that particular file.

A minimal uploader is a few dozen lines (an nginx `client_body` handler script, or a small web function that writes to object storage and returns its URL); those recipes are out of scope here.

### Presets

`uploads.preset` fills in the wire details of a known service; anything given alongside it wins, so a deploy can point the same format at its own instance.

| Preset          | Service                                                                                                                                                                                                                                                                         |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `boxlabs-paste` | The anonymous image staging endpoint of [PASTE](https://github.com/boxlabss/PASTE), `https://paste.boxlabs.uk/img/` — the one [poxchat](https://github.com/boxlabss) uploads pasted images to. No API key (the documented `api.php` needs one, but it only covers text pastes). |

```json
{
  "appName": "ExampleNet",
  "uploads": {"preset": "boxlabs-paste"}
}
```

That expands to `images[]` as the file field, `strip_exif=1` as an extra field (dropped and retried once if the server says stripping is what failed), `results.0.filePath` / `results.0.error` as the response paths, a 10 MiB limit and PNG/JPEG/GIF/WebP as the accepted types. The endpoint is `/img/`: it takes images, not video, so a dropped video is refused with a message naming the types it does take.

> **`paste.boxlabs.uk/img/` does not send `Access-Control-Allow-Origin` today** (checked 2026-08-28: the `POST` response carries no CORS header and `OPTIONS` answers `405`). Until the operator adds it, uploads from a browser fail even though the file lands on the server. Nothing in the client can work around it — the response body is unreadable without it, and the URL is server-generated, so there is nothing to guess. Note that an API key is _not_ a workaround: `api.php` on the same host does send CORS headers, but it only handles text pastes, and CORS is orthogonal to authentication. Self-hosted PASTE instances that add their own `/img/` need the same header in their nginx or Apache config.

Because the service strips EXIF itself, the "Attempt to remove metadata from images before uploading" setting (which re-encodes through a canvas, and already skips GIF and SVG) is belt-and-braces with this preset rather than the only defence.

## Files a rebranded deploy overwrites in `public/`

`config.json` covers the app itself. Icons and the manifest are static files; replace them with your own after building (or before, in `client/`, so the build copies them):

- `manifest.webmanifest` — the build already fills `name`, `short_name`, `description`, `theme_color`, `background_color` from `client/config.json`. Overwrite it to change the icon list; keep `start_url`/`scope` (`./`), `launch_handler`, `protocol_handlers` and the separate `any`/`maskable` icon entries, which the installed-app behaviour depends on (see `pwa.md`). Keep the filename: `client/service-worker.js` precaches it by name and `index.html` links it.
- `favicon.ico` and `img/favicon-alerted.ico` (the red "unread" variant).
- `img/logo-grey-bg-120x120px.png`, `-152x152px.png`, `-167x167px.png`, `-180x180px.png`, `-192x192px.png`, `-512x512px.png`, `img/logo-grey-bg.svg` — manifest and Apple touch icons. The 192 and 512 files are also declared `maskable`: keep the artwork inside the central 80% and the background full-bleed so Android/ChromeOS can round or circle-crop them.
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
