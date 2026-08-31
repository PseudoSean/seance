# Markdown Documents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render Markdown headers (`#`–`######`) so pasted Markdown documents read naturally, and collapse large code blocks to an excerpt with an expand control.

**Architecture:** Headers become a new line-level range in the tokenizer (`parseMarkdown.ts`) and a new `header` wrap (with a level) in the layout tree, rendered as block-level styled spans by the Vue adapter — the same path quotes took. Collapsing is entirely a `CodeBlock.vue` concern: the layout tree is unchanged, the component renders an excerpt plus a toggle, and restores the scroll position around the height change so the timeline doesn't jump.

**Tech Stack:** Existing pipeline only (tokenizer → `layout.ts` tree → `parse.ts` VNodes). No new dependencies.

**Spec:** This plan doubles as the spec; decisions marked **[assumption]** were set by the planner and refined in the grilling session. Baseline design: `docs/archives/2026-08-29-markdown-messages-design.md`.

## Global Constraints

- Tabs; Prettier via `corepack yarn format:prettier` before every commit; `yarn` is not on PATH — use `corepack yarn <cmd>`.
- `layout.ts` / `parseMarkdown.ts` stay free of Vue/store/DOM imports (mocha loads them).
- No HTML strings, no `v-html`; VNodes only.
- Markdown-off behaviour is unchanged: markers stay literal, no collapsing changes… **collapsing applies regardless of the markdown setting? No — [assumption] collapsing is part of code-block rendering, which only exists when markdown is on.**
- Behaviour of everything already shipped is unchanged except where this plan says otherwise.
- Unit tests in `test/helpers/`; mocha: `npx cross-env NODE_ENV=test TS_NODE_PROJECT='./test/tsconfig.json' npx mocha --config=test/.mocharc.yml <file>`; full run `corepack yarn test:mocha`. e2e: `SEANCE_E2E_IRC_URL=wss://fractalrealities.afternet.org:9998/ corepack yarn test:e2e` (multiline now merged, so multi-line cases run ungated — remove the `SEANCE_E2E_MULTILINE` gate where encountered).
- Commit per task, conventional subjects. Never push. Branch: `markdown-documents`.

## Design decisions (grilling agenda)

1. **[assumption] Header syntax:** `#{1..6}` + one space at line start (start of message or after `\n`), exactly like `> ` quotes. `#chan` is safe (no space). No closing hashes, no underline (`===`) syntax, no header IDs/anchors. `\#` escapes. Headers are not recognised inside code, and markers inside headers still work (`# **bold** title`).
2. **[assumption] Header scale:** capped for chat — h1 1.5em/700, h2 1.3em/700, h3 1.15em/600, h4 1em/600, h5 0.95em/600 muted, h6 0.85em/600 muted uppercase; block-level with small margins; inline (plain) in the header-bar topic.
3. **[assumption] Quote/header nesting:** `> # title` renders a header inside a quote; a header line ends at the newline and never swallows following lines.
4. **[assumption] Collapse threshold:** code blocks with **more than 12 lines** collapse to the **first 8** plus a toggle reading `Show all 34 lines` / `Show less`; state is per-component (lost on re-render, like spoilers). Blocks ≤ 12 lines are unchanged. Only code blocks collapse — long plain messages don't (separate feature if wanted).
5. **[assumption] Scroll flow:** on toggle, the component keeps its own top edge stationary: snapshot the scroll container's `scrollTop` and the block's `offsetTop` before, restore the delta after `nextTick`. Container found via `el.closest(".chat")` — verify the actual scroll container class in `MessageList.vue` (`keepScrollPosition` there shows which element scrolls) and use that.
6. **[assumption] Copy copies everything:** the toolbar Copy-code action and text selection of an expanded block are unaffected; a collapsed block's hidden lines are NOT in the DOM (so selection copies what you see; the toolbar action still copies the full code from the layout tree).

---

### Task 1: Tokenizer — header ranges

**Files:** Modify `client/js/helpers/ircmessageparser/parseMarkdown.ts` (scanner + `PieceFlags`/fragment flags), `client/js/helpers/ircmessageparser/parseStyle.ts` (`ParsedStyle.header?: 1|2|3|4|5|6`, merge keys), test `test/helpers/parseMarkdown.ts`.

