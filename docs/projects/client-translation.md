# Client-side translation

_Started 2026-09-11 on the `client-translation` branch (from `origin/develop`
at `d6b6624b`). Status: **phases 1, 2 and 3 implemented; phase 4
pending** (plan 3, the composer: `docs/superpowers/plans/2026-09-12-client-translation-3-composer.md`, gitignored, local). This file is the spec; the implementation plan follows from it._

## Goal

Translate IRC conversation in the browser, on the user's device, with no
server in between: incoming messages in channels the user switches on are
shown with a translation under the original, and the composer can translate
what the user types before it is sent. "Many languages" and "high quality"
pull against each other on a client device, so the engine is two engines
behind one interface and a router that picks per language pair, and the
quality claim is measured by a script rather than assumed.

## Decisions (from the design session)

| Question        | Decision                                                                                                                         |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Direction       | Both: incoming messages and the composer.                                                                                        |
| GPU engine      | WebLLM (MLC) running a 1-2 GB instruction LLM (Qwen3 1.7B or Gemma 3 1B class, q4f16) via WebGPU.                                |
| CPU engine      | transformers.js on ONNX Runtime WASM running purpose-built translation models (NLLB-200 distilled, OPUS-MT).                     |
| Engine choice   | A router table per language pair. The CPU engine is a peer preferred for the languages where it measures better, not a fallback. |
| Reading trigger | Automatic per channel, opt-in; language detection gates the queue.                                                               |
| Reading display | Translation under the original as a muted line with a "from German" chip; streaming text with a caret.                           |
| Channel switch  | A globe button in the chat header, lit when on; its menu (and the channel menu) holds the languages and options.                 |
| Composer        | Translation only, after a preview: a strip above the input (like the reply and edit strips), second Enter sends.                 |
| Weights         | `config.json` `translation.modelBase`; unset means the public Hugging Face CDN. Cached in the browser.                           |
| Labels          | Full language names everywhere ("from German", "to German"), never codes.                                                        |

Quality levers in the first version: recent messages as context, the reply
target, the channel topic and language prior, deterministic span protection,
a nick glossary, per-channel term memory, multiline messages as one unit,
queue batching, a round-trip check on the strip as a button, and voice
examples and formality as settings. Deferred: draft-and-refine across the two
engines, and a "wrong?" feedback log.

### Deviations recorded during implementation

Plan 1 (engine layer):

- `Engine.capabilities()` carries no language lists; the model catalog
  (`models.ts`) does.
- `TranslateChunk` has no `line`; batched results are parsed once on `done`.
- `translateEngines` is two boolean settings, `translateLlm` and
  `translateCpu`.
- `TranslateRequest` names its `model`; the service picks it from the route.
- Engines expose `loadedModels()` / `isLoaded(model)` rather than one loaded
  flag.
- A candidate is marked down only on a load-class failure (`EngineError`
  cause `"load"`); a request failure is reported per line and the candidate
  stays up.

Plan 2 (reading pipeline):

- Language detection uses `franc` (a lazy chunk) with the channel's
  recent-language prior, not hand-built n-gram profiles. When franc's best
  guess is a language the catalog does not know, the detection is
  undetermined (no lower-ranked guess is used); a forced (manual)
  translation still lets the LLM detect the source.
- Eligibility: the shortcode pattern requires a letter, so a clock time
  like `12:30:45` is never treated as an emoji shortcode (applied to span
  protection too).
- WebGPU device loss: the reload-once counter belongs to the model id;
  loading a different model resets it, a second consecutive loss of the
  same model marks the LLM candidate down.
- Queue: a pair without a route fails the line ("no route") instead of
  hanging; every request carries an AbortSignal end to end and a 120 s
  deadline ("timed out"); a channel switch cancels its in-flight requests
  eagerly; lines older than 200 arrivals in their channel are dropped
  rather than translated late.
- The per-channel record lives in `translate/channelStore.ts`, not
  `helpers/translateStore.ts`, and persists only `read`, `write`,
  `formality`, `variant`, `since`, `terms` (`thelounge.translate`); runtime
  patches never write `since`/`terms`, and a `read`/`write` the build
  cannot route is loaded as null.
