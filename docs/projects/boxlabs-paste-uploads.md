# Share images and video via paste.boxlabs.uk (like poxchat)

_Noted 2026-08-27. Status: idea, mostly configuration on top of the existing
uploader. Related: `inline-media-preview.md` (the other half — showing what
was shared), `docs/resources/branding.md` § Uploads._

## Idea

Let users paste/drop/pick an image or a video and have Seance upload it to
the paste.boxlabs.uk media staging service (the AfterNET-adjacent paste
site, [boxlabss/PASTE](https://github.com/boxlabss/PASTE)), then insert the
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

## What Seance has

`client/js/upload.ts` + `branding.uploads` (`docs/resources/branding.md`):
multipart POST to `uploads.endpoint`, field `uploads.fieldName` (default
`file`), optional `uploads.headers` / `withCredentials`, response either a
**top-level** JSON key (`uploads.responseUrlKey`, default `url`) or a
plain-text URL, relative URLs resolved against the endpoint,
`uploads.maxSizeBytes` (default 10 MiB), client-side EXIF strip via canvas
(`uploadCanvas` setting), paste/drop/file-picker wiring in `ChatInput.vue`.
The upload button is hidden when `uploads` is absent.

## Gap between the two

1. **Response shape.** boxlabs answers `results[0].filePath` (nested, with a
   `success` flag and `error`), which `responseUrlKey` cannot address. Add
   either a dotted/array path (`"responseUrlKey": "results.0.filePath"`) plus
   an optional `responseErrorKey`, or a named preset
   (`"uploads": {"preset": "boxlabs-paste"}`) that fills in endpoint, field
   name, keys and the `strip_exif` form field. A preset is friendlier for
   networks; the path syntax keeps the contract generic. Do both: preset
   expands to the generic fields.
2. **Extra form fields.** `strip_exif=1` needs a `uploads.fields` map
   (`{"strip_exif": "1"}`). Decide the interplay with the client-side canvas
   strip: canvas already removes EXIF (and re-encodes, losing GIF animation
   and alpha in JPEG), so with a server that strips, default `uploadCanvas`
   off for this preset; mirror poxchat's retry-without-strip on a strip
   error.
3. **CORS.** poxchat is native; the browser is not. `paste.boxlabs.uk/img/`
   must send `Access-Control-Allow-Origin` for the client's origin (or `*`)
   on the POST response, and answer the `OPTIONS` preflight (multipart POST
   with no custom headers is a "simple request", so only the response
   header is needed if we send no `X-*` headers). **Ask in `#PASTE` on
   irc.afternet.org / boxlabss** before building anything; without it the
   upload fails silently in every browser. Self-hosted PASTE instances need
   the same in their nginx/Apache config — document it.
4. **Video.** The user story says images _and_ movies. poxchat only sends
   image MIME types and the endpoint is `/img/`; whether PASTE accepts
   `video/mp4`/`webm` (and at what size — 10 MB is small for video) is an
   open question for boxlabs. If not, video needs a different target
   (the generic `uploads` contract already allows any endpoint).
5. **Naming and privacy.** Pasted screenshots get `pasted.png`; keep that.
   Warn once that uploads are public URLs on a third-party host and
   possibly retained indefinitely (PASTE has expiry for text pastes; image
   retention unknown). Optional `uploads.notice` string in branding for the
   network's own wording.
6. **Progress / cancel.** `upload.ts` supports `AbortSignal`; surface a
   progress bar for video-sized files (fetch has no upload progress —
   switch to `XMLHttpRequest` for the progress event, or accept a spinner).

## Done when

- `config.json` `"uploads": {"preset": "boxlabs-paste"}` (or the equivalent
  explicit fields) makes paste/drop/pick of an image upload to
  paste.boxlabs.uk and insert the absolute URL; errors from `results[0].error`
  are shown; strip-EXIF retry works; CORS confirmed with boxlabs and the
  needed server header documented in `branding.md`; video either works
  end-to-end or is explicitly refused with a clear message; unit tests for
  the response-path parsing and preset expansion (`test/client/` or a
  store-free `test/upload.ts`).
