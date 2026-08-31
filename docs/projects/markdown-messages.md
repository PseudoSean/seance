# Markdown messages

Status: implemented on `markdown-messages-development` (2026-08-29); headers
and collapsing large code blocks added on `markdown-messages` (2026-08-31,
plan in `docs/archives/2026-08-31-markdown-documents-plan.md`).

Discord-style Markdown is rendered in everything `ParsedMessage` shows when
the `markdown` setting (default on, Settings → Appearance → Messages) is set.
Display-only; nothing changes on the wire.

The MOTD is the exception. It is pushed as a `MONOSPACE_BLOCK`
(`client/js/irc/handlers/numerics.ts`, `motdEnd`), and a monospace block is a
code block — nothing is interpreted inside one, so it renders verbatim and its
ASCII-art banners keep their `_____`, `\_` and `|...|`. `ParsedMessage` has a
`markdown` prop (default `true`) that `MessageTypes/monospace_block.vue` sets
to `false`; the setting can only ever turn Markdown off, never back on.

Design: `docs/archives/2026-08-29-markdown-messages-design.md`.

## How it works

The pipeline is `parseStyle` → **`applyMarkdown`** → finders → `merge` →
**layout tree** → `parse()` / `toPlainText`. Its vocabulary — fragment,
marker, opaque span, verbatim span, finder, part, layout tree, wrap, masked
link, monospace block — is defined in `CONTEXT.md`; use those words.

- `applyMarkdown` (`client/js/helpers/ircmessageparser/parseMarkdown.ts`)
  removes the marker characters and sets the flags on the style fragments,
  handing back `{fragments, verbatim}` — the verbatim spans are the stretches
  nothing is interpreted inside, and the channel/nick/emoji finders skip them.
  It is the module's only entry point; the marker scan behind it is private.
  URLs are opaque to the scanner: `opaqueSpans` runs `findLinks` and
  `trimTrailingEmphasis` peels the trailing `**` linkify-it swallows back off,
  so the markers around a URL still close.
- `layout(text, options)`
  (`client/js/helpers/ircmessageparser/layout.ts`) decides what a message
  renders as and says so as plain data: a `LayoutNode` tree of text nodes
  (presentational style only), the parts a finder made interactive
  (link/channel/emoji/nick) and the wraps (`quote`, `header`, `codeBlock`,
  `spoiler`, `href`, nested in that order). It imports no Vue, store or DOM, so
  the rendering decision is unit-testable.
- The adapters walk that tree. `parse()` (`client/js/helpers/parse.ts`) is the
  Vue one and the whole of its interface: inside it a private `toVNodes` walk
  owns `createFragment`, the wrap elements and the four `renderPart` branches.
  `toPlainText` is the other, used by `Chat.vue`'s `plainTopic` for the
  window-title `title` attribute.

A masked link is an `<a class="md-link" title="<url>">`; the class is what
tells it apart from a linkified anchor. CSS for the wrapped elements
(`.md-quote`, `.md-header`/`.md-h1`…`.md-h6`, `.md-code-block`,
`.md-code-toggle`, `.md-spoiler`/`.md-spoiler-shown`) lives in
`client/css/style.css`, after `.irc-italic`. The channel header's topic is one
clipped `nowrap` line, so the block-level ones are overridden back to `inline`
there — and the collapse toggle to `display: none`.

## Headers

`#` to `######` followed by one space at the start of a line makes that line a
header, the way `> ` makes it a quote — a header is a **line-level** thing and
ends at its newline, so `# Title` on the first line of a pasted document leaves
the rest of it alone. `#chan` is not a header (no space), `\#` escapes, markers
inside a header still work (`# **bold** title`) and `> # q` nests the header
inside the quote. Nothing else of Markdown's header syntax is taken: no closing
hashes, no `===` underline, no anchors.

The level is the wrap's value (`{wrap: "header", level: 1…6}`), which is what
keeps two adjacent lines of different levels in wraps of their own. It also
means two adjacent lines of _one_ level necessarily share a single wrap, whose
text holds the newline between them — hence `white-space: pre-wrap` on
`.md-header`, without which the two headings would render as one line. The
newlines a header line sits between are removed the way a fence's are, so a
header leaves no blank row behind it.

