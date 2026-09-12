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
  model failed to load or translate is skipped until reload). Among the
  candidates that survive, one whose model is **already downloaded** wins
  over one that is not, whatever the table's order: a request has two
  minutes, and waiting out a download inside them when a model on the
  device could have answered is the worse trade. The shipped
  table is provisional until `tools/translate-eval.mjs` (plan 4) measures.

## Reading a channel

The globe in a channel's header switches translation on for that channel
(`Chat.vue`, `translate/reader.ts`): from then on every message someone
else sends is detected (`detect.ts`, `franc` in its own chunk, with the
channel's dominant language settling near ties), skipped when it is
already in the target or too short (`eligibility.ts`), given its context
(`context.ts`: the last ten lines with the translations already shown,
the reply target, the topic, the names in play, the newest twenty of the
channel's terms and the deploy's glossary behind them) and queued
(`queue.ts`: the active channel first, one request per engine, LLM lines
of one channel and pair batched, items that fell two hundred messages
behind dropped, an engine paused after three failures in a row). The
result lives in `store.state.translations` keyed by the message id and
renders as `TranslationLine.vue` under the original: a "from German"
chip, the text streaming with a caret, a retry when it failed (an icon
button, "Retry the translation" its tooltip and accessible name, with the
engine's reason beside "couldn't translate" when there is one -- a model
that would not load says so rather than leaving the tier looking broken); the chip's
menu copies, retranslates or hides the line ("Copy translation" puts the
translated text on the clipboard through `js/clipboard.ts`, the helper the
message toolbar's Copy uses, and says nothing when the browser refuses),
and the toolbar's Translate does one
message on request in a channel that is off -- and brings a hidden
translation back, at no cost, once the chip's "Show original only" has
taken it away. The translated line is `user-select: text` like the
original above it -- `body` is `user-select: none`, so a block that is
meant to be read and quoted has to say so.

A message that arrived as `draft/multiline` is one message whose text
carries newlines, and it goes through the composer's own `translateDraft`
rather than the queue's single-line request: numbered lines to an LLM, one
line at a time to a seq2seq engine, blank lines where they were, and never
batched with the other lines of the channel. Without that the engine's cut
kept the first line and the rest of the message was silently lost. An entry leaves when its message does: an edit or a REDACT
drops it, and so do the message-limit trim, a part and a quit. The
switch, the outgoing target (plan 3), formality, variant and the term
memory are per channel under `thelounge.translate` (`channelStore.ts`);
older messages are never translated (the switch-on moment is recorded),
and a replayed one must be newer than this page's session too, so a
reload does not re-translate a channel's backlog. The channel menu's
"Translation…" switches to the channel and asks for the panel through
`state.translation.panelFor`, which the view clears as it opens it.
Nothing on a message object changes and nothing about unread or highlight
counts does. Browser check: `tools/scenarios/translate-reading.mjs`, on
the in-page fake engine (`?fakeTranslate`, `fakePort.ts`): it answers a
batched request as numbered lines closed by `END`, fails a request whose
text carries `[fail]` once (the retry succeeds), and logs every request
onto `globalThis.__seanceTranslateFake` so a scenario can tell a batch
from a fallback to singles.

## The channel's panel

The per-channel choices -- reading language, outgoing target, formality,
variant -- are one component (`TranslationPanel.vue`) in two layouts. Where
there is a pointer it is a column anchored under the channel header: each
setting a label with its control beneath it, so the four controls share one
width and one rhythm (20rem wide, 2.125rem controls); the section headings
and the one-line hints are left out, and a footer carries a link to
Settings -> Translation beside Done. Where `helpers/device.ts`
`hasVirtualKeyboard()` reports a touch-primary device, or the window is as
narrow as the phone's chat layout (`max-width: 479px`), the same markup
`<Teleport>`s to `<body>` and takes `.translation-panel--sheet`: a
full-screen sheet with 2.75rem controls, the two sections (Reading,
Writing) under their headings, a hint under each control, formality as a
three-way segmented control (`role="radiogroup"`, "As written" / "Formally"
/ "Casually") rather than a native picker, and a full-width Done above the
safe area. The sheet's height follows `--viewport-height`
(`helpers/viewport.ts`), so iOS's keyboard cannot push Done off the screen.

How it opens splits the same way. With a pointer, a click on the globe
toggles reading and a right-click opens the panel; on touch there is no
right-click, so the **tap** opens the panel (whose first control is the
reading switch) and the globe's label says "Translation settings". The
channel menu's "Translation..." reaches it on both. It closes on the X, on
Done, on Escape, and -- the anchored panel only, since the sheet has no
outside -- on a click outside it; the caret goes back to the globe when the
panel is what held it. Browser checks:
`tools/scenarios/translate-reading.mjs` (the column, and the sheet under
`--mobile`) and `tools/scenarios/translate-composer.mjs --mobile --width=390 --height=844` (the sheet in full).

## Writing in a channel

The panel also sets an outgoing target per channel (`write`, next to `read`
in `thelounge.translate`); `writeTarget()` returns it as soon as
translation is enabled, without waiting for the device probe, so the
composer can show a placeholder ("sent in German") the instant the target
is picked.

The first Enter on a non-empty, non-command, non-edit draft
(`outgoing.ts` `draftGate`) calls `writer.ts` `translateOutgoing` instead
of sending: it detects the draft's language (no channel prior -- it is the
user's own line, not what the channel has been saying), decides the source
with `writeSource` (the detector's verdict, or the user's reading language
when the draft is too short to place and that differs from the target,
else left to the LLM), and builds context the same way the reader does
(recent lines, reply target, topic, names, terms, glossary) plus a `voice`:
the last `VOICE_LINES` (5) of this channel's own sent translations to this
target, session-only, so the model's phrasing stays consistent across a
conversation without ever touching persisted storage.

The reading queues are held (`holdReading()`/`releaseReading()`) for the
length of the request, and again for the round-trip check, so a write is
never left waiting behind a channel's incoming traffic; a read already in
flight when the hold starts still finishes. `translateDraft` (`outgoing.ts`) then does the actual work: a
single-line draft as one request, a multi-line one as a numbered batch when
the route's engine batches (else line by line, falling back to line-by-line
whenever the batch's numbering does not parse or the engine refuses the
batch before it yields anything), streamed with the blank lines between a
draft's lines kept where they were -- a draft whose only non-blank line sits
among blank lines is sent as that line alone, since a blank line is nothing
to send -- and given up after `WRITE_TIMEOUT_MS` (2 min).

The result lives in `store.state.outgoingTranslations`, keyed by channel
id, and `ChatInput.vue` renders it as the `.translate-bar` strip above the
input: a "to German" chip, the streaming text with a caret, and icon
buttons -- their words kept as the tooltip and accessible name, never as
visible text -- for Copy (its tooltip reads "Copied" for two seconds after
it worked), Check once the round trip has something to check, Send
(disabled while pending), and Edit. Both rows of the strip are
`user-select: text`: the line the user is being asked to approve has to be
selectable. A failure shows "couldn't translate, send as written?" -- followed by the
engine's reason, truncated, with the whole of it in the title -- and turns
Send's tooltip into "Send as written". The second Enter is the same `input` bus emit
as any other send (`deliver`, so history, replies and edits do not
diverge): it ships the strip's translation, or the draft itself after a
failure, and calls `noteOutgoingSent`, which extends the voice and, when
the draft and its translation are term-sized (`termPair`: one line, short
both ways, genuinely different), remembers the pair in the channel's term
memory. Typing again, walking input history, Escape, the strip's own Edit
button and parting the channel all invalidate the strip; the next Enter
starts over.

The round trip reads a done translation back toward `reverseTarget` (the
draft's detected language, or the user's reading language, whichever
differs from the write target -- when neither does, there is nothing to
read back into and no Check is offered) and shows it in a second row,
"reads back as:". `translateRoundTrip: "auto"` starts the check as soon as
the translation finishes and Send waits for it; `"button"` leaves Send free
even while a check the user asked for is still running.

The scenario's fake logs `purpose: "write"` (or `"read"` for the check) on
every request, so a browser check can tell the composer's traffic from the
reader's. Browser check: `tools/scenarios/translate-composer.mjs` (also
`--mobile`).

