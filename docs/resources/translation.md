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
channel's declared languages and then its dominant language settling near
ties), skipped when it is
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
taken it away.

**An answer is not automatically a translation.** Two of them fail the line
instead: one that came back as the original (the model echoed rather than
translated -- `outgoing.ts` `isUnchanged`, judged past case, spacing and a
dropped full stop, and compared restored against restored so the route's
marker form cancels out) and one with nothing in it a language could be
(`hasNoLetters`: `⟹ `, `--- ---`, the empty string; letters and digits of
any script are content). Both are the _answer's_ failure, not the
engine's, so they never go through the queue's `fail()`: nothing is marked
down and neither counts toward the three-in-a-row pause, since the engine
did complete and the next line may well be one it can do. The line keeps
its chip and its Retry.

**The channel's own languages weight detection.** The panel's _Languages
spoken here_ records what people write in a channel (`channelStore.ts`
`languages`, ISO 639-1, supported codes only, persisted with the rest of
the record), and `detect.ts` weighs them above its automatic prior in
three ways. A declared language that franc ranks within `DECLARED_MARGIN`
(0.25) of its best **wins** over an undeclared best -- a trigram lead that
small is a weaker claim than the reader's; two declared contenders that
close resolve by their own gap, then by the prior, and where neither
separates them the line is left alone rather than translated from a coin
toss. A best franc names but we cannot translate from is **rescued** by a
declared contender instead of coming back undetermined. And a line under
`DETECT_MIN_LENGTH` (10 characters), which franc cannot place at all, is
taken as the one declared language that is **not** what the reader reads
when there is exactly one -- so "So ist es" in a German/English channel
read in English is translated, where before it was skipped. Nothing is
noted into the automatic prior from that last case: a line the detector
never saw is no evidence about the channel. `candidates` -- the chip menu's
one-click corrections -- puts the declared contenders first. The composer
declares nothing: a draft is the user's own language, not a channel
matter.

