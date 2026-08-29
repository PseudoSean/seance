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

## Tests

- `test/helpers/parseMarkdown.ts` — one `describe` per row of the spec's syntax
  table, asserting the text and flags `applyMarkdown` produces. No offsets: a
  fragment boundary moving is not behaviour.
- `test/helpers/layout.ts` — the tree a message renders as, wraps and parts
  included.
- `test/e2e/markdown.spec.ts` — `SEANCE_E2E_IRC_URL=wss://host:port/ yarn test:e2e`
  drives the built client against a live ircd with Playwright. It covers what
  only a browser can answer: that the elements the tree names really appear,
  and that the spoiler toggles.
