# Share images via paste.boxlabs.uk (like poxchat)

_Noted 2026-08-27. Status: **client done, blocked on the service's CORS
header** (see below). Related: `inline-media-preview.md` (the other half —
showing what was shared), `docs/resources/branding.md` § Uploads._

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

## Blocked: the service sends no CORS header

Checked 2026-08-28 against the live endpoint:

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
opaque `no-cors` response is useless. The service must add the header (`*`
is enough — the endpoint is anonymous and takes no cookies), and the
`OPTIONS` 405 only matters if we ever send a custom header. **Ask in
`#PASTE` on irc.afternet.org / boxlabss.** The same applies to self-hosted
PASTE instances; documented in `branding.md` § Uploads.

The probe above deliberately posted no file, so the check published nothing.
An end-to-end upload has therefore not been run against the live service.

## Still open

- **CORS on `paste.boxlabs.uk/img/`** — the blocker above.
- **Retention and privacy wording.** PASTE expires text pastes; image
  retention is unknown. A `uploads.notice` string for the network's own
  wording is unimplemented.
- **Video.** Refused cleanly rather than supported; whether PASTE would take
  `video/mp4`/`webm`, and at what size, is a question for boxlabs.
- **Progress.** `fetch` has no upload-progress event, so the bar is a busy
  indicator; video-sized files would want `XMLHttpRequest`.
