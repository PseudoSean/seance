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

`parse()` runs `parseStyle` → **`applyMarkdown`** → finders → `merge` →
`createFragment` → **`groupNodes`**. `applyMarkdown`
(`client/js/helpers/ircmessageparser/parseMarkdown.ts`) removes the marker
characters and sets flags on the style fragments; `groupNodes` (`parse.ts`)
wraps runs of nodes sharing a `quote`/`codeBlock`/`spoiler`/`href` flag in one
element. URLs are opaque to the tokenizer — `trimTrailingMarkers` peels
trailing emphasis characters (`**`, etc.) back off an opaque range afterwards,
because linkify-it greedily swallows them into the link — and nick/channel/
emoji finders are suppressed inside code. `stripMarkdown` (same file) removes
the syntax without rendering it; `Chat.vue`'s `plainTopic` uses it for the
window-title `title` attribute. CSS for the wrapped elements (`.md-quote`,
`.md-code-block`, `.md-spoiler`/`.md-spoiler-shown`) lives in
`client/css/style.css`, after `.irc-italic`.

## Tests

- `test/helpers/parseMarkdown.ts` — tokenizer and fragment stage (mocha).
- `test/e2e/markdown.spec.ts` — `SEANCE_E2E_IRC_URL=wss://host:port/ yarn test:e2e`
  drives the built client against a live ircd with Playwright.

## Follow-ups

- `test/client/**` is not run by mocha and the webpack test bundle only globs
  `.js`; the component-level `parse` test there is dead. Reviving it would let
  `parse()` be unit-tested.