**Interfaces produced:** `ParsedStyle.header?: HeaderLevel` where `export type HeaderLevel = 1|2|3|4|5|6` (exported from `parseStyle.ts`); `applyMarkdown` fragments carry it; header marker (`#…# ` run) and the line's trailing newline handling mirror `quote()`.

- [ ] **Step 1: failing tests** — in the existing style of the file (assert `applyMarkdown(parseStyle(input)).fragments` by text+flags):

````ts
// "# Title"            → [{text: "Title", header: 1}]
// "### a **b**"        → [{text: "a ", header: 3}, {text: "b", header: 3, bold: true}]
// "###### h"           → header: 6;  "####### h" → literal (7 hashes)
// "#chan"              → literal (no space);  "# " alone → literal (empty)
// "\\# x"              → literal "# x"
// "a # b"              → literal (not line start)
// "line\n## H\nrest"   → three fragments; header only on "H"; newlines around the header line removed like quote's
// "> # q"              → {text: "q", quote: true, header: 1}
// "```\n# not\n```"    → codeBlock fragment, no header
````

- [ ] **Step 2: run, see them fail** (`test/helpers/parseMarkdown.ts`).
- [ ] **Step 3: implement** — a `header(text, i, removals, ranges)` scanner branch modelled on `quote()` at `parseMarkdown.ts:421`: at line start, count 1–6 `#`, require a following space and non-empty rest, push a removal for the marker (and the line-boundary newlines the way `quote()` does), push a `{flag: "header", level}` range to the line end. Thread `header` through the piece flags, `STYLE_KEYS`-equivalent merge comparison, and `applyMarkdown`'s fragment assembly (two fragments with different header levels never merge).
- [ ] **Step 4: run, green; full `corepack yarn test:mocha` once.**
- [ ] **Step 5: commit** `feat(markdown): tokenize #–###### headers`.

### Task 2: Layout — header wrap

**Files:** Modify `client/js/helpers/ircmessageparser/layout.ts` (`LayoutNode`, `WRAP_KEYS`/`wrapOf`/`sameWrap`/`wrapNode`), test `test/helpers/layout.ts`.

**Interfaces produced:** `LayoutNode` gains `| {kind: "wrap"; wrap: "header"; level: HeaderLevel; children: LayoutNode[]}`. Grouping order becomes `quote > header > codeBlock > spoiler > href`. `toPlainText` walks through it unchanged. `codeBlocksOf` unaffected.

- [ ] **Step 1: failing tests** — tree assertions in `test/helpers/layout.ts`'s builder style:

```ts
// layout("# Title", {markdown: true})   → [wrap(header,1,[text("Title")])]
// layout("# a **b**")                   → header wrap containing styled text nodes
// layout("> # q")                       → quote wrap containing header wrap
// layout("# see #chan", {channelPrefixes: ["#"]}) → header wrap containing text + channel part
// layout("x\n# H\ny")                   → [text("x"), wrap(header,…), text("y")] with no stray "\n" nodes
// toPlainText(layout("# Title"))        === "Title"
// markdown off                          → literal "# Title" text node
```

- [ ] **Step 2: red. Step 3: implement** — add `header` to the wrap keys (position per decision 3), carry `level` on the wrap the way `codeBlock` carries `lang` (two adjacent header lines of different levels must not group). **Step 4: green + full suite. Step 5: commit** `feat(markdown): header wraps in the layout tree`.

### Task 3: Vue adapter + CSS

