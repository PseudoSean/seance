# Markdown messages — design

Date: 2026-08-29. Branch: `markdown-messages-development`.

## Goal

Optionally render Discord-style Markdown in everything `ParsedMessage` displays
(chat messages, notices, actions, channel topics, the MOTD, status lines, list
windows). Display-only: nothing changes on the wire. Controlled by a boolean
setting `markdown` (default **on**) under Settings → Appearance → Messages.

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
- Markers nest (`**bold *and italic***`), IRC control codes and Markdown compose.
- Inside inline code and code blocks nothing else is interpreted: no markdown,
  and the nick/channel/emoji finders are suppressed. URL detection still runs.
- URLs found by `findLinks` on the raw text are opaque to the tokenizer, so
  `https://x/a_b_c` or `https://x/**` survive intact.
- No headers, lists, tables, images, or HTML.

## Architecture

`parse()` (`client/js/helpers/parse.ts`) currently does
`parseStyle → cleanText → finders → merge → createFragment`. Markdown becomes one
extra stage inserted after `parseStyle`:

```
applyMarkdown(fragments: ParsedStyle[], opaque: {start,end}[]): ParsedStyle[]
```

in a new dependency-free module `client/js/helpers/ircmessageparser/parseMarkdown.ts`
(no DOM, no store, so mocha can import it). It tokenises the concatenated
fragment text, splits fragments at marker boundaries, drops the marker
characters and sets flags on `ParsedStyle`:

- existing: `bold`, `italic`, `underline`, `strikethrough`, `monospace`
- new (optional): `spoiler`, `quote`, `codeBlock`, `href`, `code` (suppresses finders)

Downstream stages are unchanged and run on marker-free text. Also exported:
`stripMarkdown(text: string): string` for plain-text contexts (`Chat.vue`
`plainTopic` title attribute).

`createFragment` renders the new flags:

- `href` → `<a>` wrapper (outermost)
- `spoiler` → `<span class="md-spoiler">` with an `onClick` that toggles
  `md-spoiler-shown` on `event.currentTarget` (no store state)
- `quote` → `<span class="md-quote">`
- `codeBlock` → `<code class="md-code-block">`

`parse(text, message, network, options?: {markdown?: boolean})` — `ParsedMessage.vue`
passes `{markdown: store.state.settings.markdown}`. Parts inside `code` fragments
are filtered out of the channel/nick/emoji finder results before `merge`.

Setting: `markdown: {default: true}` in `client/js/settings.ts`; checkbox
"Render Markdown formatting (bold, code, spoilers…)" in
`client/components/Settings/Appearance.vue` after the MOTD toggle. No migration.

CSS in `client/css/style.css` next to the `irc-*` classes: `.md-spoiler`
(background = foreground colour, text transparent; `.md-spoiler-shown` reverts),
`.md-quote` (display block, left border, padding), `.md-code-block`
(display block, `white-space: pre-wrap`).

## Testing

- Unit: `test/helpers/parseMarkdown.ts` (mocha globs `test/**/*.ts`;
  `test/client/**` is ignored by `.mocharc.yml`). Covers every marker, nesting,
  escapes, unmatched markers, word-boundary `_`, opaque URLs, code suppression,
  multi-line quote/fence, composition with IRC codes, `stripMarkdown`.
- E2E: `@playwright/test` devDependency, `test/e2e/markdown.spec.ts`, script
  `yarn test:e2e`. Skipped unless `SEANCE_E2E_IRC_URL` is set; serves `public/`
  and connects a random `seance-e2e-NNNN` nick to `#ps`, sends marked-up lines,
  asserts the rendered DOM, toggles the setting off and asserts plain text.
  Target: `wss://fractalrealities.afternet.org:9998/`.

## Out of scope

Input helpers (Ctrl+B), persisting spoiler reveal state, headers/lists/tables,
rendering libraries (`markdown-it`, `DOMPurify`).
