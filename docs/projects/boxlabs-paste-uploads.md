# Share images via paste.boxlabs.uk (like poxchat)

_Noted 2026-08-27. Status: **done 2026-09-10** — boxlabs added the CORS
header, an end-to-end upload was verified, and `boxlabs-paste` is now the
preset the stock `client/config.json` ships. Related: `inline-media-preview.md`
(the other half — showing what was shared), `docs/resources/branding.md`
§ Uploads._

## Idea

Let users paste/drop/pick an image and have Seance upload it to the
paste.boxlabs.uk media staging service (the AfterNET-adjacent paste site,
[boxlabss/PASTE](https://github.com/boxlabss/PASTE)), then insert the
resulting URL into the input — the way poxchat does today — so any network
can offer sharing without running its own uploader.

## How poxchat does it

`~/src/poxchat/src/common/image-upload.c` / `.h` (commit `ae4b312e`
"image-upload: upload pasted/dropped images and insert the link"):

- Endpoint pref `url_image_upload`, default **`https://paste.boxlabs.uk/img/`**;
  `url_image_upload_enable` (default on) and `url_image_strip_exif`
  (default on). Trigger: paste/drop of image data in the input
  (`fe-gtk/maingui.c` → `image_upload_bytes()`), file name like `pasted.png`.
- Request: `multipart/form-data` POST, file field **`images[]`** with the
  MIME type from the extension (png/jpeg/gif/webp only), optional form field
  **`strip_exif=1`**. 60 s timeout, follow redirects. Max
  **10 MB** (`IMAGE_UPLOAD_MAX_SIZE`, "matching the service limit").
- Response: JSON
  `{"results":[{"success":true,"filePath":"/img/img_xxx.png", ...}]}` or
  `{"results":[{"success":false,"error":"..."}]}`. `filePath` is usually
  **relative** and is resolved against the endpoint. If the server reports
  that EXIF stripping failed, poxchat retries once without `strip_exif`.
- On success the absolute URL is inserted at the cursor; on failure a
  message is shown. No auth / API key: the `/img/` staging endpoint is
  anonymous (the documented `api.php` JSON API is text pastes only and needs
  an `X-API-Key`; see https://paste.boxlabs.uk/api-docs.php — file uploads
  are not covered there).

## What landed

Drag & drop, clipboard paste and the file picker were already wired to the
generic uploader (`client/js/upload.ts`, `ChatInput.vue`); what was missing
was a configuration able to describe this service. `config.json`:

```json
{"uploads": {"preset": "boxlabs-paste"}}
```

`UPLOAD_PRESETS` in `client/js/branding.ts` expands that to the endpoint,
`images[]`, `strip_exif=1`, the `results.0.filePath` / `results.0.error`
response paths, 10 MiB and the four image types. Explicit keys alongside the
preset win, so a deploy can aim the same wire format at its own PASTE
instance. The generic additions that make it expressible:

- `uploads.responseUrlKey` / `responseErrorKey` accept **dotted paths**
  through objects and arrays (`results.0.filePath`). A literal top-level key
  is still tried first, so existing configs are unaffected.
- `uploads.fields` — extra multipart form fields.
- `uploads.optionalFields` — fields dropped for **one retry** when the
  uploader's error message names them by one of its words ("strip", "exif"),
  reproducing poxchat's EXIF fallback.
- `uploads.accept` — MIME allowlist (exact or `type/*`) checked before the
  request, so a dropped **video** is refused with a message naming the types
  the endpoint does take. `/img/` is images-only; video needs a different
  target, which the generic contract already allows.

Tests: `test/irc/upload.ts` (preset request shape, nested response parsing,
the strip retry and its non-retry cases, the video refusal, path lookup) and
`test/irc/branding.ts` (preset expansion, overrides, aliasing, validation).

## Was blocked: `/img/` sent no CORS header (fixed 2026-09-10)

Checked 2026-08-28 against the live service, the image endpoint answered
without a CORS header:

```console
$ curl -i -X POST https://paste.boxlabs.uk/img/ -H 'Origin: https://chat.example.com' -F dummy=1
HTTP/2 200
server: nginx
content-type: application/json
… no access-control-allow-origin …
{"results":[{"success":false,"error":"No files received or upload exceeded server limits."}]}

$ curl -i -X OPTIONS https://paste.boxlabs.uk/img/ -H 'Origin: …' -H 'Access-Control-Request-Method: POST'
HTTP/2 405
```

The response shape matches poxchat exactly, so the client side is right. But
a multipart `POST` from a browser is a _simple request_ — no preflight is
sent, the request goes through, the file lands — and then the browser
**blocks the response** because it carries no `Access-Control-Allow-Origin`.
`fetch` rejects with "Failed to fetch" and the client never sees `filePath`.
poxchat is native and so never hits this.

Nothing in the client can work around it: the URL is server-generated, so an
opaque `no-cors` response is useless, and there is nothing to guess.

### An API key is not the fix

The tempting conclusion is "use the documented API instead". It does not
help, for two independent reasons:

1. **`api.php` cannot take images.** Its actions are `create`, `paste`,
   `get`, `update`, `delete`, `list`, `search`, `languages`, `me`, `user` —
   all text pastes, `content` is a string. The 659-line source contains no
   reference to `$_FILES`, `multipart`, `upload` or `image`.
2. **CORS is orthogonal to authentication.** A key would not make a response
   readable; only the response header does. Sending `X-API-Key` would in
   fact make the request non-simple and add a preflight, which `/img/`
   answers with `405`.

What the API _does_ prove is that the operator already does this correctly
elsewhere — `api.php` lines 25-27:

```php
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-API-Key');
```

So the ask is small and well-precedented: **send the same
`Access-Control-Allow-Origin: *` from `/img/`.** `*` suffices — the endpoint
is anonymous and takes no cookies — and nothing else needs to change,
because our request is simple and never triggers a preflight.

Worth noting for whoever asks: `/img/` is **not** in upstream
[boxlabss/PASTE](https://github.com/boxlabss/PASTE) at all (the repo has no
image upload handler), so it is boxlabs' own addition and they hold the
source. **Ask in `#PASTE` on irc.afternet.org / boxlabss.** Self-hosted PASTE
instances that add their own `/img/` need the same header; documented in
`branding.md` § Uploads.

### Fixed, and more than was asked (2026-09-10)

The operator did both halves. Re-probed:

```console
$ curl -i -X POST https://paste.boxlabs.uk/img/ -H 'Origin: https://evilnet.github.io' -F dummy=1
HTTP/2 200
access-control-allow-origin: *
access-control-allow-methods: GET, POST, OPTIONS
access-control-allow-headers: *

$ curl -i -X OPTIONS https://paste.boxlabs.uk/img/ -H 'Origin: …' -H 'Access-Control-Request-Method: POST'
HTTP/2 204
… same three headers …
```

The `204` on `OPTIONS` was not part of the ask and is worth more than it
looks: an XHR carrying an upload-progress listener is never a simple request,
so litterbox's `405` costs us the percentage (`progress: false` on that
preset). boxlabs answers the preflight, so `boxlabs-paste` gets a **real
percentage** in the upload strip with no preset change. No
`Access-Control-Max-Age`, so the preflight repeats on the browser's default
cache — one extra round trip per upload, not worth asking about.

End-to-end, with a 70-byte 1×1 transparent PNG (the earlier probes posted no
file at all, so nothing had ever been published):

```console
$ curl -X POST https://paste.boxlabs.uk/img/ -F 'images[]=@px.png;type=image/png' -F 'strip_exif=1'
{"results":[{"success":true,"name":"px.png","filePath":"\/img\/img_6aa2e34ad3f60.png","type":"image","size":95}]}
```

So the shape inferred from poxchat's source is exactly right: `filePath` is
relative and `new URL(filePath, endpoint)` in `resolveUploadUrl` gives
`https://paste.boxlabs.uk/img/img_6aa2e34ad3f60.png`, which serves as
`image/png` with `Access-Control-Allow-Origin: *` of its own — so inline
media preview can read it too. `size: 95` against a 70-byte input confirms
`strip_exif=1` re-encodes rather than being ignored.

`client/config.json` now ships `{"uploads": {"preset": "boxlabs-paste"}}`.

### The preset was wrong about video

Written from poxchat's source, which sends PNG/JPEG/GIF/WebP only, the preset
refused video locally with "not a type this uploader accepts". The service
takes it. Probed 2026-09-10, one 70-byte file per extension:

| Extension                            | Result                                            |
| ------------------------------------ | ------------------------------------------------- |
| `.png` `.jpg` `.jpeg` `.gif` `.webp` | stored as `img_*`, `"type":"image"`               |
| `.mp4` `.mov` `.webm` `.avi` `.mkv`  | stored as `vid_*`, `"type":"video"`               |
| `.m4v` `.avif` `.ogg` `.wav` `.txt`  | `{"success":false,"error":"Unsupported type .x"}` |
| no extension                         | `"Unsupported type ."`                            |

Which matches what the upload page states in as many words: **"Images (JPG,
PNG, GIF, WEBP) up to 10MB / Videos (MP4, MOV, WEBM, AVI, MKV) up to 25MB"**.
Its own `<input>` carries `accept="image/*,video/*"`.