`parse.ts` renders the wrap as `<span class="md-header md-h<level>">`; the
stylesheet does the rest, capped for chat rather than for a document: h1
1.5em/700 down to h6 0.85em/600 uppercase and muted, h5 and h6 in
`--body-color-muted`. Only the size, weight and colour are the level's — the
element is the same in all six.

## Code blocks

A code block is rows: `CodeBlock.vue` renders one `<span class="md-line">` per
line inside the `<code class="md-code-block">`, and blocks of two lines or more
also get `md-code-block--numbered`, whose CSS counter draws the gutter. The
number is `::before` content, so selecting the block copies the code and not the
numbers. The block renders its plain characters and nothing else: `parse.ts`
builds it from `toPlainText` of the wrap's children, so IRC colour codes inside
one do not style it and a URL inside one is not a link, as on Discord. Inline
`` `code` `` is not flattened that way, so a URL there is still a link — the
verbatim span suppresses the channel/nick/emoji finders in both, but `findLinks`
runs on the whole message and it is the block that drops what it found.

A message that renders at least one code block gets a **Copy code** action in
its own hover toolbar (`MessageActions.vue`, `.msg-action-copy`, next to
reply/react/edit; the glyph turns into a check mark and the `aria-label`/`title`
into "Copied" for 1.5 s). It is not a control on the block: the toolbar already
appears on hover and works on touch (`.msg-actions.active`), and a second
control in the same corner was neither reachable with a mouse nor with a thumb.
Which blocks a message holds is decided on the layout tree, not on the DOM:
`codeBlocksOf(nodes)` (`layout.ts`) returns each `codeBlock` wrap's
`toPlainText`, so what is copied is the block's characters — newlines included,
without the fence or the gutter — and several blocks are joined by a blank line.
The `markdown` setting off means there are no blocks and no action. The copy
itself is `writeClipboard` (`client/js/clipboard.ts`): `navigator.clipboard`
where it works, an off-screen `<textarea>` and `document.execCommand("copy")`
where it does not (a deploy served over plain http is not a secure context).
Both paths fail silently, and a copy that did not happen leaves the label alone.

A block of more than `COLLAPSE_THRESHOLD` (12) lines is **collapsed**: it
renders its first `COLLAPSE_EXCERPT` (8) lines and a
`<button class="md-code-toggle">` reading `Show all N lines`. The hidden lines
are not in the DOM, so selecting a collapsed block copies what it shows; the
toolbar's Copy code action is unaffected, because it reads the layout tree and
not the rows. `excerptRange(lineCount)` in `codeLines.ts` is the whole decision
— pure, and settled before Prism is fetched — and, like the gutter width, it is
computed from the plain text, so neither moves when the tokens land. The
highlighter still sees the whole code once; only the rendered rows are sliced,
so the gutter counts 1…8 and then 1…N with nothing restarting mid-block. The
state is the component's own: an edit keeps it (the text changes under the same
instance, which is why the token reset is a `watch`), and the `markdown` setting
flipping unmounts the block, so it comes back collapsed — as a shown spoiler
comes back hidden.

The MOTD never collapses. It is a monospace block, and
`MessageTypes/monospace_block.vue` renders it through `ParsedMessage` with
`:markdown="false"`, so there is no `codeBlock` wrap and `CodeBlock.vue` never
mounts for it.

Flipping it changes a height in the middle of the timeline, so `CodeBlock.vue`
restores the scroll position around the change: a reader who was at the bottom
of the channel stays at the bottom — `MessageList`'s own at-bottom formula,
verbatim, so the two never disagree about the same scroller — and anyone else
keeps the block's top edge exactly where it was on screen.

Highlighting is `highlighter.ts` (Vue-free, mocha loads it):

- The fence's language tag is kept by `applyMarkdown` as `lang` and carried on
  the layout tree's `codeBlock` wrap. It is a tag only when the fence line ends
  in a newline — ` ```js x``` ` on one line is content, as on Discord.
  `normalizeLang` resolves it through Prism's own alias table
  (`prismjs/components.json`, so nothing is hand-maintained): `js` →
  `javascript`, `sh` → `bash`, plus the punctuation forms Prism has no alias for
  (`c++`, `c#`).