## Span protection

Fidelity is the code's job, not the model's. `spans.ts` swaps everything
the client itself treats as syntax for numbered placeholders (`⟦1⟧`) before
any engine sees the text, and puts it back afterwards; both sides of the
app go through it, and the composer's `translateDraft` protects the whole
text **once**, before it splits it into lines, so a construct that spans
lines is one span rather than a fragment per line.

The stages run in order and a placeholder never matches a later pattern:
fenced code blocks (` ``` `, closing fence at least as long, the block's
inner newlines inside the span), then inline code, URLs, `www.` links,
emoji shortcodes and IRC formatting codes, then Markdown links, then
emphasis pairs (`**`, `__`, `~~`, `||`, then `*`, `_`, longest first, only
same-line pairs and only where the usual emphasis rule holds -- `2*3*4` is
arithmetic), then a line's leading syntax (`#` to `######`, `-`/`*`/`+`,
`1.`/`1)`, `>` with nesting), then the channel's nicknames (whole word,
case-insensitive, longest first, at least two characters, never inside an
earlier placeholder). This is a conservative reading of the client's own
grammar (`helpers/ircmessageparser/parseMarkdown.ts`); protecting a little
more than the client renders is safe, because a span is put back byte for
byte.

Every span says what it is, and each kind has its own restore policy
(`restoreAll`):