Two things the probe settled that the page does not say:

- **The gate is the extension, not the declared type.** A PNG sent as
  `video/mp4` was stored as an image; matching is case-insensitive (`.JPG`,
  `.MP4` both fine). Our `accept` list is MIME-shaped, so it is an
  approximation of an extension list and the two disagree at the edges — a
  `.mkv` whose browser reports no type is refused by us though the service
  would take it. The service's message is shown verbatim the other way round.
- **The 25 MB cap is the app's, not nginx's.** A body large enough to be
  refused is never stored, so the outer envelope could be measured for free
  by sending oversized files under a rejected extension: 12 MiB and 48 MiB of
  zeros named `.txt` both came back "Unsupported type .txt", 64 MiB got
  nginx's `413`. So `client_max_body_size` is somewhere in 48–64 MiB and the
  25 MB figure is enforced above it, by PASTE itself.

`uploads.maxSizeBytes` is one number where the service has two, so the preset
carries the **video** figure (25 MiB): a 12 MB video the service would take
must not be refused locally, and an oversized image gets the service's own
error instead of ours. A deploy sharing mostly screenshots can set 10 MiB and
get the local refusal back.

The trade against the previous default is now much narrower: litterbox still
takes a gigabyte where boxlabs takes 25 MB, but boxlabs keeps what it stores
instead of deleting it within 72 h, and strips EXIF server-side.