- An untagged block of `MIN_GUESS_LINES` (2) lines or more is guessed with
  flourite, and the guess is used only when it is strictly past
  `GUESS_MIN_CONFIDENCE` (0.5), i.e. strictly ahead of the runner-up —
  flourite's scores go negative, so "ahead of the runner-up" is the only share
  that means anything.
- `ensureLanguage` fetches the grammar and its dependencies, memoised per id;
  `highlight` then turns `Prism.tokenize`'s nested tokens into one plain
  `CodeToken` array per line (innermost type wins), which the component renders
  as `<span class="tok-<type>">`. No HTML strings, so a code block is as
  XSS-proof as the rest of the pipeline. The nine token colours are CSS
  variables in `style.css` (`--tok-comment`, `--tok-keyword`, …) with dark
  values in `themes/morning.css`.
- Everything is lazy: `js/highlighter.js` (Prism's core and alias table),
  `js/prism-<lang>.js` (one per grammar; `webpackInclude` in `highlighter.ts`
  picks the 72 this deploy ships, closed over Prism's own dependency links) and
  `js/flourite.js`. Only a block that names a language or is long enough to
  guess fetches anything at all. The service worker precaches the shell, not
  these, so the first block in an offline app stays plain — a failed import is
  caught, and the block simply never highlights.

**Needs multiline.** Both paths need a newline in the message: a fence tag is
only a tag before one, and a guess needs two lines. So does a collapsed block,
and so does a header. Newlines reach the wire where the client and the server
both negotiate `draft/multiline` (`client/js/irc/caps.ts`, merged), and the
browser cover for all of it is the multi-line cases in
`test/e2e/markdown.spec.ts` — ungated now that it is.

## Licensing

Both are MIT, and their copyright notices ship with the chunks that carry them:

| Package    | Version | Licence | Upstream                                   | Notice in                              |
| ---------- | ------- | ------- | ------------------------------------------ | -------------------------------------- |
| `prismjs`  | 1.30.0  | MIT     | https://github.com/PrismJS/prism           | `public/js/highlighter.js.LICENSE.txt` |
| `flourite` | 1.3.0   | MIT     | https://github.com/teknologi-umum/flourite | `public/js/flourite.js.LICENSE.txt`    |

Terser extracts Prism's own `@license` comment, which names the author but not
the copyright line, and flourite's build carries no comment at all, so
`webpack.config.ts` states both in a `/*!` banner (`chunkNotices`) that terser
then extracts. The `js/prism-*.js` grammar chunks are Prism's too; the
highlighter chunk's notice says so.

## Shortcuts

`Alt+K` (`⌥K` on Apple) toggles the `markdown` setting, same as the
Settings → Appearance → Messages checkbox — bound in `client/components/App.vue`
alongside the other `Alt+<key>` toggles and listed in the Help window's shortcut
table. The checkbox itself carries no hint — no other setting does.

## Tests

- `test/helpers/parseMarkdown.ts` — one `describe` per row of the spec's syntax
  table, asserting the text and flags `applyMarkdown` produces. No offsets: a
  fragment boundary moving is not behaviour.
- `test/helpers/layout.ts` — the tree a message renders as, wraps and parts
  included, what the adapter is handed for a code block (its characters, URL
  included), and what `codeBlocksOf` reads back out of it for the Copy code
  action.
- `test/helpers/highlighter.ts` — tag normalisation, line splitting, the token
  → node mapping (against a stub grammar and a real one), and the guesser.
- `test/helpers/codeLines.ts` — `excerptRange` and the two collapse constants,
  the decision a block makes before Prism is anywhere near it.
- `test/e2e/markdown.spec.ts` — `SEANCE_E2E_IRC_URL=wss://host:port/ yarn test:e2e`
  drives the built client against a live ircd with Playwright. It covers what
  only a browser can answer: that the elements the tree names really appear,
  that the spoiler toggles, that a code block renders as one row, that a URL
  inside one is not an anchor and that the toolbar's Copy code action puts the
  block's characters on the clipboard (and is absent from a message without a
  block). The multi-line cases cover what only a message with newlines can
  show: the fence language tag, the gutter, headers of two levels in one
  message, and a 16-line block collapsing to 8 rows, expanding, collapsing
  again — with the Copy code action still yielding all sixteen lines.