**Files:** Modify `client/js/helpers/parse.ts` (`wrapNode`'s switch gains the `header` case → `createElement("span", {class: ["md-header", "md-h" + level]}, children)`), `client/css/style.css` (block styles + `.header .topic` inline override, next to the `.md-quote` rules), `client/themes/morning.css` only if a colour token is needed (muted uses `--body-color-muted`), e2e `test/e2e/markdown.spec.ts`.

- [ ] **Step 1: CSS per decision 2** — `.md-header {display: block}` sizes/weights/margins per level; `.header .topic .md-header {display: inline; font-size: inherit; margin: 0}`.
- [ ] **Step 2: e2e** — extend the multi-line spec case (the `SEANCE_E2E_MULTILINE` gate is now removable — multiline is merged): send `# Big`, Shift+Enter, `## Small`, Shift+Enter, `body text`; assert one message, `.md-h1` text `Big`, `.md-h2` text `Small`, and the `#` markers absent. Run the live e2e once.
- [ ] **Step 3:** `corepack yarn lint && corepack yarn build && corepack yarn test:mocha`; commit `feat(markdown): render headers`.

### Task 4: Collapsible large code blocks

**Files:** Modify `client/components/CodeBlock.vue`, `client/css/style.css` (`.md-code-toggle`, collapsed block affordance), test `test/helpers/codeLines.ts` (or wherever `splitLines` is tested) for any new pure helper, e2e `test/e2e/markdown.spec.ts`.

**Interfaces produced:** exported constants `COLLAPSE_THRESHOLD = 12`, `COLLAPSE_EXCERPT = 8` from `client/js/helpers/ircmessageparser/codeLines.ts` (pure, testable).

- [ ] **Step 1: pure helper + failing test** — `excerptRange(lineCount: number): number | undefined` in `codeLines.ts`: `undefined` when `lineCount <= COLLAPSE_THRESHOLD`, else `COLLAPSE_EXCERPT`. Tests: 12 → undefined, 13 → 8, 100 → 8.
- [ ] **Step 2: component** — in `CodeBlock.vue`: `expanded = ref(false)`; `visible = computed(() => expanded.value ? lines : lines.slice(0, excerptRange(...)))`; hidden lines are not rendered. Below the rows, when `excerptRange` is defined, a `<button type="button" class="md-code-toggle">` reading `` `Show all ${plain.length} lines` `` / `"Show less"`. Toggle handler keeps the block's top edge stationary: before flipping, `const scroller = el.closest(<scroll container selector from MessageList.vue>); const before = scroller.scrollTop; const top = el.getBoundingClientRect().top;` after `nextTick`, `scroller.scrollTop = before + (el.getBoundingClientRect().top - top)` — sign such that the toggle stays under the pointer; verify against the real container (read `MessageList.vue`'s `keepScrollPosition` for the element and any stick-to-bottom flag that must be preserved). Gutter numbers continue from the full count (line 8 of 34 shows "8"; expansion continues 9…34 — numbering must not restart). Highlighting: tokens are computed for the whole code once; slicing happens on the rendered rows only.
- [ ] **Step 3: CSS** — toggle styled like the spoiler/copy affordances (muted, small, full-width row, `user-select: none`); collapsed block gets a subtle bottom fade or border so the cut is visible.
- [ ] **Step 4: e2e** — send a 16-line ```js block (Shift+Enter loop in the helper); assert `.md-line`count 8, toggle text`Show all 16 lines`; click; count 16 and `Show less`; click again; count 8. Assert the toolbar Copy action still yields all 16 lines from the clipboard.
- [ ] **Step 5:** lint/build/mocha + live e2e once; commit `feat(markdown): collapse large code blocks to an excerpt`.

### Task 5: Docs

- [ ] `docs/projects/markdown-messages.md` → add Headers + collapsing sections (or a new `docs/projects/markdown-documents.md` note superseding this plan file when done — follow the PARA convention: this plan moves to `docs/archives/` at completion). `CONTEXT.md`: **Header** (a line-level wrap giving a line document-heading emphasis, levels 1–6) and **Excerpt** (the visible head of a collapsed code block). `CLAUDE.md` Markdown bullet: mention headers and collapsing. Commit `docs: markdown documents`.

## Self-review

Header syntax/nesting/scale → Tasks 1–3; collapse threshold/flow/copy → Task 4; docs → Task 5. Names used consistently: `HeaderLevel`, `header` flag/wrap + `level`, `.md-header`/`.md-h1..6`, `excerptRange`, `COLLAPSE_THRESHOLD`, `COLLAPSE_EXCERPT`, `.md-code-toggle`. No placeholders; each code step carries its content or an exact model to copy (`quote()`, `codeBlock` lang threading).
