# Markdown messages

Status: implemented on `markdown-messages-development` (2026-08-29).

Discord-style Markdown is rendered in everything `ParsedMessage` shows when
the `markdown` setting (default on, Settings → Appearance → Messages) is set.
Display-only; nothing changes on the wire.

The MOTD is the exception. It is pushed as a `MONOSPACE_BLOCK`
(`client/js/irc/handlers/numerics.ts`, `motdEnd`), and a monospace block is a
code block — nothing is interpreted inside one, so it renders verbatim and its
ASCII-art banners keep their `_____`, `\_` and `|...|`. `ParsedMessage` has a
`markdown` prop (default `true`) that `MessageTypes/monospace_block.vue` sets
to `false`; the setting can only ever turn Markdown off, never back on.

Design: `docs/superpowers/specs/2026-08-29-markdown-messages-design.md`.

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
  (link/channel/emoji/nick) and the wraps (`quote`, `codeBlock`, `spoiler`,
  `href`, nested in that order). It imports no Vue, store or DOM, so the
  rendering decision is unit-testable.
- The adapters walk that tree. `parse()` (`client/js/helpers/parse.ts`) is the
  Vue one and the whole of its interface: inside it a private `toVNodes` walk
  owns `createFragment`, the wrap elements and the four `renderPart` branches.
  `toPlainText` is the other, used by `Chat.vue`'s `plainTopic` for the
  window-title `title` attribute.

A masked link is an `<a class="md-link" title="<url>">`; the class is what
tells it apart from a linkified anchor. CSS for the wrapped elements
(`.md-quote`, `.md-code-block`, `.md-spoiler`/`.md-spoiler-shown`) lives in
`client/css/style.css`, after `.irc-italic`.

## Code blocks

A code block is rows: `CodeBlock.vue` renders one `<span class="md-line">` per
line inside the `<code class="md-code-block">`, and blocks of two lines or more
also get `md-code-block--numbered`, whose CSS counter draws the gutter. The
number is `::before` content, so selecting the block copies the code and not the
numbers. The block renders its plain characters — a code block is a verbatim
span, so IRC colour codes inside one do not style it and a URL inside one is not
a link.

Highlighting is `highlighter.ts` (Vue-free, mocha loads it):

- The fence's language tag is kept by `applyMarkdown` as `lang` and carried on
  the layout tree's `codeBlock` wrap. It is a tag only when the fence line ends
  in a newline — ` ```js x``` ` on one line is content, as on Discord.
  `normalizeLang` resolves it through Prism's own alias table
  (`prismjs/components.json`, so nothing is hand-maintained): `js` →
  `javascript`, `sh` → `bash`, plus the punctuation forms Prism has no alias for
  (`c++`, `c#`).
- An untagged block of `MIN_GUESS_LINES` (2) lines or more is guessed with
  flourite, and the guess is used only when it is `GUESS_MIN_CONFIDENCE` (0.5)
  ahead of the runner-up — flourite's scores go negative, so "ahead of the
  runner-up" is the only share that means anything.
- `ensureLanguage` fetches the grammar and its dependencies, memoised per id;
  `highlight` then turns `Prism.tokenize`'s nested tokens into one plain
  `CodeToken` array per line (innermost type wins), which the component renders
  as `<span class="tok-<type>">`. No HTML strings, so a code block is as
  XSS-proof as the rest of the pipeline. The nine token colours are CSS
  variables in `style.css` (`--tok-comment`, `--tok-keyword`, …) with dark
  values in `themes/morning.css`.
- Everything is lazy: `js/highlighter.js` (Prism's core and alias table),
  `js/prism-<lang>.js` (one per grammar; `webpackInclude` in `highlighter.ts`
  picks the 71 this deploy ships, closed over Prism's own dependency links) and
  `js/flourite.js`. Only a block that names a language or is long enough to
  guess fetches anything at all. The service worker precaches the shell, not
  these, so the first block in an offline app stays plain — a failed import is
  caught, and the block simply never highlights.

**Not reachable from IRC yet.** Both paths need a newline in the message: a
fence tag is only a tag before one, and a guess needs two lines. An IRC message
carries no newline — `dispatchInput` sends one message per line and the client
does not have `draft/multiline` (`client/js/irc/caps.ts`) — so today no message
this client can send or receive produces a language tag or a gutter. The
machinery is in place for when multiline lands; what ships now is the plain row
layout for the single-line blocks people do send.

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

## Tests

- `test/helpers/parseMarkdown.ts` — one `describe` per row of the spec's syntax
  table, asserting the text and flags `applyMarkdown` produces. No offsets: a
  fragment boundary moving is not behaviour.
- `test/helpers/layout.ts` — the tree a message renders as, wraps and parts
  included.
- `test/helpers/highlighter.ts` — tag normalisation, line splitting, the token
  → node mapping (against a stub grammar and a real one), and the guesser.
- `test/e2e/markdown.spec.ts` — `SEANCE_E2E_IRC_URL=wss://host:port/ yarn test:e2e`
  drives the built client against a live ircd with Playwright. It covers what
  only a browser can answer: that the elements the tree names really appear,
  that the spoiler toggles, and that a code block renders as one row. It cannot
  cover highlighting, for the reason above: no message it can send holds a
  newline.
