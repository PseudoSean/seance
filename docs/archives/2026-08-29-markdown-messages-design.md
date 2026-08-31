# Markdown messages — design

Date: 2026-08-29. Branch: `markdown-messages-development`.

> Historical. The live syntax reference is the project note,
> `docs/projects/markdown-messages.md` — this table predates headers.

## Goal

Optionally render Discord-style Markdown in everything `ParsedMessage` displays
(chat messages, notices, actions, channel topics, status lines, list windows).
Display-only: nothing changes on the wire. Controlled by a boolean setting
`markdown` (default **on**) under Settings → Appearance → Messages.

One exemption: the MOTD is a monospace block, and a monospace block is a code
block — by the "nothing is interpreted inside code blocks" rule below it is
rendered verbatim, whatever the setting says. `ParsedMessage` takes a
`markdown` prop (default `true`) and `MessageTypes/monospace_block.vue` passes
`:markdown="false"`, so MOTD banners keep their `_____`, `\_` and `|...|`.

## Syntax

| Markup                      | Result                                                                                             |
| --------------------------- | -------------------------------------------------------------------------------------------------- |
| `**text**`                  | bold (`.irc-bold`)                                                                                 |
| `*text*`, `_text_`          | italic (`.irc-italic`); `_` only at word boundaries                                                |
| `__text__`                  | underline (`.irc-underline`)                                                                       |
| `~~text~~`                  | strikethrough (`.irc-strikethrough`)                                                               |
| `` `code` ``                | inline code (`.irc-monospace`)                                                                     |
| ` ```[lang]⏎code``` `       | code block (`<code class="md-code-block">`, block-level, lang tag dropped, single-line allowed)    |
| `\|\|text\|\|`              | spoiler (`<span class="md-spoiler">`, click toggles `.md-spoiler-shown`)                           |
| `> text` at start of a line | quote (`<span class="md-quote">`, block-level, `> ` removed)                                       |
| `[text](url)`               | link (`<a href target=_blank rel=noopener title=url>`), schemes `http:`, `https:`, `web+irc:` only |
| `\*` etc.                   | backslash escapes any marker character                                                             |

Rules:

- Opening markers must be followed, and closing markers preceded, by a non-space
  character. Unmatched or malformed markers are literal text.
- `*` works inside words; `_` and `__` only when the outer side is a word boundary.
- Markers nest (`**bold *and italic***`), IRC control codes and Markdown
  compose — everywhere except inside a code block, which shows its own
  characters and nothing else, so an IRC colour code in one does not style it.
- Inside inline code and code blocks nothing else is interpreted: no markdown,
  and the nick/channel/emoji finders are suppressed. `findLinks` still runs on
  the whole message, so a URL inside inline `` `code` `` is still a link (in a
  monospace pill). A code block is different: it renders only its own
  characters, so a URL in one is not a link. The same holds for a whole
  `monospace_block` message such as the MOTD.
- URLs found by `findLinks` on the raw text are opaque to the tokenizer, so
  `https://x/a_b_c` or `https://x/**` survive intact.
- No headers, lists, tables, images, or HTML.

## Architecture

Note (2026-08-29, after implementation): the pipeline below was deepened —
the rendering decision moved into a Vue-free layout tree
(`client/js/helpers/ircmessageparser/layout.ts`) with `parse.ts` and
`toPlainText` as its adapters. See `docs/projects/markdown-messages.md`; the
syntax table above still holds exactly.

`parse()` (`client/js/helpers/parse.ts`) currently does
`parseStyle → cleanText → finders → merge → createFragment`. Markdown becomes one
extra stage inserted after `parseStyle`:

```
applyMarkdown(fragments: ParsedStyle[]): {fragments: ParsedStyle[]; verbatim: Range[]}
```

in a new dependency-free module `client/js/helpers/ircmessageparser/parseMarkdown.ts`
(no DOM, no store, so mocha can import it). It tokenises the concatenated
fragment text, splits fragments at marker boundaries, drops the marker
characters and sets flags on `ParsedStyle`:

- existing: `bold`, `italic`, `underline`, `strikethrough`, `monospace`
- new (optional): `spoiler`, `quote`, `codeBlock`, `href`

Downstream stages are unchanged and run on marker-free text. The stretches
nothing is interpreted inside come back as the `verbatim` ranges rather than as
a flag. Plain-text contexts (`Chat.vue` `plainTopic`) go through `toPlainText`,
the text adapter for the layout tree.

The wraps become layout nodes, which `parse.ts` renders:

- `href` → `<a>` wrapper (outermost)
- `spoiler` → `<span class="md-spoiler">` with an `onClick` that toggles
  `md-spoiler-shown` on `event.currentTarget` (no store state)
- `quote` → `<span class="md-quote">`
- `codeBlock` → `<code class="md-code-block">`, built from `toPlainText` of
  the wrap's children rather than from the children themselves, which is what
  makes the block verbatim

`parse(text, message, network, options?: {markdown?: boolean})` — `ParsedMessage.vue`
passes `{markdown: store.state.settings.markdown}`. Parts inside a verbatim
range are filtered out of the channel/nick/emoji finder results before `merge`.

Setting: `markdown: {default: true}` in `client/js/settings.ts`; checkbox
"Render Markdown formatting (bold, code, spoilers…)" in
`client/components/Settings/Appearance.vue` after the MOTD toggle. No migration.

