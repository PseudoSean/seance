# Client-side translation

Seance translates on the user's device: no server, no translation API. This
file is the reference for the engine layer (`client/js/translate/`); the
design is `docs/projects/client-translation.md` and the deploy knobs are
`docs/resources/branding.md` § Translation.

## Two engines, one router

- **GPU: WebLLM.** An instruction LLM (default `Qwen3-1.7B-q4f16_1-MLC`)
  on WebGPU, prompted to translate with the channel's context. Greedy at
  temperature 0.1, thinking off, one line of output. Needs an adapter with
  `shader-f16` and 1 GiB of buffer, WebLLM's floor for a q4f16 model; adapters report 2 GiB minus alignment slack (`capability.ts`).
- **CPU: transformers.js on ONNX Runtime WASM.** Purpose-built translation
  models: NLLB-200 distilled 600M (any pair, FLORES codes) and OPUS-MT pair
  models (30-80 MB each). Two stay loaded, least recently used evicted.
  Several times faster with WASM threads, which need the cross-origin
  isolation headers (branding.md).
- **The router** (`router.ts`, `routes.default.ts`) picks per pair from an
  ordered candidate list, narrowed by the device tier, the two engine
  settings, the catalog and the session's down-marks (a candidate whose
  model failed to load or translate is skipped until reload). The shipped
  table is provisional until `tools/translate-eval.mjs` (plan 4) measures.

## The worker

`js/translate-worker.js` (its own webpack configuration, like the push
chunk) hosts both engines; the page talks to it over `protocol.ts`
(`client.ts` on the page, `worker.ts` in the worker). `service.ts` routes,
loads on demand, marks candidates down and terminates the worker after ten
idle minutes or on `pagehide`. `index.ts` is the singleton wired to the
store; on a development build `?fakeTranslate` swaps in `fakePort.ts`, an
in-page scripted worker the scenarios use. Plan 2 (reading) starts from the
page-side surface `client.ts` already exposes: `TranslateClient.translate(req, ref, onProgress?)` for the streamed chunks, `WORKER_DISPOSED` as the
rejection every in-flight call gets on teardown, `IDLE_UNLOAD_MS` for how
long an unused worker survives, and `translateService().translate()` as the
one call a new caller (the header switch) needs on the page.

**The caller's half of the contract:** a stream from
`translateService().translate()` must be consumed to the end, or left with
`break`/`return` (anything that runs the generator's `return()`). A
generator simply abandoned never releases the service's in-flight count, so
the idle unload never fires and the worker lives until `pagehide`.

**Prerequisites for plan 2**, none of which matter while the service is the
only caller:

- `status` and `models` replies carry no correlation id, so every
  outstanding waiter settles on the first one back. Serialise those calls,
  or give the messages ids, before a second caller exists.
- `Seq2seqEngine.unload()` disposes what is loaded and ignores loads still
  in flight: a pipeline that arrives after it is loaded again, uncounted.
- An abandoned generator leaks an in-flight count (above), and in the
  seq2seq engine it also pins its model against eviction.

## Weights

**Serving.** The worker loads ONNX Runtime with a dynamic `import()` of `js/ort/ort-wasm-simd-threaded.mjs`, and a browser refuses a module served with anything but a JavaScript MIME type ("Failed to fetch dynamically imported module", surfaced by the tab as "no available backend found"). A deploy must serve `.mjs` as `text/javascript` and `.wasm` as `application/wasm` (the latter for streaming compilation; a wrong type there only slows the load). GitHub Pages, nginx and Python's `http.server` do; a hand-rolled static server with its own MIME table may not.

WebLLM caches under its own Cache Storage keys, transformers.js under
`transformers-cache`; `service-worker.js` never touches either, nor a
same-origin mirror under `models/`. The ONNX Runtime wasm files ship in
`js/ort/`. Settings → Translation lists every catalog model with its size
and cached state, downloads with progress and deletes.

## Tests

`test/translate/*` mirrors the modules on a `FakeEngine` and an in-process
port pair; the real libraries are only imported by the two `*.real.ts`
files and never under mocha. Browser: `tools/scenarios/translate-settings.mjs`.
