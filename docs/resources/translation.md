# Client-side translation

Seance translates on the user's device: no server, no translation API. This
file is the reference for the engine layer (`client/js/translate/`); the
design is `docs/projects/client-translation.md` and the deploy knobs are
`docs/resources/branding.md` § Translation.

## Two engines, one router

- **GPU: WebLLM.** An instruction LLM (default `Qwen3-1.7B-q4f16_1-MLC`)
  on WebGPU, prompted to translate with the channel's context. Greedy at
  temperature 0.1, thinking off, one line of output. Needs an adapter with
  `shader-f16` and 2 GiB of buffer (`capability.ts`).
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
in-page scripted worker the scenarios use.

## Weights

WebLLM caches under its own Cache Storage keys, transformers.js under
`transformers-cache`; `service-worker.js` never touches either, nor a
same-origin mirror under `models/`. The ONNX Runtime wasm files ship in
`js/ort/`. Settings → Translation lists every catalog model with its size
and cached state, downloads with progress and deletes.

## Tests

`test/translate/*` mirrors the modules on a `FakeEngine` and an in-process
port pair; the real libraries are only imported by the two `*.real.ts`
files and never under mocha. Browser: `tools/scenarios/translate-settings.mjs`.