- **verbatim** -- put back where the engine left it; appended after the
  text when the engine lost it ("better shown late than lost").
- **marker** -- one half of a pair. Lose either half and neither goes back,
  so a translation never comes out with a stray `*` in it.
- **prefix** -- a line's leading syntax. Lost, it is re-prepended to its
  line (to its own line when the whole text is restored at once and the
  line count held, otherwise to the front of the line being restored).

A placeholder number the engine invented is dropped rather than shown, and
a span nested inside another (a link's `](target)`, whose target the URL
stage already claimed) travels with its parent and is never reported lost.
A line that holds nothing but a placeholder -- a fenced block on its own --
is put back rather than sent for translation at all.

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

**Trying the engine before plan 2.** On a development build, `await seanceTranslate("Hallo Welt", "en", "de")` in the console returns the translation and `seanceTranslate(text, to, from, console.log)` streams it; `from` null leaves detection to the LLM (the seq2seq engines need a source).

## Weights

**Serving.** The worker loads ONNX Runtime with a dynamic `import()` of `js/ort/ort-wasm-simd-threaded.mjs`, and a browser refuses a module served with anything but a JavaScript MIME type ("Failed to fetch dynamically imported module", surfaced by the tab as "no available backend found"). A deploy must serve `.mjs` as `text/javascript` and `.wasm` as `application/wasm` (the latter for streaming compilation; a wrong type there only slows the load). GitHub Pages and nginx do; Python's `http.server` only does where the system MIME table has an `.mjs` entry (on Debian it has none, and the module comes back as `application/octet-stream`), and a hand-rolled static server with its own table may not. For a local check, add the two types on the way in:

```sh
python3 -c 'import http.server as h, mimetypes as m, functools; m.add_type("text/javascript", ".mjs"); m.add_type("application/wasm", ".wasm"); h.test(functools.partial(h.SimpleHTTPRequestHandler, directory="public"), h.ThreadingHTTPServer, port=8021)'
```

**CPU models and ONNX Runtime.** The seq2seq engine loads the `q8` weights with `session_options: {graphOptimizationLevel: "basic"}` (`engines/seq2seq.real.ts`). ONNX Runtime's default level is _extended_, and one of its transforms rejects the QDQ graphs these models ship: `Can't create a session. ERROR_CODE: 1 … qdq_actions.cc:137 TransposeDQWeightsForMatMulNBits Missing required scale: model.shared.weight_merged_0_scale`. Every CPU model then fails to load, which the composer shows as "couldn't translate, send as written?" and the reading line as "couldn't translate" — the whole tier looks broken. `basic` stops short of that transform and the same weights load and run, so do not raise the level to fix a slow load. This is the other half of the serving note above: a wrong `.mjs` type and a wrong optimizer level both end as "no CPU model would load", and only the reason on the model row (Settings → Translation) or beside the failure tells them apart. Browser check, opt-in because it downloads real weights: `SEANCE_REAL_MODELS=1 node tools/browser-drive.mjs tools/scenarios/translate-cpu-real.mjs`.

WebLLM caches under its own Cache Storage keys (`webllm/model`,
`webllm/wasm`, `webllm/config`), transformers.js under
`transformers-cache`; `service-worker.js` never touches either, nor a
same-origin mirror under `models/` — and its `activate` cache sweep
(`isModelCache`) explicitly skips these names, so a shell update cannot
evict a model. The ONNX Runtime wasm files ship in
`js/ort/`. Settings → Translation lists every catalog model with its size
and cached state, downloads with progress and deletes.

## Tests

`test/translate/*` mirrors the modules on a `FakeEngine` and an in-process
port pair; the real libraries are only imported by the two `*.real.ts`
files and never under mocha. Browser: `tools/scenarios/translate-settings.mjs`.
