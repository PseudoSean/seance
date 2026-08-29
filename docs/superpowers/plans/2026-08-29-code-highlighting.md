# Code Highlighting and Line Numbers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Syntax-highlight fenced code blocks (tagged, or guessed when untagged and multi-line) and number the lines of multi-line blocks, adding only Prism core to the main bundle.

**Architecture:** The tokenizer keeps the fence's language tag and the layout tree's `codeBlock` wrap carries it. A new Vue-free `highlighter.ts` module owns language normalisation, lazy grammar/detector loading (webpack `import()` chunks) and Prism token → plain node mapping. The Vue adapter (`parse.ts`) renders a code block as rows with a counter gutter and asks the highlighter for tokens; a block re-renders when its grammar arrives.

**Tech Stack:** `prismjs` 1.30 (MIT), `flourite` 1.3 (MIT), webpack dynamic `import()`, Vue 3 `h()`/`ref`, mocha + chai.

**Spec:** `docs/superpowers/specs/2026-08-29-markdown-messages-design.md` § Addendum (2026-08-29).

## Global Constraints

- Everything in `.superpowers/sdd/2026-08-29-markdown-messages/constraints.md` (tabs, `corepack yarn`, browser-only `client/`, mocha globs `test/**/*.ts`, prettier before commit).
- Vocabulary from `CONTEXT.md` (fragment, layout tree, wrap, verbatim span).
- `layout.ts` and `highlighter.ts` must not import Vue, the store or the DOM. `highlighter.ts` may import `prismjs/components/prism-core` (no DOM use when `Prism.manual`/no `document` — verify it loads under mocha; if it touches `document` at import time, guard by loading Prism core lazily too and unit-test only the pure parts).
- No HTML strings; tokens become `LayoutNode`-like plain nodes then VNodes.
- Main bundle growth ≤ ~3 KB gzipped (Prism core only). Verify with `ls -l public/js/bundle*.js` before/after and note the numbers in the report.
- Licensing: `prismjs` and `flourite` are MIT. After `NODE_ENV=production corepack yarn build`, confirm `public/js/bundle.vendor.js.LICENSE.txt` (or the chunk's `.LICENSE.txt`) contains both copyright notices; if terser drops one, add `/*! ... */` preservation via the existing `TerserPlugin` `extractComments` config or list them explicitly in `docs/projects/markdown-messages.md` § Licensing.

---

### Task 1: Keep the language tag

**Files:** `client/js/helpers/ircmessageparser/parseMarkdown.ts` (`codeBlock`, `PieceFlags`, `applyMarkdown`), `parseStyle.ts` (`ParsedStyle`), `layout.ts` (`LayoutNode` codeBlock wrap), `test/helpers/parseMarkdown.ts`, `test/helpers/layout.ts`.

**Interfaces produced:** `PieceFlags.lang?: string` (raw tag, lowercase, trimmed, only when a tag was present); `ParsedStyle.lang?: string`; layout `{kind: "wrap"; wrap: "codeBlock"; lang?: string; children}`; `lang` participates in fragment merging keys.

- [ ] Tests first: ` applyMarkdown(parseStyle("```js\nlet x\n```")) ` → fragment with `codeBlock`, `verbatim`, `lang: "js"`; untagged → no `lang`; tag must match `fenceOpenRx` (`[\w+-]*` then newline) — ` ```c++\ncode``` ` → `lang: "c++"`; single-line ` ```code``` ` → no lang (the "tag was the whole content" branch). Layout: wrap node carries `lang`. `toPlainText` unaffected.
- [ ] Implement: capture the tag in `codeBlock()` (`fenceOpenRx` group), attach it to the `codeBlock` range, thread through `applyMarkdown` and into the wrap in `layout.ts` (`wrapOf`/`sameWrap` compare `lang` too so two adjacent blocks with different tags do not merge).
- [ ] `corepack yarn lint && corepack yarn test:mocha`; commit `feat(markdown): keep the code fence language tag`.

### Task 2: The highlighter module

**Files:** create `client/js/helpers/ircmessageparser/highlighter.ts`, `test/helpers/highlighter.ts`; `package.json` (+`prismjs`, `flourite`, `@types/prismjs`).

**Interfaces produced:**

```ts
export type CodeToken = {text: string; type?: string}; // type = Prism token type, e.g. "keyword"
export type Highlighted = CodeToken[][]; // one array per line
export function normalizeLang(tag: string | undefined): string | undefined; // alias → Prism id, undefined if unknown
export function splitLines(code: string): string[]; // "\n" split, trailing newline dropped
export function highlight(code: string, lang: string | undefined): Highlighted | undefined;
// synchronous: tokens if the grammar is loaded, undefined otherwise
export function ensureLanguage(lang: string): Promise<boolean>; // lazy-loads grammar + deps, memoised
export function guessLanguage(code: string): Promise<string | undefined>; // flourite, lazy, threshold, undefined for <2 lines
export const MIN_GUESS_LINES = 2;
export const GUESS_MIN_CONFIDENCE = 0.5; // tune after trying flourite's `statistics` output
```

- [ ] Install: `corepack yarn add prismjs flourite && corepack yarn add -D @types/prismjs`. Check `node_modules/prismjs/components.json` for the alias table and `require` (dependency) lists — `normalizeLang` and `ensureLanguage` read from it (import the JSON; it is small) rather than hand-maintaining aliases.
- [ ] Lazy loading: `ensureLanguage` does `await import(/* webpackChunkName: "prism-[request]" */ \`prismjs/components/prism-${id}\`)`after loading dependencies listed in`components.json` (`require`/`optional`/`modify`— follow Prism's own loader semantics: load`require`deps first). Memoise promises per id. Unknown ids resolve`false`without importing.`guessLanguage`does`await import(/_ webpackChunkName: "flourite" _/ "flourite")`.
- [ ] Token flattening: `Prism.tokenize(code, Prism.languages[id])` returns strings and `Token`s whose `content` may be nested; flatten to `CodeToken`s (use the outermost meaningful `type`, or the innermost — pick innermost and document), then split into lines by walking tokens and breaking on `\n` inside token text.
- [ ] Tests (mocha, no DOM): `normalizeLang("js") === "javascript"`, `("JS")`, `("sh") === "bash"`, `("nope") === undefined`; `splitLines`; `highlight` with a stub grammar registered directly on `Prism.languages.stub = {kw: /\bfoo\b/}` → `[[{text:"foo",type:"kw"},{text:" bar"}]]`, multi-line splitting with a token spanning a newline; `highlight(code, "notloaded") === undefined`; `guessLanguage("x")` (1 line) → `undefined` without importing flourite (assert via a spy on the loader if practical, else skip). If Prism core cannot load under mocha because it touches `document`, set `globalThis.Prism = {manual: true, disableWorkerMessageHandler: true}` before importing (Prism honours that) — record what was needed.
- [ ] Commit `feat(markdown): highlighter module (Prism, lazy grammars, flourite guess)`.

### Task 3: Render code blocks with highlighting and line numbers

**Files:** `client/js/helpers/parse.ts` (the `codeBlock` case of `wrapNode`), new `client/components/CodeBlock.vue`, `client/css/style.css`, `client/themes/default.css` + `morning.css` (token palette), `test/e2e/markdown.spec.ts`.

- [ ] `CodeBlock.vue` (props: `code: string`, `lang?: string`): `setup` computes `id = normalizeLang(lang)`; a `ref` `tokens = highlight(code, id)`; if `undefined` and `id` known → `ensureLanguage(id).then(ok => ok && (tokens.value = highlight(code, id)))`; if no tag and `splitLines(code).length >= MIN_GUESS_LINES` → `guessLanguage(code).then(g => g && ensureLanguage(g).then(...))`. Render: `<code class="md-code-block" :data-lang="id">` containing one `<span class="md-line">` per line (from `tokens` or, while pending, `splitLines(code)` as plain text), each token as `<span :class="'tok-' + type">` or a bare string. Add class `md-code-block--numbered` when lines ≥ 2. Nothing in the component uses `v-html`.
- [ ] `parse.ts`: the `codeBlock` case creates `CodeBlock` with `code = toPlainText(children)` and `lang = node.lang`. (The children of a code block are always text nodes — finders are suppressed in verbatim spans — so no interactive nodes are lost; assert that with a comment and a layout test if not already covered.)
- [ ] CSS: `.md-code-block--numbered { counter-reset: line; }` `.md-line { display: block; }` `.md-code-block--numbered .md-line::before { counter-increment: line; content: counter(line); display: inline-block; width: 2.5em; margin-right: .75em; text-align: right; opacity: .5; user-select: none; }`. Token palette as CSS variables `--tok-comment`, `--tok-keyword`, `--tok-string`, `--tok-number`, `--tok-function`, `--tok-operator`, `--tok-punctuation`, `--tok-tag`, `--tok-attr` defined in `style.css` `:root` with light values and overridden in `themes/morning.css` (dark); map Prism types: `comment,prolog,doctype,cdata`→comment; `keyword,atrule,important`→keyword; `string,char,attr-value,regex`→string; `number,boolean,constant,symbol`→number; `function,class-name,builtin`→function; `operator,entity,url`→operator; `punctuation`→punctuation; `tag,selector`→tag; `attr-name,property`→attr. Keep the header-topic override consistent (`.header .topic .md-code-block .md-line { display: inline }`).
- [ ] e2e: send ` ```js\nconst x = 1;\nlet y = x;\n``` ` (via Shift+Enter if the input supports newlines — check `ChatInput.vue`; otherwise send a single-line ` ```js const x = 1;``` ` and assert highlighting only) and assert `.md-code-block[data-lang="javascript"] .tok-keyword` has text `const`, and, for the multi-line case, `.md-code-block--numbered .md-line` count 2. Keep the send count low.
- [ ] `corepack yarn lint && corepack yarn test:mocha && NODE_ENV=production corepack yarn build`; record bundle sizes and confirm the LICENSE file has both notices; live e2e once. Commit `feat(markdown): syntax highlighting and line numbers for code blocks`.

### Task 4: Docs

- [ ] `docs/projects/markdown-messages.md`: highlighting section (how tags/guessing/lazy chunks/offline behave), § Licensing listing Prism and flourite (MIT) with links; `CLAUDE.md` Markdown bullet mentions `highlighter.ts` and `CodeBlock.vue`; `CONTEXT.md` adds **Code block** (a verbatim span rendered as lines, optionally highlighted for a language) if not already precise. Commit `docs: code highlighting`.

## Self-review

Spec coverage: language tag → T1; highlighter/lazy/guess/threshold → T2; rendering, gutter, theme, no-HTML → T3; licensing → T3 check + T4; tests → each task; e2e → T3. Names consistent: `normalizeLang`, `highlight`, `ensureLanguage`, `guessLanguage`, `splitLines`, `CodeToken`, `Highlighted`, `CodeBlock.vue`, classes `md-line`, `md-code-block--numbered`, `tok-*`.