- An edited or deleted message loses its translation (an edit is re-queued
  as the new line's own). Parting or quitting a channel discards its queue,
  priors and arrival counters, its persisted record (the switch, formality,
  variant and term memory) and the translations of its messages; the
  message-limit trim in `socket-events/msg.ts` drops the entries of the
  messages it splices. `state.translations` is in memory only, but it is
  not kept for the life of the tab.
- `TERM_LINES` (20) lives in `context.ts` rather than `prompt.ts`: the
  context builder is where the slice happens. A prompt carries the newest
  20 of the channel's own terms.
- The deploy's `translation.glossary` is merged into every request at
  context-build time rather than seeded into the persisted records, keyed
  by the source term with the channel's own memory winning; the glossary
  itself is not subject to `TERM_LINES`.
- A replayed message (the bus payload's `replay`) is eligible only when it
  is newer than the page's session as well as newer than `since`: a cold
  boot does not translate history, a reconnect's catch-up within a session
  does.
- Detection thresholds: `DETECT_MIN_GAP` (0.1) over the best guess's lead
  on the runner-up, not the spec's `DETECT_MIN_CONFIDENCE` (0.6) over a
  normalised confidence -- a different quantity: `francAll` normalises its
  best score to 1, so only the lead over the runner-up carries
  information, and a near tie goes to the channel's prior.
- `NAMES_CAP` (20) caps the names in a prompt where the spec says "the
  channel's NAMES list".
- The channel menu's "Translation…" switches to the channel and asks
  through `state.translation.panelFor` (a store slot the view clears),
  not an eventbus event: the view of a channel that is not open does not
  exist to hear one.
- The reader waits for the capability probe before the first line of a
  channel, and re-reads the channel's settings after language detection so
  a setting changed mid-flight wins.
- The translation panel is a sibling of the channel header (absolutely
  positioned under it), not a child: the header clips its overflow.

Plan 3 (composer):

- A message edit never translates: `startEdit` pre-fills the draft with
  the sent text, already in the write language, and the gate treats
  `channel.editing` like a slash command. "Escape or Edit removes the
  strip" is the strip's own Edit button, not the edit compose bar.
- The round trip's reverse language is the draft's detected language,
  else the user's reading language; when that equals the write target
  there is nothing to read back into and no Check is offered.
  `translateRoundTrip: "auto"` starts the check as soon as the
  translation ends and Send waits for it; `"button"` never lets a
  running check block Send.
- Term memory takes term-sized pairs only: a one-line draft of at most
  `TERM_MAX_WORDS` (3) words and `TERM_MAX_CHARS` (40) characters whose
  translation is also short and differs from it. Sentences never enter
  the memory.
- A write runs beside the reading queue but ahead of it: `holdReading()`
  stops new reading runs (a run already in flight finishes) while a
  draft translates; requests are correlated by id, so two streams at
  once are safe.
- A draft the detector cannot place (under ten characters, or
  undetermined) is translated as if written in the user's reading
  language when that differs from the write target; otherwise the
  source is left to the LLM, so a CPU-only device with no route gets the
  failure strip.
- A multi-line draft translates as one batched numbered request when the
  route's engine batches, else line by line; a batch whose numbering
  does not parse is retried line by line. Blank lines stay in place and
  the line count survives, so a translated draft's multiline decision
  sees the same shape the draft itself would have gotten.
- The globe's light means reading: `translationOn` is `read !== null`.
  A write-only channel shows an unlit globe whose tooltip still says
  "sending in German" — the click toggles reading, so the light has to
  say what the click will undo.
- Escape with a strip up removes only the strip; without one it behaves
  as it always has (it blurs, it does not clear).
- Typing notifications are left alone: the first Enter sends nothing, so
  the 5 s idle timer reports "paused" and the message lands a few
  seconds late.
- A translation longer than 500 bytes splits into two `PRIVMSG`s like any
  long text; the strip does not warn.
- Formality for a write is `channel.formality` when it is not `"auto"`,
  else the global `translateFormality` setting; reading keeps using the
  channel's alone.
- The strip's copy: chip `to German`; failure `couldn't translate, send as written?` with the send button reading `Send as written`; the check
  row's label `reads back as:`.
- `writeTarget()` does not wait for the device probe: it returns the
  channel's `write` target as soon as the service is enabled, so a
  placeholder can say "sent in German" a moment before the probe
  answers. `translateOutgoing` awaits the probe itself before judging
  availability, so a fresh page's first draft is not sent untranslated
  while the probe is still in flight.
- An empty translation is treated as a failure ("send as written"), not
  as a message with nothing in it. A translation that begins with `/` is
  escaped as `//…` so the IRC layer sends it as text, the same trick a
  literal `/` in the draft already relies on. A translation started for
  one channel is only ever sent in that channel, and only while its
  network is up.

## Non-goals

- No translation of the lobby, notices from the server, events (join, part,
  mode, topic lines) or slash commands.
- No persistence of translations across reloads; a message is retranslated on
  demand.
- No server component and no deploy-side translation endpoint.
- No change to the bus contract or `SharedMsg`. The translation layer runs
  beside the store, keyed by message id.

## Architecture: `client/js/translate/`

Vue-free except for the components that render it. The rest of the app only
ever calls `translateService` (`service.ts`); it never knows which engine ran.

### `engine.ts`: the interface

```ts
interface TranslateRequest {
  id: number; // request id, for cancellation and progress
  text: string; // after span protection (placeholders in place)
  lines?: string[]; // a batched request: numbered lines in, numbered lines out
  from: string | null; // ISO 639-1 (or 639-3 for the NLLB tail), null = unknown
  to: string;
  purpose: "read" | "write";
  context: PromptContext; // see prompt.ts; engines that cannot use it ignore it
}
interface TranslateChunk {
  id: number;
  text: string; // cumulative for streaming engines, the whole result for seq2seq
  done: boolean;
  line?: number; // which line of a batched request this chunk belongs to
}
interface Engine {
  readonly name: "llm" | "seq2seq";
  load(model: ModelRef, onProgress: (p: LoadProgress) => void): Promise<void>;
  unload(): Promise<void>;
  status(): "cold" | "loading" | "ready" | "failed";
  capabilities(): {
    languages: string[];
    pairs?: [string, string][];
    streams: boolean;
    batches: boolean;
  };
  translate(req: TranslateRequest, signal: AbortSignal): AsyncIterable<TranslateChunk>;
}
```

Streaming is the base contract so the LLM's partial output renders as it
arrives; the seq2seq engine yields once with `done: true`.

### `engines/webllm.ts`: the GPU tier

Wraps `MLCEngine` through WebLLM's own web-worker handler. One model at a
time. Default model: a Qwen3 1.7B q4f16 entry from WebLLM's prebuilt list;
`config.json` can name any entry in that list or an operator-hosted
equivalent (a mirror needs both the weights URL and the compiled model
library `.wasm` URL). Generation: greedy, temperature 0.1, thinking off, max
tokens derived from the input length (`2 × input tokens + 32`, capped at
512), stop at the first newline for a single-line request and at the
`END` sentinel for a batched one. No prompt cache is assumed, so the system
prompt stays short and the context is trimmed to a token budget
(`CONTEXT_TOKEN_BUDGET`, 700).

### `engines/seq2seq.ts`: the CPU tier

transformers.js pipelines on ONNX Runtime WASM. Two model families behind one
engine: NLLB-200 distilled 600M int8 (any pair in its 200 languages) and
OPUS-MT pair models (30-80 MB each, for the pairs where a pair model measures
better than NLLB). At most two seq2seq models loaded at once, evicted by last
use. Multi-threaded WASM needs `SharedArrayBuffer`, which needs the
cross-origin isolation headers; a static deploy may not send them, so the
engine runs single-threaded when it must and reports `threads: false` in
`status()`. `docs/resources/branding.md` tells operators which headers turn
threads on.

### `router.ts`

A table keyed by target language, then source, each entry an ordered list of
candidates:

```ts
type Candidate = "llm" | "nllb" | `opus:${string}-${string}`;
type RouteTable = Record<string, Record<string, Candidate[]> & {"*"?: Candidate[]}>;
```

`resolve({from, to, tier, down})` returns, as `{engine, model}`, the first
candidate that the device
tier allows (an `llm` candidate is skipped, never failed, below the GPU
threshold), the user's engine settings allow, and is not marked down for the
session. The shipped default table (`routes.default.ts`) is derived from the
evaluation table in `docs/resources/translation.md` (§ Testing and
evaluation below): the LLM for the languages where it wins on a GPU-capable
device, NLLB or an OPUS-MT pair model for the tail. `config.json`
`translation.routes` overrides entries one at a time. When a candidate cannot
load (download failed, out of memory, WebGPU device lost twice) the router
marks it down for the session and takes the next.

### `capability.ts`

The probe, run once per page and cached in memory only: `navigator.gpu`
adapter present, `shader-f16` feature, adapter `maxBufferSize` and
`maxStorageBufferBindingSize`, `navigator.deviceMemory` (where exposed) and
`navigator.storage.estimate()`. Output: `{tier: "gpu" | "cpu" | "none", reasons: string[]}`. The `gpu` tier needs an adapter with f16 and at least
1 GiB of addressable buffer (WebLLM's floor; adapters report their limits with alignment slack, so 2 GiB exactly refused real hardware); `none` means not even WASM SIMD, and the feature
hides itself. The reasons are what Settings shows ("no WebGPU", "not enough
GPU memory") instead of a missing row.

### `worker.ts` and `client.ts`: the worker and its protocol

A dedicated Web Worker (`translate.worker.js`, its own webpack entry) hosts
both engines so inference never blocks the UI thread. `client.ts` is the
main-thread side: a typed message channel with request ids, `cancel(id)`,
model load progress events, per-request streaming chunks, and `status`
snapshots. Messages:

```
main → worker: {type: "load", engine, model} | {type: "unload", engine} |
               {type: "translate", req} | {type: "cancel", id} | {type: "status"}
worker → main: {type: "progress", engine, loaded, total} | {type: "chunk", chunk} |
               {type: "error", id?, engine?, message} | {type: "status", engines: {...}}
```

The worker is created lazily the first time a channel switch turns on or the
composer needs it, and terminated by the idle timeout (§ Lifecycle).

### `detect.ts`

Language identification on the main thread, cheap enough for every incoming
message: n-gram profiles (character trigrams, one profile per language the
router knows, about 200 KB), bundled as its own chunk and loaded the first
time a switch turns on. Input is the plain text with formatting stripped and
URLs, nicks and channel names removed. Output `{lang, confidence}` plus a
`DETECT_MIN_CONFIDENCE` (0.6) below which no language is named. The channel's
language prior (§ Prompt context) biases short inputs.

### `queue.ts`

One FIFO per network with priorities: the active channel first, then
channels in sidebar order, oldest message first within a channel.
Concurrency is one in-flight request per engine, so the GPU and CPU engines
run in parallel. Batching: when several queued messages share a channel and
a pair and the engine `batches`, up to `BATCH_MAX_LINES` (6) go out as one
numbered request. A message that scrolls more than `DROP_AFTER_LINES` (200)
out of view before its turn is dropped from the queue (the per-message
toolbar action brings it back). `pause(engine)`/`resume(engine)` are what
the failure policy uses.

### `prompt.ts`: context assembly

Builds `PromptContext` for a request and, for the LLM, the messages array:

- **System instruction** (short): translate from `<source or "the detected language">` to `<target>`; keep placeholders, names and channel names
  verbatim; keep the register (an IRC one-liner stays a one-liner); answer
  with the translation only; for a batched request, answer with the same
  numbered lines and nothing else, then `END`.
- **Recent messages**: the last `CONTEXT_LINES` (10) messages of the channel
  (originals, with our translations where we have them), labelled and quoted
  as context, oldest first, trimmed to the token budget from the oldest end.
- **The reply target**: when the message carries a `+draft/reply` msgid or
  starts with `<nick>:` (IRC's address convention), the parent's original
  and translation are spelled out ("this line replies to <nick>: ...").
- **Topic and language prior**: the channel topic as one framing line; the
  dominant language of the channel over the last few hundred messages (kept
  by `detect.ts`) as the source hint when the detector is unsure.
- **Nick glossary**: the channel's NAMES list and the network's channel
  names as "these are names, not words".
- **Term memory**: the channel's `TermMemory` (§ Persistence) as "earlier in
  this channel: rig → Testaufbau", capped at `TERM_LINES` (20) most recent.
- **Multiline**: a `draft/multiline` message is one request with its lines
  joined; the result is split back on the same line breaks.
- **Write purpose adds**: the user's last `VOICE_LINES` (5) sent messages in
  the target language (or their previous translated sends) as examples of
  their voice; the formality and variant lines from the channel's settings.

Span protection (`spans.ts`) runs before and after any engine: URLs, code
spans, emoji shortcodes, IRC formatting codes and `+draft/reply` quotes are
swapped for numbered placeholders (`⟦1⟧`) and restored after; a result that
lost a placeholder is retried once, then shown with the placeholder text
restored at the end.

## Reading pipeline

1. **Eligibility.** A store plugin watches new `message`, `action` and
   `notice` types in channels whose `read` target is set. Excluded: own
   messages (`self`), replay older than the switch-on time (a fresh channel
   would otherwise queue its backlog), messages under 3 words or consisting
   only of URLs, emoji, nick mentions or code, and edits until they settle.
2. **Detection.** If the detector names the target language, or names
   nothing, the message is skipped. Otherwise it is queued with its source.
3. **Queue.** As above; the visible tail of a burst translates first.
4. **Translation.** `purpose: "read"`, streaming chunks forwarded as they
   arrive.
5. **State.** `store.state.translations: Map<id, Translation>` with
   `{status: "pending" | "done" | "failed", text, from, to, engine}`, in
   memory only.
6. **Render.** `Message.vue` renders the muted line under the content with
   the "from German" chip and, while pending, the streamed text with a
   caret. The chip's click menu: Retranslate, Show original only (this
   message). The message toolbar gains "Translate" for switched-off channels
   and dropped messages. Unread, highlight and notification logic is
   untouched, since it runs on the original.

The language names come from `Intl.DisplayNames` in the app's language, with
a bundled English table as the fallback for the NLLB tail codes.

## Composer

The `write` target is per channel and separate from `read`. On Enter with
`write` set:

1. **Gate.** Slash commands (`/me` included) never translate. Nor does a
   draft the detector already places in the target language.
2. **Request.** `purpose: "write"` with the same context as reading plus the
   voice examples and formality line; span protection applies; a multi-line
   draft translates as a unit and goes out through the multiline path.
3. **Strip.** `.compose-bar`-style strip above the input with the "to
   German" chip and the text streaming in; Send disabled until the stream
   ends. The input keeps the original and stays editable; typing invalidates
   the strip and Enter requests a fresh translation.
4. **Check.** A "Check" button runs the round trip and shows "reads back
   as: …" under the translation; the `translateRoundTrip` setting makes it
   automatic, in which case Send waits for it.
5. **Send.** Enter or Send ships the translation through `sendMessage`
   exactly as typed text would: pending copy, `@label`, echo. The input
   history entry keeps the original so Up recalls what the user wrote. The
   pair goes into term memory.
6. **Escape.** Escape or Edit removes the strip and leaves the input alone;
   a second Escape clears the input as today.

Failure: an engine error shows "couldn't translate, sent as written?" in
the strip with Send now meaning the original. Nothing is ever sent without
the user's second Enter.

## Header switch

`Chat.vue` gains a globe button beside the mentions and menu buttons, shown
when `capability.tier !== "none"` and `translation.enabled`. Click toggles
`read` for the channel (target = `translateTo`); lit (accent colour, accent
tint background) when `read` is set — the light means reading, which is what
the click toggles, so a channel that only sends in another language shows
an unlit globe. The tooltip states the whole state either way
("Translating into English", "Translating into English, sending in
German", or "Translate messages into English, sending in German" when
only the write target is set). Right-click or long press opens the same
panel the channel menu's "Translation…" entry opens: reading target (with
"off"), outgoing target (with "off"), formality, variant. A paused engine
shows in the tooltip.

## Settings, persistence, deploy configuration

- **User settings** (`store-settings.ts`, `thelounge.settings`):
  `translateTo` (default from `navigator.language`), `translateFormality`
  (`auto | formal | casual`), `translateRoundTrip` (`button | auto`),
  `translateEngines` (`{llm: boolean, cpu: boolean}`). Settings → Translation
  holds them and the model manager: every known model with size, cached or
  not, download with progress, delete; below the GPU tier the LLM row shows
  the probe's reason.
- **Per-channel state** (`helpers/translateStore.ts`, `thelounge.translate`,
  keyed by network uuid then channel name): `{read, write, variant, formality}` plus `terms: [source, target][]` capped at `TERM_CAP` (300),
  oldest evicted. Applied on join, dropped when the channel leaves the saved
  network's list. Tests swap storage via `useStorageBackend`.
- **`config.json`** (`branding.ts` `translation` block, all optional):
  `enabled` (default true), `modelBase`, `llm: {model, lib}`, `cpu: {nllb, opus: Record<pair, model>}`, `routes: RouteTable` (merged over the
  default), `glossary: [source, target][]` (seeded into every channel's term
  memory), `defaultTarget`. Documented in `docs/resources/branding.md`
  § Translation with the cross-origin isolation headers.
- **Caches.** Weights in Cache Storage under the two libraries' own keys;
  `service-worker.js` never intercepts those requests, so a shell update
  cannot evict a model. The detector profiles and the worker bundle are
  ordinary webpack chunks the shell cache handles.
- **Native shells.** Nothing extra; the probe reports what the platform's
  web view gives.

## Lifecycle, memory, errors

- Ceiling: one GPU model plus two CPU models.
- Idle: everything unloads and the worker terminates after
  `IDLE_UNLOAD_MS` (10 minutes) with no switch on in any open channel and no
  request, and on `pagehide`.
- WebGPU `device lost`: reload the model once; a second loss marks `llm`
  down for the session.
- A failed request marks the entry `failed` with a "couldn't translate"
  label that retries on click. Three consecutive failures on one engine
  pause its queue and surface in the globe's tooltip; the queue resumes on
  the next successful load or on the user's retry.
- The queue and any in-flight request are cancelled when the channel's
  switch turns off or the network disconnects.

## Testing and evaluation

- **Mocha, Vue-free** (`test/translate/`): `detect.ts` against a labelled
  sample per language; `queue.ts` priorities, batching and drops with fake
  timers; `router.ts` resolution, tier gating and down-marking; `prompt.ts`
  output for each context shape (reply target, glossary, term memory,
  multiline, budget trimming) and the batched-lines parser with its
  mismatch fallback; `spans.ts` protect/restore round trips; term memory
  eviction; `translateStore.ts` persistence through `useStorageBackend`;
  the worker protocol with a fake `postMessage` pair. A `FakeEngine` that
  yields scripted chunks stands in for both engines. New test files follow
  the `socket.dispatch.isSinonProxy` spy convention.
- **Browser** (`tools/scenarios/`, on the fake engine injected through a
  `?fakeTranslate` query the dev build honours): `translate-reading.mjs`
  (switch on, burst, streaming line, chip menu, scroll drop, failure label)
  and `translate-composer.mjs` (strip, check, edit invalidation, escape,
  error path), both also `--mobile`.
- **Quality** (`tools/translate-eval.mjs`): runs the real engines in headless
  Chromium over a FLORES-200 sample and a small IRC-style set kept in
  `tools/translate-eval/`, reports chrF per pair per engine, and writes the
  table into `docs/resources/translation.md`. The router's default table is
  derived from that table, so "the CPU engine is preferred for some
  languages" is a measured decision that can be rerun when a model changes.

## Documentation to update

- `docs/resources/translation.md` (new): engines, router, the evaluation
  table, prompt shape, how to mirror the weights.
- `docs/resources/branding.md` § Translation: the `config.json` block and
  the isolation headers.
- `CLAUDE.md`: a "Translation" paragraph under the client architecture.
- `CONTEXT.md`: the vocabulary (switch, chip, strip, term memory, router,
  tier).
- `docs/projects/initial_conversion.md` is untouched; this is not part of
  the conversion.

## Delivery order

One implementation plan in four phases, each leaving the branch green and
the app usable without the next:

1. **Engine layer**: `capability.ts`, `engine.ts`, the worker and its
   protocol, the two engines, `router.ts` with a provisional default table,
   `spans.ts`, the `FakeEngine`, and Settings → Translation with the model
   manager. Verifiable from Settings alone: download a model, see it cached.
   Plan: docs/superpowers/plans/2026-09-11-client-translation-1-engine-layer.md
   (gitignored, local).
2. **Reading**: `detect.ts`, `queue.ts`, `prompt.ts`, the store map, the
   header switch, `Message.vue`, the per-channel store, `translate-reading.mjs`.
3. **Composer**: the strip, the check, the gate, the send path,
   `translate-composer.mjs`.
4. **Evaluation**: `tools/translate-eval.mjs`, `docs/resources/translation.md`,
   and the default route table rewritten from its numbers.

## Deferred

- Draft-and-refine: the seq2seq engine drafts, the LLM refines with context.
- A "wrong?" action on the chip that retranslates with the other engine and
  logs the case locally for the evaluation set.
- Persisting translations across reloads.