## Survey: which services work from a browser at all

Probed 2026-08-28 with a POST carrying an `Origin` header and no file, so
nothing was published. The only question that matters is whether the
**response** carries `Access-Control-Allow-Origin` — without it the upload
succeeds and the browser throws the answer away. Features, limits and API
keys are all secondary to that.

| Service                               | CORS          | Notes                                                                                                                                                                       |
| ------------------------------------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **litterbox.catbox.moe**              | **yes** (`*`) | Anonymous, no key. Plain-text URL. Images **and video**, 1 GB. Expires in 1h–72h. → preset `catbox-litterbox`                                                               |
| **tmpfiles.org**                      | **yes** (`*`) | JSON, preflight answered. But returns a _viewer page_ URL; the direct link needs `/dl/` spliced in, which the contract cannot express today. ~1 h retention, `http:` links. |
| **kappa.lol**                         | **yes** (`*`) | JSON, full preflight. Response shape unverified.                                                                                                                            |
| **paste.boxlabs.uk/img**              | **yes** (`*`) | Since 2026-09-10, preflight answered too. Images to 10 MB and video to 25 MB, permanent, strips EXIF. → preset `boxlabs-paste`, and the stock config's default              |
| catbox.moe (permanent)                | no            | Same operator as litterbox, but the permanent endpoint omits the header.                                                                                                    |
| uguu.se                               | no            | JSON error shape is fine; no header.                                                                                                                                        |
| 0x0.st                                | no            | Also returns `503`: uploads disabled indefinitely ("AI botnet spam").                                                                                                       |
| x0.at, envs.sh, file.io, pomf.lain.la | no            | —                                                                                                                                                                           |

So the practical set is two services — `boxlabs-paste` (the default) and
`catbox-litterbox` (bigger files, at the price of 72 h retention) — plus two
candidates that would need small features (a URL rewrite for tmpfiles) or
verification (kappa.lol). Note that litterbox is _temporary_ storage: good
for privacy, bad for scrollback, and worth saying out loud in a deploy's
own wording.

## The IRC-native alternative: `FILEHOST`

Worth knowing before adding more third-party presets. soju advertises an
upload endpoint through ISUPPORT as `soju.im/FILEHOST`, and goguma uses it
(`~/src/goguma/lib/irc/isupport.dart:48`,
`lib/widget/composer.dart:500-560`): `POST` the raw file body — not
multipart — with `Content-Type` and `Content-Disposition: attachment; filename=…`, expect **201** and read the URL from the `Location` response
header, resolved against the filehost URL. Auth is HTTP Basic reusing the
SASL PLAIN credentials.

That fits Seance far better than any third party: zero configuration, the
network names its own uploader, and the file never leaves the network's
control. Two caveats: nefarious2 does not advertise the token today (EvilNet
controls the ircd, so it could), and reading `Location` cross-origin needs
`Access-Control-Expose-Headers: Location` on top of the usual header — the
same class of server-side requirement, just better specified.

Supporting it means reading ISUPPORT, a raw-body request mode and a
header-sourced URL, none of which the current `uploads` contract has. A
separate piece of work, not a preset.

## Still open

- **Browser check.** The end-to-end run above was curl, and curl is not a
  browser: nothing has yet dropped an image into a real Chromium against
  this endpoint and watched the percentage move. `tools/scenarios/` has no
  upload scenario at all.
- **Retention and privacy wording.** PASTE expires text pastes; image
  retention is stated as indefinite but is not documented anywhere we
  control. A `uploads.notice` string for the network's own wording is
  unimplemented.
- **One size limit for two kinds.** The contract's `maxSizeBytes` cannot say
  "10 MB of image, 25 MB of video", so an oversized image spends the upload
  before the service refuses it. A per-type limit is a small schema addition
  if this turns out to annoy anyone.
- **`accept` is MIME where the service is extensions.** A file whose type the
  browser does not recognise (`.mkv` on some platforms reports an empty
  `File.type`) is refused locally though the service would take it. Matching
  on the extension as well as the type would close the gap.