There are three ways to retranslate on that menu, because detection is the
thing most likely to be wrong: **Retranslate** runs the line again as it
was, **Retranslate from `<Language>`** appears once per runner-up the
detector ranked (`detect.ts` `candidates`, at most `DETECT_CANDIDATES` (3)
known languages in franc's order, carried on the entry; the line's own
source is left off the menu, since that item would only repeat
Retranslate), and **Retranslate from...** opens
`SourceLanguagePicker.vue` for any of the supported languages -- a popover
under the chip where there is a pointer, a bottom sheet on a phone or under
480px, closing on Escape, on Cancel and on a click outside. A chosen source
skips detection altogether: the entry's `from` becomes that language (so
the chip reads "from French"), the runners-up it inherited stay on the menu
(the detector's own guess among them), and nothing is noted into the
channel's language prior -- one reader's correction of one line is not the
channel's language. A retry keeps whatever source the failed line had. The translated line is `user-select: text` like the
original above it -- `body` is `user-select: none`, so a block that is
meant to be read and quoted has to say so. Once a translation is in, it is
the bright line; the original dims to the muted colour.

A message that arrived as `draft/multiline` is one message whose text
carries newlines, and it goes through the composer's own `translateDraft`
rather than the queue's single-line request: numbered lines to an LLM, one
line at a time to a seq2seq engine, blank lines where they were, and never
batched with the other lines of the channel. Without that the engine's cut
kept the first line and the rest of the message was silently lost. An entry leaves when its message does: an edit or a REDACT
drops it, and so do the message-limit trim, a part and a quit. The
switch, the outgoing target (plan 3), formality, variant, the languages
spoken here and the term memory are per channel under
`thelounge.translate` (`channelStore.ts`); older messages are never
translated (the switch-on moment is recorded). The channel menu's
"Translation…" switches to the channel and asks for the panel through
`state.translation.panelFor`, which the view clears as it opens it.
Nothing on a message object changes and nothing about unread or highlight
counts does. Browser check: `tools/scenarios/translate-reading.mjs`, on
the in-page fake engine (`?fakeTranslate`, `fakePort.ts`): it answers a
batched request as numbered lines closed by `END`, fails a request whose
text carries `[fail]` once (the retry succeeds), and logs every request
onto `globalThis.__seanceTranslateFake` so a scenario can tell a batch
from a fallback to singles.

**History is translated, bounded and newest first.** A replayed line -- a
reconnect's catch-up, a reload's replay -- is gated by the switch-on moment
alone, like a live one: a channel switched on today still does not
translate last week's scrollback, but everything said since it was
switched on is translated whether this page saw it live or on a replay.
A reconnect's catch-up arrives one line at a time (as `msg` with `replay`),
so it is bounded by counting: `HISTORY_QUEUE_CAP` (40) replayed lines per
channel per replay window, a live line closing the window. A **"load
more"** is the reader asking for that history -- they are looking at it now
-- so the switch-on moment does not gate it at all, while the rest of
eligibility (own lines, pending ones, short ones, lines already in the
target) still does; and because that page arrives whole, its newest 40
lines are queued, newest first
(`eligibility.ts` `HISTORY_QUEUE_CAP` and `historyQueueOrder`, from the
reader's second `socket.on("more")` listener, which runs after
`socket-events/more.ts` has prepended the page, so the objects it queues
are the store's own and their ids are store ids). Careful: **two** things
arrive as `more` (`irc/history.ts` `mode: "prepend"`) -- that page, and a
channel's first history fill when it is joined, which nobody asked for.
Only the asked-for one skips `since`, and `channel.historyLoading` is what
tells them apart: `MessageList.vue` sets it immediately before its emit
and `socket-events/more.ts` clears it a tick after the reader's listener
has run. A join's fill is bounded and ordered the same way but gated by
`since` like any other replay. The queue then runs a
channel's live lines ahead of its history ones (`QueueItem.history`,
cleared by a retry, since a retry is someone asking for that line now),
and the history ones are what a channel that has fallen
`DROP_AFTER_LINES` behind has left to drop. Browser check: the last steps
of `tools/scenarios/translate-reading.mjs`.

## The channel's panel

The per-channel choices -- reading language, the languages spoken here,
outgoing target, formality, variant -- are one component
(`TranslationPanel.vue`) in two layouts. Where
there is a pointer it is a column anchored under the channel header: each
setting a label with its control beneath it, so the five controls share one
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
toggles reading and a right-click opens the panel -- and a click that turns
reading **on** opens the panel with it, so the reader sees and can adjust
the languages at once (a click that turns reading off only turns it off);
on touch there is no
right-click, so the **tap** opens the panel (whose first control is the
reading switch) and the globe's label says "Translation settings". The
channel menu's "Translation..." reaches it on both. It closes on the X, on
Done, on Escape, and -- the anchored panel only, since the sheet has no
outside -- on a click outside it; the caret goes back to the globe when the
panel is what held it. Browser checks:
`tools/scenarios/translate-reading.mjs` (the column, and the sheet under
`--mobile`) and `tools/scenarios/translate-composer.mjs --mobile --width=390 --height=844` (the sheet in full).

_Languages spoken here_ is the one field that is not a single choice: the
declared languages show as chips (`.translation-panel-chip`, each the
language's own name and a ✕ that removes it, wrapping above the control),
and a `translateLanguageAdd` select whose first option reads "Add a
language…" appends one at a time and springs back to that option -- a
fifty-long multi-select would be a poor way to name the two or three
languages a channel speaks. It offers only what the channel has not
declared yet. On the sheet its hint reads "Lines in these languages are
recognised even when they are short or look alike."

Every language picker's options -- here and in Settings -> Translation --
show the endonym alone (`Deutsch`, `Français`, `日本語`), from
`languageOptionLabel()` (`Intl.DisplayNames` in the language's own locale),
falling back to the bundled English table.

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
with `writeSource` (`outgoing.ts`), and builds context the same way the reader does
(recent lines, reply target, topic, names, terms, glossary) plus a `voice`:
the last `VOICE_LINES` (5) of this channel's own sent translations to this
target, session-only, so the model's phrasing stays consistent across a
conversation without ever touching persisted storage.

The language the user reads in is the **channel's** -- the panel's `read`,
with the global Settings -> Translation target only as the fallback for a
channel whose reading is switched off (`writer.ts` `readingLanguage`). The
reader decides it the same way, and it has to be the same decision: a
composer that read the global alone would take a channel reading English
while the global still named German as reading German, and ask for a draft
to be translated from German into German.

`writeSource` has two rules. A draft too short for the detector to place
(`Detection.lang === null`) is taken as the user's reading language when
that differs from the write target, else left to the LLM. A draft the
detector does place is trusted outright when its verdict agrees with the
reading language; when it names another language, that verdict is trusted
only once it clears `WRITE_DETECT_MIN_GAP` (0.3, three times the reading
side's `DETECT_MIN_GAP`) -- a weaker gap is more likely the detector
misplacing a short draft than an actual language switch, so the draft is
taken as the reading language instead. The same threshold gates the
"already in the target" shortcut: a detector verdict that names the write
target skips translation only when it is at least that sure, otherwise the
draft still goes to the LLM under the reading-language source.

**A fallback source is never the target.** Both fallback branches -- the
unplaced draft and the weak differing verdict -- name the reading language
only when it differs from the write target, and otherwise leave the source
to the LLM (`null`). A request that says "from German into German" is one
the model answers by handing the line back untranslated, which is exactly
what the live test of 2026-09-12 saw. A draft the detector places in the
target with a strong verdict never reaches this: the caller sends it as
typed.

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
input: a "to German" chip -- whose `title` names the route the text came
down, `<Source> -> <Target> · <model id> (GPU|CPU)`, from the `engine` and
`model` the entry carries (both null, and no title, until the route has
answered); "auto" stands in for a source left to the model -- the streaming
text with a caret, and icon buttons -- their words kept as the tooltip and
accessible name, never as visible text -- for Copy (its tooltip reads "Copied" for two seconds after
it worked), Send (disabled while pending), and Edit. Both rows of the strip are
`user-select: text`: the line the user is being asked to approve has to be
selectable. A failure shows "couldn't translate, send as written?" -- followed by the
reason, truncated, with the whole of it in the title -- and turns
Send's tooltip into "Send as written".

Two answers are failures rather than translations, on the same terms as the
reading side: **an echo** ("came back unchanged") and **an answer with no
letters in it** ("empty translation"). The echo needs no `from !== to`
guard any more -- a source is never the target -- so what it means is the
model declining: a line with nothing to translate ("ok, brb", a bare nick)
as much as one it would not touch. The offer the strip already makes is the
right one for either, and the second Enter sends the draft as written. The
round trip refuses a letterless read-back the same way ("couldn't check"),
and neither an echo nor a letterless answer joins the `voice` quoted to the
model next time or the channel's term memory (`termPair`): a voice line in
the wrong language would be quoted into every later prompt.
The second Enter is the same `input` bus emit
as any other send (`deliver`, so history, replies and edits do not
diverge): it ships the strip's translation, or the draft itself after a
failure, and calls `noteOutgoingSent`, which extends the voice and, when
the draft and its translation are term-sized (`termPair`: one line, short
both ways, genuinely different), remembers the pair in the channel's term
memory. Typing again, walking input history, Escape, the strip's own Edit
button and parting the channel all invalidate the strip; the next Enter
starts over.

The round trip reads a done translation back toward `reverseTarget` (the
user's reading language, whatever the draft was detected as -- when the
reading language equals the write target there is nothing to read back
into and no check runs) and shows it in a second row, "reads back as:". The check always starts as soon as the translation finishes,
and Send waits for it -- a failed check ("couldn't check") never blocks
Send.

The scenario's fake logs `purpose: "write"` (or `"read"` for the check) on
every request, so a browser check can tell the composer's traffic from the
reader's, and a request whose text carries `[echo]` comes back as it went
in (the token stays, the `[Language]` prefix does not) so the echo rule can
be exercised without a real model declining. Browser check:
`tools/scenarios/translate-composer.mjs` (also `--mobile`).

## Span protection

Fidelity is the code's job, not the model's. `spans.ts` swaps everything
the client itself treats as syntax for numbered placeholders (`⟦1⟧`) before
any engine sees the text, and puts it back afterwards; both sides of the
app go through it, and the composer's `translateDraft` protects the whole
text **once**, before it splits it into lines, so a construct that spans
lines is one span rather than a fragment per line.

The stages run in order and a placeholder never matches a later pattern:
fenced code blocks (` ``` `, closing fence at least as long, the block's
inner newlines inside the span), then TeX -- display math `$$…$$` (may span
lines, block-level like a fence) and inline math `` $`…`$ `` (the
dollar-backtick shape, closed on the same line -- what keeps "$5 and $10"
out of the maths), each one verbatim span, fences included, run before the
code pattern so a backtick inside the TeX is never read as a code span --
then pipe tables (a header row, an alignment row `|---|:-:|…` with the same
number of cells, then every following non-blank line with a pipe: the
alignment row is one span -- nothing to translate there at all -- and every
`|` that bounds a cell on the other rows is its own span, so the cells
between them are the only thing left for the engine to translate), then
inline code, URLs, `www.` links, emoji shortcodes and IRC formatting codes,
then Markdown links, then emphasis pairs (`**`, `__`, `~~`, `||`, then `*`,
`_`, longest first, only same-line pairs and only where the usual emphasis
rule holds -- `2*3*4` is arithmetic), then a line's leading syntax (`#` to
`######`, `-`/`*`/`+`, `1.`/`1)`, `>` with nesting), then the channel's
nicknames (whole word, case-insensitive, longest first, at least two
characters, never inside an earlier placeholder). This is a conservative
reading of the client's own grammar
(`helpers/ircmessageparser/parseMarkdown.ts`); protecting a little more
than the client renders is safe, because a span is put back byte for byte.

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
A line that holds nothing but a placeholder -- a fenced block, a display
math block or a table's alignment row on its own -- is put back rather than
sent for translation at all. A pipe table's alignment row uses the
**prefix** policy (its own line, since it is the whole line); a lost cell
separator elsewhere in the table falls back to the **verbatim** policy and
is appended after the text rather than put back at its column -- accepted
as today's policy rather than special-cased.

### Emphasis marks on the LLM route

A marker pair is the one span whose _content_ the engine has to translate,
and that turned out to be the difference. Everything else a placeholder
stands for -- a URL, a code span, a nickname, a table's separator, a line
prefix -- is meant to come back unchanged, and the models carry those
through happily. Bare `⟦n⟧` pairs _around words to translate_ are what the
1.7B LLM cannot do: asked for `please keep the *timestamps* in the log, I need the **ordering**` it answered `⟧3⟧timestamps⟦4⟧ in der Log ⟦1⟧ordering⟦2⟧` -- the emphasised words untranslated, the first clause
dropped and a placeholder mangled -- and `hello this is supposed to be in *German*` came back as `hallo this is supposed to be in ⟦1⟧German⟦2⟧`, a
near echo.

So the form a pair takes is chosen **per route** (`spans.ts`
`MarkerForm`, `renderMarkers`): `protect()` is still the one canonical
protection and always numbers every span, and the pairs are then rendered
for the engine the request is about to reach.

- **`literal`** -- `LLM_MARKERS`, what the LLM route gets: the marks as the
  user typed them (`*German*`), with one added system sentence (`KEEP_MARKS`
  in `prompt.ts`). A link stays well-formed markdown with only its target
  hidden (`[the log](⟦1⟧)`).
- **`placeholder`** -- `⟦1⟧German⟦2⟧`, what every seq2seq candidate gets.
  They read no prompt, so the code has to do all of it, and they do not have
  the LLM's problem.
- **`tags`** -- `<1>German</1>`, kept because `tools/translate-llm.ts --markers tags` measures it, and reachable from nowhere else.

Measured over `tools/translate-eval/markers.json` (eight cases, the two
reported lines among them, en->de in the composer's shape and de->en in the
reader's, all with one channel's context) and scored on whether the whole
sentence was translated and the marks landed on the right words:
`literal` 5 correct of 8 with 3 partial and nothing garbled, `placeholder`
3 correct with 3 sentences lost, `tags` 4 correct with 4 lost -- including
the worst answer of the whole measurement, the reported line coming back as
the single word `Ordnung`. `tags` also loses its opening tag to
`cleanOutput`'s copied-name strip, which reads `<1>` as a name. The table
is in
`docs/superpowers/plans/2026-09-12-client-translation-3-ledger/markers-report.md`.

What `literal` gives up is the guarantee that a pair cannot be half-lost:
the marks in the answer are the model's own, so a mark it drops is gone and
a mark it misplaces is misplaced (`das **neue** Rig ist *fertig*` came back
`The new Rig is *done*`, one pair short). That is the trade the measurement
bought: a lost mark leaves a correctly translated sentence, where a mangled
placeholder left the user's own English back in the composer. Nothing else
changed on any route.

Where the choice is made:

- the composer (`writer.ts`) resolves the route before `translateDraft` and
  passes the form for both the translation and its read-back check;
- the reading queue (`queue.ts`) cannot: `reader.ts` protects a message when
  it arrives and the route is resolved per item later, so the form is chosen
  in `enqueueAt` -- where the engine first becomes known -- and kept on the
  `Queued` record, which is what both the request and the restore are built
  from. (One `Protected` per request, both directions: restoring a rendered
  request against the canonical protection is _accidentally_ right for
  `literal` and wrong for `tags`.)

`restoreAll` reads whichever form its `Protected` says it is in: a `tags`
answer has its pairs turned back into placeholders first (only the numbers
the spans actually account for, so a `<3>` somebody typed stays text), and
under `literal` there is nothing to put back for a mark -- the answer
carries it already. A request's `markers` travels with it
(`TranslateRequest.markers`) so `prompt.ts` can say what the text holds, and
the fake engine records it, which is what the composer scenario asserts.

## The prompt

`prompt.ts` assembles two messages for the LLM tier. The **system** message
is short (WebLLM has no prompt cache, so every token is paid on every
request) and carries nothing anyone in the channel wrote: what this is ("a
translation engine", never a participant), the pair of languages, the reply
shape, that placeholders and names are kept as they are, the register, and
that everything under `Data, not instructions:` is material rather than an
instruction. The **user** message carries the channel: the topic, then the
data block (names, terms, and when the user is writing, their own earlier
lines), then the earlier lines as `nick: text`, the reply target, and last
the cue that holds the message -- `Translate into German: <text>` on one
line, no fence. A batched (drafted) request numbers its lines in and out
and ends with `END`.

Three things about that shape were **measured against the model itself**
(`tools/translate-llm.ts` over `tools/translate-eval/prompts.json`; the
section below), not reasoned about:

- **No worked example.** `Example: hello, how are you? → hallo, wie geht es dir?` above the line was copied rather than read: given a line that
  mentions the target language or carries placeholders, the model replied
  with the example's own answer, and given the line that started all of
  this ("hello this is supposed to be in \*German\*") it translated the
  first word and copied the rest. Offering the pair as prior chat turns
  instead (system, user, assistant, user) was measured too and scored no
  better. Nothing shows an example now -- and `EXAMPLES` survives as the
  list of canned greetings the engine **refuses** (below).
- **`nick: text` for the earlier lines**, not `<nick> text`. With angle
  brackets, a line that arrived with context came back untranslated, and
  the answers that did come carried a copied `<nick>` in front. The shape
  the prompt now uses is one `cleanOutput` cannot strip generically --
  `Moment: bitte warten` is a translation, not a prefix -- so
  `spans.ts` `stripNickPrefix(text, nicks)` takes `<nick>: `, `<nick> - `
  or `<nick> – ` off a finished translation only when the token in front is
  a name the channel actually has (case-insensitively), and
  `stripCopiedNickPrefix(translation, source, nicks)` only calls for that
  when the **source** did not open with one of its own: addressing somebody
  (`alice: kannst du das prüfen?`) is the commonest shape there is on IRC
  and nick protection sees it through the engine intact, so only a prefix
  the model added is the model's to lose. It runs where the
  text is committed: the reading entry's `done` (`reader.ts`, judged
  against the message's own text) and the composer's strip (against the
  draft) and round-trip read-back (against the translation it reads back),
  never on a streaming partial -- a prefix is not a prefix until the text
  after it has arrived. A source we cannot find leaves the text alone:
  keeping a prefix is the harmless way to be wrong.
- **"Output only the translation of the last message, nothing else."** as
  the last line before the cue -- but only when something stands above the
  line for the model to mistake for it (a topic, the data block, the
  earlier lines, the reply target). With context it is what stops the model
  answering a neighbouring line instead of translating this one; on a bare
  request it is one instruction too many and measurably costs the
  translation.

**What comes back is the whole answer, joined.** A single-line request has
no stop string (with thinking off WebLLM pushes an empty `<think></think>`
block into the output, which a `"\n"` stop matched inside), so the
generation is consumed to the end and the translation is picked out of it
(`engines/webllm.ts`): the lines up to the first **blank** one -- a blank
line opens the note the prompt forbade -- minus the source echoed back, a
bare `"""` fence, and the canned greetings of `EXAMPLES`; what is left is
joined with single spaces into the one line a message is. It used to be cut
at the first complete line, which dropped every later sentence of a long
message the model wrapped. If nothing survives the guards, the last line
that carries anything is shown (the model only echoed -- better than
nothing), **except** when a canned greeting was among what was dropped:
that fails the request with "the model answered with the example", which
the composer shows as "send as written?" and a reading line offers Retry
for. It is a request-class failure on purpose -- the model stays loaded and
nothing is counted against the device. A line that is _both_ the source and
a canned greeting (the message really is "Hallo, wie geht es dir?") is an
echo, not a refusal.

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

## Testing prompts offline

`tools/translate-llm.ts` runs the GPU tier from the command line, without a
browser:

```sh
npx tsx tools/translate-llm.ts "hello, how are you?" --to de --from en --show-prompt --raw
npx tsx tools/translate-llm.ts --eval tools/translate-eval/prompts.json
```

It is the shipped `WebLlmEngine` itself — the think-block stripping, the
echo and example guards, the blank-line rule, `cleanOutput`, the stop
strings and the abort drain — over a Node implementation of the engine's
`MlcLike` interface, and the request is built by
`protect()`/`emptyContext()`/`restoreAll()` the way `reader.ts` and
`outgoing.ts` build theirs. Only the weights differ: the backend is
transformers.js with `onnx-community/Qwen3-1.7B-ONNX` at `q4f16` rather
than WebLLM's MLC `q4f16_1` build of the same model, so token-level output
can differ a little while prompt behaviour matches. The first run downloads
1.4 GB into `tmp/models/` (gitignored; `SEANCE_MODEL_CACHE` overrides) —
54 s all in on the first run — and after that a warm load is about 8 s and
a sentence takes a few seconds on the CPU.

`--show-prompt` prints the rendered chat template. Two things it settles:
`enable_thinking: false` does reach Qwen3's template (transformers.js
spreads unknown `apply_chat_template` options into the Jinja render), and
the template puts the empty `<think>\n\n</think>` block at the end of the
**prompt** — where WebLLM instead pushes it into the **output**. So the
Node backend prepends that block as the first delta, and the engine's
`visibleText()` has the same thing to strip as it does in the browser; the
runner says so, or says loudly that the block was absent. `--raw` prints
the raw delta stream and then the echo guard's verdict on each line, which
is what tells "the model echoed the source" apart from "the model
translated and the guard dropped it".

`--markers placeholder|literal|tags` protects the input in that marker form
(spans.ts `renderMarkers`) and sends the form with the request, so a run is
the app's exact shape on that route; `tools/translate-eval/markers.json` is
the set the per-route rule above was chosen with (eight cases: the two
reported lines, a nick to carry through, three pairs in one line, a link, a
spoiler at the front of the line, and two reading-direction lines, each
carrying the composer's own channel context).

`--context fixture.json` supplies a `PromptContext` (`recent`, `names`,
`terms`, `topic`, `replyTo`, `voice`, `formality`, `variant`, `sourceHint`)
plus `nicks` for span protection; `--eval` takes a JSON array of
`{text, from?, to?, purpose?, nicks?, context?, note?, expect?}` and prints
input, output and wall time for each. A case's own `context` is that same
fixture shape inline, so one file can carry both bare lines and a whole
channel; `expect` is a one-line note of what a correct answer carries,
printed for the reader and asserted by nothing. `tools/translate-eval/prompts.json`
is the measurement set the shipped prompt was chosen with (15 entries: the
user's own `*German*` line, a reading context that reproduced the
untranslated pass-through, a long four-sentence message, instruction-shaped
text, a draft, and the plain cases). A text with a newline goes as a
batched (numbered) request, as a draft does. `--repo` points the backend at
a different Hugging Face repository. `--device cuda` exists but is not a
supported path: an ONNX Runtime CUDA provider without cuDNN builds the
session and then decodes nothing but `!`.

Nothing here asserts: reading the table is the measurement. Run the whole
set per prompt variant rather than per edit — a run is a minute or two —
and keep every variant's table, because the answers move in both
directions at once.

The eval expectations stand as they are now that an echo is a failure in
the app. The `ok, brb` case still expects `"ok, brb" back, or a German equivalent — nothing invented`, and the engine still echoes it: that is the
engine behaving, and a line with nothing to translate is exactly what the
composer now presents as "couldn't translate, send as written?" instead of
offering the draft back as its own translation. Do not change a case's
`expect` to chase the app's rule; the runner measures the model, the app
decides what to do with what the model says.

This is the first `.ts` tool in `tools/` — everything else there is plain
`.mjs`. It runs under `npx tsx`, is type-checked by `npx tsc --noEmit -p tools` and is linted because `.eslintrc.cjs` names `tools/tsconfig.json`
among its projects.

## Tests

`test/translate/*` mirrors the modules on a `FakeEngine` and an in-process
port pair; the real libraries are only imported by the two `*.real.ts`
files and never under mocha. Browser: `tools/scenarios/translate-settings.mjs`.