CSS in `client/css/style.css` next to the `irc-*` classes: `.md-spoiler`
(background = foreground colour, text transparent; `.md-spoiler-shown` reverts),
`.md-quote` (display block, left border, padding), `.md-code-block`
(display block, `white-space: pre-wrap`).

## Testing

- Unit: `test/helpers/parseMarkdown.ts` and `test/helpers/layout.ts` (mocha
  globs `test/**/*.ts`; `test/client/**` and `test/e2e/**` are ignored by
  `.mocharc.yml`). Cover every marker, nesting, escapes, unmatched markers,
  word-boundary `_`, opaque URLs, verbatim suppression, multi-line quote/fence,
  composition with IRC codes, and the tree each message renders as.
- E2E: `@playwright/test` devDependency, `test/e2e/markdown.spec.ts`, script
  `yarn test:e2e` (`webpack && playwright test`, so it never runs against a
  stale `public/`). Skipped unless `SEANCE_E2E_IRC_URL` is set; serves
  `public/` and connects a random `seance-e2e-NNNN` nick to `SEANCE_E2E_CHANNEL`
  (default `#ps`), sends marked-up lines, asserts the rendered DOM, toggles the
  setting off and asserts plain text. Target: `wss://fractalrealities.afternet.org:9998/`.

## Out of scope

Input helpers (Ctrl+B), persisting spoiler reveal state, headers/lists/tables,
rendering libraries (`markdown-it`, `DOMPurify`).

## Addendum (2026-08-29): syntax highlighting and line numbers

Code blocks get syntax highlighting and, when multi-line, line numbers.

- **Language.** The fence's language tag (` ```js `) is kept (today it is
  dropped) and normalised through Prism's alias table (`js` → `javascript`,
  `sh`/`shell` → `bash`, `ts` → `typescript`, `yml` → `yaml`, …). An untagged
  block of two or more lines is guessed with `flourite`; the guess is used only
  above a confidence threshold, otherwise the block is plain. Single-line
  untagged blocks are never guessed.
- **Highlighter.** Prism (MIT). `Prism.tokenize()` gives a token tree that the
  Vue adapter turns into `<span class="tok-<type>">` nodes — no HTML strings,
  no sanitizer, same XSS-by-construction property as the rest of the pipeline.
- **Footprint.** Only Prism core lives in the main bundle. Each grammar and
  `flourite` are separate webpack chunks loaded with `import()` on first use;
  until a chunk arrives (or if it cannot be fetched — offline PWA, unknown
  language) the block renders as plain monospace and re-renders when it lands.
  Grammars are cached in memory per session.
- **Line numbers.** Blocks with two or more lines render one row per line with
  a gutter counter that is not part of the text selection (CSS `::before`
  counter), so copy/paste yields only the code. Single-line blocks have none.
- **Layout tree.** The `codeBlock` wrap gains `lang?: string` (the raw tag).
  Highlighting is an adapter concern: `layout()` stays synchronous and
  Vue-free; the Vue adapter asks a `highlighter` module for tokens.
- **Theme.** Token colours are defined as a small palette in `style.css`
  (comment, keyword, string, number, function, operator, punctuation, tag,
  attribute) with light and dark values, not a bundled Prism theme.
- **Licensing.** Prism and flourite are MIT. Their copyright notices ship in
  `public/js/highlighter.js.LICENSE.txt` and `public/js/flourite.js.LICENSE.txt`
  — not the vendor bundle, since neither package is in it — and are listed in
  `docs/projects/markdown-messages.md`. (Terser extracts Prism's own `@license`
  comment but that carries no copyright line, and flourite's build carries no
  comment at all, so a `BannerPlugin` states both.)
- **Tests.** Unit: tag normalisation and the highlighter module's token → node
  mapping with a stub grammar; layout test for `lang` on the wrap; e2e: a
  tagged block renders `.tok-keyword` spans and a line-number gutter.
- **Monospace runs merge into inline code (2026-08-29).** Not part of the
  highlighting work, but accepted with the layout refactor that preceded it:
  `verbatim` is no longer a style key, so an IRC monospace run immediately
  abutting inline code — `\x11a\x11` followed by `` `b` `` — is now one
  fragment `{text: "ab", monospace}` and renders as one `.irc-monospace` pill
  instead of two. Both halves were monospace before and after; only the pill
  count changed. Covered by `test/helpers/parseMarkdown.ts` ("merges an IRC
  monospace run into the inline code beside it").
- **Code blocks render their characters, and only those (2026-08-29).** The
  Rules above said "URL detection still runs", which is true of the detection
  and false of the result: `parse.ts` builds a code block from
  `toPlainText(node.children)`, so a URL inside a fence is not an anchor and an
  IRC colour code in one does not style it — the block is its characters, as on
  Discord. Inline `` `code` `` is unaffected, because only the block is
  flattened: a URL there is still a link. The layout tree keeps the `link` node
  in both cases (`test/helpers/layout.ts`, "still finds a link inside a code
  block"); it is the adapter that decides. Pinned by "renders a code block from
  its characters alone" in `test/helpers/layout.ts` and by
  `test/e2e/markdown.spec.ts` asserting a fenced block with a URL in it has no
  `<a>`.
