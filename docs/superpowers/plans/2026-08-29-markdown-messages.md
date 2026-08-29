# Markdown Messages Implementation Plan

> **2026-08-29:** superseded in part. The layout refactor replaced the names
> this plan documents — there is no exported `tokenize` and no `stripMarkdown`;
> `applyMarkdown` is `parseMarkdown.ts`'s interface and `layout()` decides what
> a message renders as. See `docs/projects/markdown-messages.md` for the shape
> that shipped.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Optionally render Discord-style Markdown in everything `ParsedMessage` displays, controlled by a `markdown` setting that defaults to on.

**Architecture:** A dependency-free tokenizer (`parseMarkdown.ts`) turns the IRC-style fragments produced by `parseStyle` into marker-free fragments carrying extra flags. `parse.ts` applies it after `parseStyle`, suppresses the nick/channel/emoji finders inside code, and wraps runs of nodes sharing a block-ish flag (quote, code block, spoiler, link) in one element each. No HTML strings, no `v-html`, no new runtime dependencies.

**Tech Stack:** TypeScript 5.4, Vue 3 `h()`, mocha 11 + chai 4 (tsx loader), `@playwright/test` (new devDependency, e2e only).

**Spec:** `docs/superpowers/specs/2026-08-29-markdown-messages-design.md`

## Global Constraints

- Tabs for indentation (`.editorconfig`), Prettier 2.5 (`printWidth: 100`, `bracketSpacing: false`, `arrowParens: "always"`, `trailingComma: "es5"`). Run `corepack yarn format:prettier` before every commit; `yarn` is not on PATH, use `corepack yarn <cmd>`.
- ESLint: `curly: all`, `eqeqeq`, `no-console: error`, blank line around blocks, `@typescript-eslint/no-shadow`. `.vue` tag order is template, style, script.
- `client/` must stay browser-only (no Node built-ins). `client/js/helpers/ircmessageparser/parseMarkdown.ts` must import nothing from Vue, the store or the DOM so mocha can load it.
- Mocha only globs `test/**/*.ts` and ignores `test/client/**`; new unit tests go in `test/helpers/`.
- Run one mocha file with: `npx cross-env NODE_ENV=test TS_NODE_PROJECT='./test/tsconfig.json' npx mocha --config=test/.mocharc.yml <file>`
- After any change in `client/`, `corepack yarn build` must succeed.
- Supported syntax and rules are exactly the spec's table: `**`, `*`/`_` (word-boundary `_`), `__`, `~~`, `||`, `` ` ``, ` ``` `, `> ` at line start, `[text](http|https|web+irc url)`, `\` escapes. Nothing else.
- Commit after every task with a conventional-commit style message (`feat:`, `test:`, `docs:`, `chore:`). Git identity is already configured in the repo.

---

### Task 1: The `markdown` setting and its checkbox

**Files:**

- Modify: `client/js/settings.ts:54-59` (add entry next to `motd`)
- Modify: `client/components/Settings/Appearance.vue:3-10` (add checkbox after the MOTD one)

**Interfaces:**

- Produces: `store.state.settings.markdown: boolean` (default `true`), read by Task 4.

- [ ] **Step 1: Add the setting**

In `client/js/settings.ts`, directly after the `links: {default: true},` entry add:

```ts
	markdown: {
		default: true,
	},
```

- [ ] **Step 2: Add the checkbox**

In `client/components/Settings/Appearance.vue`, right after the `</div>` that closes the MOTD label (line 9) insert:

```html
<div>
  <label class="opt">
    <input :checked="store.state.settings.markdown" type="checkbox" name="markdown" />
    Render Markdown formatting (bold, code, spoilers…)
  </label>
</div>
```

The form-level `@change` in `client/components/Windows/Settings.vue` reads `name`/`checked` and dispatches `settings/update`; nothing else is needed.

- [ ] **Step 3: Build and lint**

Run: `corepack yarn build && corepack yarn lint`
Expected: both succeed.

- [ ] **Step 4: Commit**

```bash
git add client/js/settings.ts client/components/Settings/Appearance.vue
git commit -m "feat(settings): add markdown rendering toggle (default on)"
```

---

### Task 2: Tokenizer — emphasis, escapes, opaque URLs

**Files:**

- Modify: `client/js/helpers/ircmessageparser/parseStyle.ts:12-25` (extend `ParsedStyle`)
- Create: `client/js/helpers/ircmessageparser/parseMarkdown.ts`
- Create: `test/helpers/parseMarkdown.ts`

**Interfaces:**

- Produces:

  - `ParsedStyle` gains optional `code?: boolean; codeBlock?: boolean; quote?: boolean; spoiler?: boolean; href?: string`.
  - `export type Range = {start: number; end: number}`
  - `export type MarkdownFlag = "bold" | "italic" | "underline" | "strikethrough" | "monospace" | "code" | "codeBlock" | "quote" | "spoiler"`
  - `export type MarkdownRange = (Range & {flag: MarkdownFlag}) | (Range & {flag: "href"; href: string})`
  - `export type MarkdownTokens = {removals: Range[]; ranges: MarkdownRange[]}`
  - `export function tokenize(text: string, opaque?: Range[]): MarkdownTokens` — `opaque` defaults to `findLinks(text)`; offsets are into `text`. `removals` are marker characters to drop; `ranges` are the styled spans (they may include removed characters, which is harmless).

- [ ] **Step 1: Extend `ParsedStyle`**

In `client/js/helpers/ircmessageparser/parseStyle.ts` replace the type with:

```ts
export type ParsedStyle = {
  bold?: boolean;
  textColor?: string;
  bgColor?: string;
  hexColor?: string;
  hexBgColor?: string;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  monospace?: boolean;
  // Markdown-only flags, set by parseMarkdown.ts
  code?: boolean;
  codeBlock?: boolean;
  quote?: boolean;
  spoiler?: boolean;
  href?: string;
  text: string;
  start: number;
  end: number;
};
```

- [ ] **Step 2: Write the failing tests**

Create `test/helpers/parseMarkdown.ts`:

```ts
import {expect} from "chai";
import {tokenize} from "../../client/js/helpers/ircmessageparser/parseMarkdown";

describe("parseMarkdown tokenize — emphasis", () => {
  it("returns nothing for plain text", () => {
    expect(tokenize("hello world")).to.deep.equal({removals: [], ranges: []});
  });

  it("parses **bold**", () => {
    expect(tokenize("a **b** c")).to.deep.equal({
      removals: [
        {start: 2, end: 4},
        {start: 5, end: 7},
      ],
      ranges: [{start: 4, end: 5, flag: "bold"}],
    });
  });

  it("parses *italic* and _italic_", () => {
    expect(tokenize("*a*").ranges).to.deep.equal([{start: 1, end: 2, flag: "italic"}]);
    expect(tokenize("_a_").ranges).to.deep.equal([{start: 1, end: 2, flag: "italic"}]);
  });

  it("parses __underline__, ~~strike~~ and ||spoiler||", () => {
    expect(tokenize("__a__").ranges).to.deep.equal([{start: 2, end: 3, flag: "underline"}]);
    expect(tokenize("~~a~~").ranges).to.deep.equal([{start: 2, end: 3, flag: "strikethrough"}]);
    expect(tokenize("||a||").ranges).to.deep.equal([{start: 2, end: 3, flag: "spoiler"}]);
  });

  it("nests ***bold italic***", () => {
    const {ranges, removals} = tokenize("***a***");
    expect(ranges).to.have.deep.members([
      {start: 3, end: 4, flag: "italic"},
      {start: 2, end: 5, flag: "bold"},
    ]);
    expect(removals).to.have.deep.members([
      {start: 0, end: 2},
      {start: 2, end: 3},
      {start: 4, end: 5},
      {start: 5, end: 7},
    ]);
  });

  it("nests **bold *and italic* text**", () => {
    const {ranges} = tokenize("**bold *and italic* text**");
    expect(ranges).to.have.deep.members([
      {start: 8, end: 18, flag: "italic"},
      {start: 2, end: 24, flag: "bold"},
    ]);
  });

  it("leaves unmatched and malformed markers literal", () => {
    expect(tokenize("**a")).to.deep.equal({removals: [], ranges: []});
    expect(tokenize("a**")).to.deep.equal({removals: [], ranges: []});
    expect(tokenize("** a **")).to.deep.equal({removals: [], ranges: []});
    expect(tokenize("~a~")).to.deep.equal({removals: [], ranges: []});
    expect(tokenize("|a|")).to.deep.equal({removals: [], ranges: []});
    expect(tokenize("2 * 3 * 4")).to.deep.equal({removals: [], ranges: []});
  });

  it("does not italicise underscores inside words", () => {
    expect(tokenize("snake_case_name")).to.deep.equal({removals: [], ranges: []});
    expect(tokenize("foo__bar__baz")).to.deep.equal({removals: [], ranges: []});
  });

  it("does italicise asterisks inside words", () => {
    expect(tokenize("un*believ*able").ranges).to.deep.equal([{start: 3, end: 9, flag: "italic"}]);
  });

  it("honours backslash escapes", () => {
    expect(tokenize("\\*not italic\\*")).to.deep.equal({
      removals: [
        {start: 0, end: 1},
        {start: 12, end: 13},
      ],
      ranges: [],
    });
    expect(tokenize("\\\\")).to.deep.equal({removals: [{start: 0, end: 1}], ranges: []});
    expect(tokenize("a\\b")).to.deep.equal({removals: [], ranges: []});
  });

  it("treats URLs as opaque", () => {
    expect(tokenize("see https://example.com/a_b_c_d ok")).to.deep.equal({
      removals: [],
      ranges: [],
    });
    expect(tokenize("**https://example.com/x**").ranges).to.deep.equal([
      {start: 2, end: 23, flag: "bold"},
    ]);
  });

  it("accepts explicit opaque ranges", () => {
    expect(tokenize("*a* *b*", [{start: 0, end: 3}]).ranges).to.deep.equal([
      {start: 5, end: 6, flag: "italic"},
    ]);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx cross-env NODE_ENV=test TS_NODE_PROJECT='./test/tsconfig.json' npx mocha --config=test/.mocharc.yml test/helpers/parseMarkdown.ts`
Expected: fails to load — `Cannot find module '.../parseMarkdown'`.

- [ ] **Step 4: Implement the tokenizer**

Create `client/js/helpers/ircmessageparser/parseMarkdown.ts`:

```ts
import {findLinks} from "../../../../shared/linkify";

export type Range = {start: number; end: number};

export type MarkdownFlag =
  | "bold"
  | "italic"
  | "underline"
  | "strikethrough"
  | "monospace"
  | "code"
  | "codeBlock"
  | "quote"
  | "spoiler";

export type MarkdownRange = (Range & {flag: MarkdownFlag}) | (Range & {flag: "href"; href: string});

export type MarkdownTokens = {
  // Marker characters to drop from the text
  removals: Range[];
  // Styled spans; may cover removed characters, which is harmless
  ranges: MarkdownRange[];
};

// Characters a backslash can escape
const MARKER_CHARS = "*_~|`>[]()\\";

type EmphasisToken = {len: number; flag: MarkdownFlag};

// Emphasis delimiters, longest token first
const EMPHASIS: Record<string, EmphasisToken[]> = {
  "*": [
    {len: 2, flag: "bold"},
    {len: 1, flag: "italic"},
  ],
  _: [
    {len: 2, flag: "underline"},
    {len: 1, flag: "italic"},
  ],
  "~": [{len: 2, flag: "strikethrough"}],
  "|": [{len: 2, flag: "spoiler"}],
};

type OpenDelimiter = {char: string; len: number; flag: MarkdownFlag; pos: number};

const isWordChar = (c: string | undefined) => c !== undefined && /[\p{L}\p{N}_]/u.test(c);
const isSpace = (c: string | undefined) => c === undefined || /\s/.test(c);

// Scans `text` for Discord-style Markdown. Offsets in the result are into
// `text`. Ranges listed in `opaque` (URLs by default) are never interpreted.
export function tokenize(text: string, opaque: Range[] = findLinks(text)): MarkdownTokens {
  const removals: Range[] = [];
  const ranges: MarkdownRange[] = [];
  const skips: Range[] = opaque.map((r) => ({start: r.start, end: r.end}));
  const stack: OpenDelimiter[] = [];
  let i = 0;

  while (i < text.length) {
    const skip = skips.find((r) => r.start <= i && i < r.end);

    if (skip) {
      i = skip.end;
      continue;
    }

    const c = text[i];

    if (c === "\\" && MARKER_CHARS.includes(text[i + 1] ?? "")) {
      removals.push({start: i, end: i + 1});
      i += 2;
      continue;
    }

    if (c in EMPHASIS) {
      i = emphasis(text, i, stack, removals, ranges);
      continue;
    }

    i += 1;
  }

  return {removals, ranges};
}

// Handles a run of identical emphasis characters starting at `i`; returns the
// index after the run.
function emphasis(
  text: string,
  i: number,
  stack: OpenDelimiter[],
  removals: Range[],
  ranges: MarkdownRange[]
): number {
  const c = text[i];
  let n = 1;

  while (text[i + n] === c) {
    n += 1;
  }

  const prev = text[i - 1];
  const next = text[i + n];
  let canOpen = !isSpace(next);
  let canClose = !isSpace(prev);

  if (c === "_") {
    canOpen = canOpen && !isWordChar(prev);
    canClose = canClose && !isWordChar(next);
  }

  let pos = i;
  let remaining = n;

  if (canClose) {
    while (remaining > 0) {
      const idx = findLastIndex(stack, (o) => o.char === c && o.len <= remaining);

      if (idx === -1) {
        break;
      }

      const open = stack[idx];
      // Anything opened after this delimiter stays literal
      stack.length = idx;
      ranges.push({start: open.pos + open.len, end: pos, flag: open.flag});
      removals.push({start: open.pos, end: open.pos + open.len});
      removals.push({start: pos, end: pos + open.len});
      pos += open.len;
      remaining -= open.len;
    }
  }

  if (remaining > 0 && canOpen) {
    for (const token of EMPHASIS[c]) {
      while (remaining >= token.len) {
        stack.push({char: c, len: token.len, flag: token.flag, pos});
        pos += token.len;
        remaining -= token.len;
      }
    }
  }

  return i + n;
}

function findLastIndex<T>(list: T[], pred: (item: T) => boolean): number {
  for (let k = list.length - 1; k >= 0; k--) {
    if (pred(list[k])) {
      return k;
    }
  }

  return -1;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx cross-env NODE_ENV=test TS_NODE_PROJECT='./test/tsconfig.json' npx mocha --config=test/.mocharc.yml test/helpers/parseMarkdown.ts`
Expected: all "emphasis" tests PASS. If the `***a***` removals differ only in order, `have.deep.members` is order-insensitive — check the values.

- [ ] **Step 6: Lint, format, commit**

```bash
corepack yarn format:prettier && corepack yarn lint
git add client/js/helpers/ircmessageparser/parseStyle.ts client/js/helpers/ircmessageparser/parseMarkdown.ts test/helpers/parseMarkdown.ts
git commit -m "feat(markdown): tokenizer for emphasis, escapes and opaque URLs"
```

---

### Task 3: Tokenizer — code spans, code blocks, quotes, links

**Files:**

- Modify: `client/js/helpers/ircmessageparser/parseMarkdown.ts`
- Modify: `test/helpers/parseMarkdown.ts`

**Interfaces:**

- Consumes/produces: the same `tokenize` signature. New behaviour: `` ` ``/` ``` `/`> `/`[text](url)` per the spec.

- [ ] **Step 1: Add failing tests**

Append to `test/helpers/parseMarkdown.ts`:

````ts
describe("parseMarkdown tokenize — code, quotes, links", () => {
  it("parses inline code and suppresses markdown inside it", () => {
    expect(tokenize("`**x**`")).to.deep.equal({
      removals: [
        {start: 0, end: 1},
        {start: 6, end: 7},
      ],
      ranges: [
        {start: 1, end: 6, flag: "monospace"},
        {start: 1, end: 6, flag: "code"},
      ],
    });
  });

  it("leaves empty or unmatched backticks literal", () => {
    expect(tokenize("``")).to.deep.equal({removals: [], ranges: []});
    expect(tokenize("a ` b")).to.deep.equal({removals: [], ranges: []});
  });

  it("parses a single-line code block", () => {
    expect(tokenize("```code```")).to.deep.equal({
      removals: [
        {start: 0, end: 3},
        {start: 7, end: 10},
      ],
      ranges: [
        {start: 3, end: 7, flag: "codeBlock"},
        {start: 3, end: 7, flag: "code"},
      ],
    });
  });

  it("parses a fenced block with a language tag and drops surrounding newlines", () => {
    const text = "before\n```js\nlet x = 1;\n```\nafter";
    expect(tokenize(text)).to.deep.equal({
      removals: [
        {start: 6, end: 13},
        {start: 23, end: 28},
      ],
      ranges: [
        {start: 13, end: 23, flag: "codeBlock"},
        {start: 13, end: 23, flag: "code"},
      ],
    });
  });

  it("leaves an unclosed fence literal", () => {
    expect(tokenize("```nope")).to.deep.equal({removals: [], ranges: []});
  });

  it("parses a quote line", () => {
    expect(tokenize("> hi *there*")).to.deep.equal({
      removals: [
        {start: 0, end: 2},
        {start: 5, end: 6},
        {start: 11, end: 12},
      ],
      ranges: [
        {start: 2, end: 12, flag: "quote"},
        {start: 6, end: 11, flag: "italic"},
      ],
    });
  });

  it("merges consecutive quote lines and drops the newline after the block", () => {
    expect(tokenize("> a\n> b\nc")).to.deep.equal({
      removals: [
        {start: 0, end: 2},
        {start: 4, end: 6},
        {start: 7, end: 8},
      ],
      ranges: [{start: 2, end: 7, flag: "quote"}],
    });
  });

  it("does not treat > mid-line or without a space as a quote", () => {
    expect(tokenize("a > b")).to.deep.equal({removals: [], ranges: []});
    expect(tokenize(">b")).to.deep.equal({removals: [], ranges: []});
  });

  it("parses [text](url) links", () => {
    expect(tokenize("[site](https://example.com/a)")).to.deep.equal({
      removals: [
        {start: 0, end: 1},
        {start: 5, end: 29},
      ],
      ranges: [{start: 1, end: 5, flag: "href", href: "https://example.com/a"}],
    });
    expect(tokenize("[c](web+irc://irc.example.org/#chan)").ranges).to.deep.equal([
      {start: 1, end: 2, flag: "href", href: "web+irc://irc.example.org/#chan"},
    ]);
  });

  it("allows emphasis inside link text", () => {
    expect(tokenize("[**b**](https://e.com)").ranges).to.have.deep.members([
      {start: 1, end: 6, flag: "href", href: "https://e.com"},
      {start: 3, end: 4, flag: "bold"},
    ]);
  });

  it("rejects links with other schemes or malformed syntax", () => {
    expect(tokenize("[x](javascript:alert(1))")).to.deep.equal({removals: [], ranges: []});
    expect(tokenize("[x](ftp://e.com)")).to.deep.equal({removals: [], ranges: []});
    expect(tokenize("[x] (https://e.com)").ranges).to.deep.equal([]);
  });
});
````

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx cross-env NODE_ENV=test TS_NODE_PROJECT='./test/tsconfig.json' npx mocha --config=test/.mocharc.yml test/helpers/parseMarkdown.ts`
Expected: the new describe block fails (deep-equal mismatches).

- [ ] **Step 3: Implement**

In `parseMarkdown.ts`, add these constants after `MARKER_CHARS`:

````ts
const FENCE = "```";
// Optional language tag is only a tag when it ends the fence line
const fenceOpenRx = /^```(?:[\w+-]*\n)?/;
const linkRx = /^\[([^\]\n]+)\]\(((?:https?:\/\/|web\+irc:)[^\s)]+)\)/;
````

Replace the body of the `while` loop in `tokenize` with:

```ts
while (i < text.length) {
  const skip = skips.find((r) => r.start <= i && i < r.end);

  if (skip) {
    i = skip.end;
    continue;
  }

  const c = text[i];

  if (c === "\\" && MARKER_CHARS.includes(text[i + 1] ?? "")) {
    removals.push({start: i, end: i + 1});
    i += 2;
    continue;
  }

  if (text.startsWith(FENCE, i)) {
    const after = codeBlock(text, i, removals, ranges);

    if (after !== -1) {
      i = after;
      continue;
    }

    i += FENCE.length;
    continue;
  }

  if (c === "`") {
    const close = text.indexOf("`", i + 1);

    if (close > i + 1) {
      removals.push({start: i, end: i + 1}, {start: close, end: close + 1});
      ranges.push({start: i + 1, end: close, flag: "monospace"});
      ranges.push({start: i + 1, end: close, flag: "code"});
      i = close + 1;
      continue;
    }

    i += 1;
    continue;
  }

  if (c === ">" && text[i + 1] === " " && (i === 0 || text[i - 1] === "\n")) {
    quote(text, i, removals, ranges);
    i += 2;
    continue;
  }

  if (c === "[") {
    const match = linkRx.exec(text.slice(i));

    if (match) {
      const textStart = i + 1;
      const textEnd = textStart + match[1].length;
      const end = i + match[0].length;
      removals.push({start: i, end: textStart}, {start: textEnd, end});
      ranges.push({start: textStart, end: textEnd, flag: "href", href: match[2]});
      // The link text is scanned normally; the "](url)" tail is not
      skips.push({start: textEnd, end});
      i = textStart;
      continue;
    }

    i += 1;
    continue;
  }

  if (c in EMPHASIS) {
    i = emphasis(text, i, stack, removals, ranges);
    continue;
  }

  i += 1;
}
```

Add the two helpers after `emphasis`:

```ts
// A fenced code block starting at `i`. Returns the index after the block, or
// -1 when the fence is not closed or empty.
function codeBlock(text: string, i: number, removals: Range[], ranges: MarkdownRange[]): number {
  const close = text.indexOf(FENCE, i + FENCE.length);

  if (close === -1) {
    return -1;
  }

  const open = fenceOpenRx.exec(text.slice(i))?.[0].length ?? FENCE.length;
  let contentStart = i + open;
  let contentEnd = close;

  if (text[contentEnd - 1] === "\n" && contentEnd - 1 >= contentStart) {
    contentEnd -= 1;
  }

  if (contentStart > close) {
    // The "language tag" was the whole content
    contentStart = i + FENCE.length;
    contentEnd = close;
  }

  if (contentEnd <= contentStart) {
    return -1;
  }

  // Block-level: swallow the newline before the opening and after the closing fence
  const removeStart = text[i - 1] === "\n" ? i - 1 : i;
  let removeEnd = close + FENCE.length;

  if (text[removeEnd] === "\n") {
    removeEnd += 1;
  }

  removals.push({start: removeStart, end: contentStart}, {start: contentEnd, end: removeEnd});
  ranges.push({start: contentStart, end: contentEnd, flag: "codeBlock"});
  ranges.push({start: contentStart, end: contentEnd, flag: "code"});

  return removeEnd;
}

// A "> " quote line starting at `i`. Consecutive quote lines share one range.
function quote(text: string, i: number, removals: Range[], ranges: MarkdownRange[]) {
  let lineEnd = text.indexOf("\n", i);

  if (lineEnd === -1) {
    lineEnd = text.length;
  }

  removals.push({start: i, end: i + 2});

  const last = ranges[ranges.length - 1];

  if (last && last.flag === "quote" && last.end === i - 1) {
    last.end = lineEnd;
  } else {
    ranges.push({start: i + 2, end: lineEnd, flag: "quote"});
  }

  const nextIsQuote = text.startsWith("> ", lineEnd + 1);

  if (text[lineEnd] === "\n" && !nextIsQuote) {
    removals.push({start: lineEnd, end: lineEnd + 1});
  }
}
```

Note on the quote test expectations: the inner `*there*` removals are pushed while scanning the line after the `> ` removal, and the trailing-newline removal for a quote is pushed when the quote line is opened — so for `"> a\n> b\nc"` the order is `{0,2}`, `{4,6}`, `{7,8}`. If your implementation emits the same set in a different order, change the tests to `have.deep.members` rather than the implementation.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx cross-env NODE_ENV=test TS_NODE_PROJECT='./test/tsconfig.json' npx mocha --config=test/.mocharc.yml test/helpers/parseMarkdown.ts`
Expected: PASS.

- [ ] **Step 5: Lint, format, commit**

```bash
corepack yarn format:prettier && corepack yarn lint
git add client/js/helpers/ircmessageparser/parseMarkdown.ts test/helpers/parseMarkdown.ts
git commit -m "feat(markdown): code spans, fenced blocks, quotes and links"
```

---

### Task 4: `applyMarkdown` and `stripMarkdown`

**Files:**

- Modify: `client/js/helpers/ircmessageparser/parseMarkdown.ts`
- Modify: `test/helpers/parseMarkdown.ts`

**Interfaces:**

- Produces:

  - `export function applyMarkdown(fragments: ParsedStyle[]): ParsedStyle[]` — input is `parseStyle(text)` output; output has marker characters removed, `start`/`end` recomputed contiguously from 0, flags set, adjacent identical fragments merged. Returns the input array untouched when there is no markdown.
  - `export function stripMarkdown(text: string): string` — the text with markers removed.

- [ ] **Step 1: Add failing tests**

Append to `test/helpers/parseMarkdown.ts` (add `applyMarkdown, stripMarkdown` and `import parseStyle from "../../client/js/helpers/ircmessageparser/parseStyle";` to the imports):

````ts
describe("applyMarkdown", () => {
  const frag = (text: string, start: number, extra: Record<string, unknown> = {}) => ({
    bold: false,
    textColor: undefined,
    bgColor: undefined,
    hexColor: undefined,
    hexBgColor: undefined,
    italic: false,
    underline: false,
    strikethrough: false,
    monospace: false,
    text,
    start,
    end: start + text.length,
    ...extra,
  });

  it("returns the same array when there is no markdown", () => {
    const input = parseStyle("plain");
    expect(applyMarkdown(input)).to.equal(input);
  });

  it("removes markers, sets flags and renumbers offsets", () => {
    expect(applyMarkdown(parseStyle("a **b** c"))).to.deep.equal([
      frag("a ", 0),
      frag("b", 2, {bold: true}),
      frag(" c", 3),
    ]);
  });

  it("composes with IRC control codes", () => {
    // \x02 bold + markdown italic
    expect(applyMarkdown(parseStyle("\x02x *y*\x02 z"))).to.deep.equal([
      frag("x ", 0, {bold: true}),
      frag("y", 2, {bold: true, italic: true}),
      frag(" z", 3),
    ]);
  });

  it("splits a styled fragment around a marker", () => {
    // One IRC fragment containing a markdown span in the middle
    expect(applyMarkdown(parseStyle("\x1dab `c` d\x1d"))).to.deep.equal([
      frag("ab ", 0, {italic: true}),
      frag("c", 3, {italic: true, monospace: true, code: true}),
      frag(" d", 4, {italic: true}),
    ]);
  });

  it("carries href, spoiler, quote and codeBlock flags", () => {
    expect(applyMarkdown(parseStyle("[t](https://e.com) ||s||"))).to.deep.equal([
      frag("t", 0, {href: "https://e.com"}),
      frag(" ", 1),
      frag("s", 2, {spoiler: true}),
    ]);
    expect(applyMarkdown(parseStyle("> q\n```c```"))).to.deep.equal([
      frag("q", 0, {quote: true}),
      frag("c", 1, {codeBlock: true, code: true}),
    ]);
  });

  it("merges adjacent fragments that end up identical", () => {
    expect(applyMarkdown(parseStyle("**a****b**"))).to.deep.equal([frag("ab", 0, {bold: true})]);
  });

  it("handles empty input", () => {
    expect(applyMarkdown([])).to.deep.equal([]);
  });
});

describe("stripMarkdown", () => {
  it("removes markers and keeps text", () => {
    expect(stripMarkdown("**a** `b` > c [d](https://e.com)")).to.equal("a b > c d");
    expect(stripMarkdown("> c")).to.equal("c");
    expect(stripMarkdown("plain")).to.equal("plain");
  });
});
````

- [ ] **Step 2: Run the tests to verify they fail**

Run the mocha command from Task 3. Expected: import errors for `applyMarkdown`/`stripMarkdown`.

- [ ] **Step 3: Implement**

Add to `parseMarkdown.ts` (import `type {ParsedStyle} from "./parseStyle"` at the top):

```ts
// Style-affecting keys compared when merging adjacent fragments
const STYLE_KEYS: (keyof ParsedStyle)[] = [
  "bold",
  "textColor",
  "bgColor",
  "hexColor",
  "hexBgColor",
  "italic",
  "underline",
  "strikethrough",
  "monospace",
  "code",
  "codeBlock",
  "quote",
  "spoiler",
  "href",
];

const sameStyle = (a: ParsedStyle, b: ParsedStyle) => STYLE_KEYS.every((key) => a[key] === b[key]);

const covers = (range: Range, start: number, end: number) =>
  range.start <= start && end <= range.end;

// Applies Markdown to the fragments produced by parseStyle: marker characters
// are dropped, flags are set, offsets are renumbered and equal neighbours merged.
export function applyMarkdown(fragments: ParsedStyle[]): ParsedStyle[] {
  if (fragments.length === 0) {
    return fragments;
  }

  const text = fragments.map((f) => f.text).join("");
  const {removals, ranges} = tokenize(text);

  if (removals.length === 0 && ranges.length === 0) {
    return fragments;
  }

  const cuts = new Set<number>([0, text.length]);

  for (const item of [...fragments, ...removals, ...ranges]) {
    cuts.add(item.start);
    cuts.add(item.end);
  }

  const points = [...cuts].sort((a, b) => a - b);
  const result: ParsedStyle[] = [];
  let offset = 0;

  for (let k = 0; k < points.length - 1; k++) {
    const start = points[k];
    const end = points[k + 1];

    if (removals.some((r) => covers(r, start, end))) {
      continue;
    }

    const source = fragments.find((f) => covers(f, start, end));

    if (!source) {
      continue;
    }

    const fragment: ParsedStyle = {
      ...source,
      text: text.slice(start, end),
      start: offset,
      end: offset + (end - start),
    };

    for (const range of ranges) {
      if (!covers(range, start, end)) {
        continue;
      }

      if (range.flag === "href") {
        fragment.href = range.href;
      } else {
        fragment[range.flag] = true;
      }
    }

    offset = fragment.end;
    const last = result[result.length - 1];

    if (last && sameStyle(last, fragment)) {
      last.text += fragment.text;
      last.end = fragment.end;
    } else {
      result.push(fragment);
    }
  }

  return result;
}

// Plain text with the Markdown markers removed (for title attributes etc.)
export function stripMarkdown(text: string): string {
  const {removals} = tokenize(text);

  if (removals.length === 0) {
    return text;
  }

  const sorted = [...removals].sort((a, b) => a.start - b.start);
  let out = "";
  let pos = 0;

  for (const r of sorted) {
    if (r.start > pos) {
      out += text.slice(pos, r.start);
    }

    pos = Math.max(pos, r.end);
  }

  return out + text.slice(pos);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run the mocha command. Expected: PASS. Then run the whole suite: `corepack yarn test:mocha` — expected PASS (the `test/client/**` files are ignored).

- [ ] **Step 5: Lint, format, commit**

```bash
corepack yarn format:prettier && corepack yarn lint
git add client/js/helpers/ircmessageparser/parseMarkdown.ts test/helpers/parseMarkdown.ts
git commit -m "feat(markdown): applyMarkdown fragment stage and stripMarkdown"
```

---

### Task 5: Wire into `parse()`, `ParsedMessage`, the topic title and CSS

**Files:**

- Modify: `client/js/helpers/parse.ts`
- Modify: `client/components/ParsedMessage.vue`
- Modify: `client/components/Chat.vue:161-172`
- Modify: `client/css/style.css` (after `.irc-italic`, ~line 2686)

**Interfaces:**

- Consumes: `applyMarkdown`, `stripMarkdown` (Task 4), `store.state.settings.markdown` (Task 1).
- Produces: `parse(text, message?, network?, options?: {markdown?: boolean})`.

- [ ] **Step 1: Update `parse.ts`**

Add imports:

```ts
import {applyMarkdown} from "./ircmessageparser/parseMarkdown";
import anyIntersection from "./ircmessageparser/anyIntersection";
```

Add the types and helpers before `parse`:

```ts
export type ParseOptions = {
  markdown?: boolean;
};

// Flags that wrap a run of neighbouring nodes in one element, outermost first
const WRAP_KEYS = ["quote", "codeBlock", "spoiler", "href"] as const;
type WrapKey = typeof WRAP_KEYS[number];
type Wrap = Partial<Record<WrapKey, boolean | string>>;
type Rendered = VNode | string | undefined | Rendered[];
type WrappedNode = {node: Rendered; wrap: Wrap};

function wrapOf(fragment: StyledFragment | undefined): Wrap {
  const wrap: Wrap = {};

  if (!fragment) {
    return wrap;
  }

  for (const key of WRAP_KEYS) {
    if (fragment[key]) {
      wrap[key] = fragment[key];
    }
  }

  return wrap;
}

function sameWrap(a: Wrap, b: Wrap) {
  return WRAP_KEYS.every((key) => a[key] === b[key]);
}

function toggleSpoiler(event: Event) {
  (event.currentTarget as HTMLElement).classList.toggle("md-spoiler-shown");
}

function wrapNode(key: WrapKey, value: boolean | string, children: Rendered[]): VNode {
  switch (key) {
    case "quote":
      return createElement("span", {class: ["md-quote"]}, children);
    case "codeBlock":
      return createElement("code", {class: ["md-code-block"]}, children);
    case "spoiler":
      return createElement(
        "span",
        {class: ["md-spoiler"], role: "button", tabindex: 0, onClick: toggleSpoiler},
        children
      );
    case "href":
      return createElement(
        "a",
        {href: value, title: value, target: "_blank", rel: "noopener"},
        children
      );
  }
}

// Groups neighbouring nodes that share a wrap flag under one element, nesting
// quote > codeBlock > spoiler > href.
function groupNodes(nodes: WrappedNode[], level = 0): Rendered[] {
  if (level === WRAP_KEYS.length) {
    return nodes.map((n) => n.node);
  }

  const key = WRAP_KEYS[level];
  const out: Rendered[] = [];
  let i = 0;

  while (i < nodes.length) {
    const value = nodes[i].wrap[key];
    let j = i + 1;

    while (j < nodes.length && nodes[j].wrap[key] === value) {
      j += 1;
    }

    const children = groupNodes(nodes.slice(i, j), level + 1);

    if (value) {
      out.push(wrapNode(key, value, children));
    } else {
      out.push(...children);
    }

    i = j;
  }

  return out;
}
```

Extend `StyledFragment`:

```ts
type StyledFragment = Fragment & {
  textColor?: string;
  bgColor?: string;
  hexColor?: string;
  hexBgColor?: string;

  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  monospace?: boolean;
  strikethrough?: boolean;

  code?: boolean;
  codeBlock?: boolean;
  quote?: boolean;
  spoiler?: boolean;
  href?: string;
};
```

Change the `parse` signature and the top of its body to:

```ts
function parse(
	text: string,
	message?: ClientMessage,
	network?: ClientNetwork,
	options: ParseOptions = {}
) {
	// Extract the styling information and get the plain text version from it
	let styleFragments = parseStyle(text);

	if (options.markdown) {
		styleFragments = applyMarkdown(styleFragments);
	}

	const cleanText = styleFragments.map((fragment) => fragment.text).join("");

	// Nicks, channels and emoji are not looked up inside code
	const codeRanges = styleFragments.filter((fragment) => fragment.code);
	const outsideCode = (part: {start: number; end: number}) =>
		!codeRanges.some((range) => anyIntersection(range, part));
```

Filter the finders (link parts are kept as-is):

```ts
const channelParts = findChannels(cleanText, channelPrefixes, userModes).filter(outsideCode);
const linkParts = findLinks(cleanText);
const emojiParts = findEmoji(cleanText).filter(outsideCode);
const nameParts = findNames(cleanText, message ? message.users || [] : []).filter(outsideCode);
```

Change the final `return merge(...).map((textPart) => { ... })` into a helper that renders one part from a list of fragments, then group. Rename the existing map callback body into `renderPart(textPart, fragments)`; the new tail of `parse` is:

```ts
	const nodes: WrappedNode[] = [];

	for (const textPart of merge(parts, styleFragments, cleanText)) {
		const isPlain = !textPart.link && !textPart.channel && !textPart.emoji && !textPart.nick;

		if (!isPlain || textPart.fragments.length === 0) {
			nodes.push({
				node: renderPart(textPart, textPart.fragments.map(createFragment)),
				wrap: wrapOf(textPart.fragments[0]),
			});
			continue;
		}

		// Plain text may cross a quote/code/spoiler/link boundary: split it there
		let run: StyledFragment[] = [];
		let runWrap = wrapOf(textPart.fragments[0]);

		for (const fragment of textPart.fragments) {
			const wrap = wrapOf(fragment);

			if (!sameWrap(wrap, runWrap) && run.length) {
				nodes.push({node: run.map(createFragment), wrap: runWrap});
				run = [];
			}

			runWrap = wrap;
			run.push(fragment);
		}

		nodes.push({node: run.map(createFragment), wrap: runWrap});
	}

	return options.markdown ? groupNodes(nodes) : nodes.map((n) => n.node);
}

// Wrap potentially styled fragments with links, channel buttons, emoji, nicks
function renderPart(textPart, fragments: Rendered[]): Rendered {
	if (textPart.link) {
		// ... existing link branch unchanged, using `fragments` ...
	} else if (textPart.channel) {
		// ... unchanged ...
	} else if (textPart.emoji) {
		// ... unchanged ...
	} else if (textPart.nick) {
		// ... unchanged ...
	}

	return fragments;
}
```

Copy the four existing branches verbatim into `renderPart`; `message` is needed by the link branch, so give `renderPart` a third parameter `message?: ClientMessage` and pass it through.

- [ ] **Step 2: Update `ParsedMessage.vue`**

```ts
<script lang="ts">
import {defineComponent, PropType} from "vue";
import parse from "../js/helpers/parse";
import {useStore} from "../js/store";
import type {ClientMessage, ClientNetwork} from "../js/types";

export default defineComponent({
	name: "ParsedMessage",
	functional: true,
	props: {
		text: String,
		message: {type: Object as PropType<ClientMessage | string>, required: false},
		network: {type: Object as PropType<ClientNetwork>, required: false},
	},
	setup(props) {
		const store = useStore();

		return () =>
			parse(
				typeof props.text !== "undefined" ? props.text : (props.message as ClientMessage).text,
				props.message as ClientMessage,
				props.network,
				{markdown: store.state.settings.markdown}
			);
	},
});
</script>
```

(Check how other components import the store — `grep -rn "useStore" client/components | head -3` — and match it.)

- [ ] **Step 3: Update `Chat.vue` `plainTopic`**

Import `{stripMarkdown} from "../js/helpers/ircmessageparser/parseMarkdown";` and change the computed to:

```ts
const plainTopic = computed(() => {
  const topic = props.channel.topic;

  if (!topic) {
    return "";
  }

  const plain = parseStyle(topic)
    .map((fragment) => fragment.text)
    .join("");

  return store.state.settings.markdown ? stripMarkdown(plain) : plain;
});
```

- [ ] **Step 4: Add CSS**

In `client/css/style.css` after the `.irc-italic` rule:

```css
.md-quote {
  display: block;
  border-left: 3px solid var(--body-color-muted, #bbb);
  padding-left: 8px;
  margin: 2px 0;
}

.md-code-block {
  display: block;
  white-space: pre-wrap;
  padding: 4px 6px;
  margin: 2px 0;
  overflow-x: auto;
}

.md-spoiler {
  background-color: currentcolor;
  color: transparent;
  border-radius: 3px;
  cursor: pointer;
}

.md-spoiler > * {
  visibility: hidden;
}

.md-spoiler.md-spoiler-shown {
  background-color: rgba(128, 128, 128, 0.2);
  color: inherit;
  cursor: text;
}

.md-spoiler.md-spoiler-shown > * {
  visibility: visible;
}
```

Check `grep -n "body-color-muted\|--body-color" client/css/style.css | head` and use an existing variable name if `--body-color-muted` does not exist.

- [ ] **Step 5: Build, lint, smoke-check**

Run: `corepack yarn format:prettier && corepack yarn lint && corepack yarn build && corepack yarn test:mocha`
Expected: all succeed.

Then, in the scratchpad, verify the rendering with a throwaway Playwright script (Task 6 makes the real test): serve `public/` (`python3 -m http.server -d public 8000 &`), open `http://127.0.0.1:8000/?uri=web+irc://fractalrealities.afternet.org:9998/%23ps`, fill `#connect\:nick` with `seance-e2e-<random>`, submit the `#connect form`, wait for `#input`, type `**bold** and ||spoiler||` + Enter, and confirm `.msg[data-type="message"] .irc-bold` and `.md-spoiler` exist. Fix anything that fails.

- [ ] **Step 6: Commit**

```bash
git add client/js/helpers/parse.ts client/components/ParsedMessage.vue client/components/Chat.vue client/css/style.css
git commit -m "feat(markdown): render markdown in ParsedMessage behind the setting"
```

---

### Task 6: Playwright end-to-end test

**Files:**

- Modify: `package.json` (devDependency `@playwright/test`, script `test:e2e`)
- Create: `playwright.config.ts`
- Create: `test/e2e/markdown.spec.ts`
- Modify: `.eslintrc.cjs` / `tsconfig` only if lint fails on the new files (add `test/e2e/**` to the eslint `ignorePatterns` if it does not type-check against any tsconfig project).

**Interfaces:**

- Consumes: the built `public/` tree and the connect form (`#connect form`, `#connect\:nick`, `#input`), `store.state.settings.markdown` via the Settings window checkbox `input[name="markdown"]`.

- [ ] **Step 1: Install Playwright**

Run: `corepack yarn add -D @playwright/test` then `npx playwright install chromium` (browsers may already be cached under `~/.cache/ms-playwright`).

Add to `package.json` scripts: `"test:e2e": "playwright test"`.

- [ ] **Step 2: Config**

Create `playwright.config.ts`:

```ts
import {defineConfig} from "@playwright/test";

export default defineConfig({
  testDir: "test/e2e",
  timeout: 60_000,
  use: {baseURL: "http://127.0.0.1:8000"},
  webServer: {
    command: "python3 -m http.server -d public 8000",
    url: "http://127.0.0.1:8000/",
    reuseExistingServer: true,
  },
});
```

- [ ] **Step 3: Write the test**

Create `test/e2e/markdown.spec.ts`:

````ts
import {test, expect, Page} from "@playwright/test";

const ircUrl = process.env.SEANCE_E2E_IRC_URL; // e.g. wss://fractalrealities.afternet.org:9998/
const channel = process.env.SEANCE_E2E_CHANNEL ?? "#ps";

test.skip(!ircUrl, "set SEANCE_E2E_IRC_URL to run the live e2e test");

function webIrcUri(url: string) {
  const u = new URL(url);
  return `web+irc://${u.host}/${encodeURIComponent(channel)}`;
}

async function connect(page: Page) {
  const nick = `seance-e2e-${Math.floor(Math.random() * 10000)}`;
  await page.goto(`/?uri=${encodeURIComponent(webIrcUri(ircUrl!))}`);
  await page.fill("#connect\\:nick", nick);
  await page.click("#connect form button[type=submit]");
  await page.waitForSelector("#input", {timeout: 30_000});
  return nick;
}

async function say(page: Page, text: string) {
  await page.fill("#input", text);
  await page.press("#input", "Enter");
}

test("renders markdown in own messages", async ({page}) => {
  const nick = await connect(page);
  const own = `.msg[data-type="message"][data-from="${nick}"]`;

  await say(page, "**bold** *it* __ul__ ~~st~~ `co` ||sp|| [lnk](https://example.com/)");
  const msg = page.locator(own).last();
  await expect(msg.locator(".irc-bold")).toHaveText("bold");
  await expect(msg.locator(".irc-italic")).toHaveText("it");
  await expect(msg.locator(".irc-underline")).toHaveText("ul");
  await expect(msg.locator(".irc-strikethrough")).toHaveText("st");
  await expect(msg.locator(".irc-monospace")).toHaveText("co");
  await expect(msg.locator(".md-spoiler")).toHaveText("sp");
  await expect(msg.locator('a[href="https://example.com/"]')).toHaveText("lnk");
  await expect(msg.locator(".text")).not.toContainText("**");

  await msg.locator(".md-spoiler").click();
  await expect(msg.locator(".md-spoiler")).toHaveClass(/md-spoiler-shown/);

  await say(page, "> quoted ```block```");
  const quoted = page.locator(own).last();
  await expect(quoted.locator(".md-quote")).toContainText("quoted");
  await expect(quoted.locator(".md-code-block")).toHaveText("block");
});

test("leaves text alone when the setting is off", async ({page}) => {
  const nick = await connect(page);
  await page.goto("/settings");
  await page.uncheck('input[name="markdown"]');
  await page.goto(`/`);
  await page.click(`.channel-list-item:has-text("${channel}")`);
  await page.waitForSelector("#input");
  await say(page, "**not bold**");
  const msg = page.locator(`.msg[data-type="message"][data-from="${nick}"]`).last();
  await expect(msg.locator(".text")).toContainText("**not bold**");
  await expect(msg.locator(".irc-bold")).toHaveCount(0);
});
````

Adjust selectors if the DOM differs (check `client/components/Message.vue`, `NetworkForm.vue`, `ChannelWrapper.vue` for the real ones — e.g. the settings route path and the channel list item class).

- [ ] **Step 4: Run it live**

Run: `corepack yarn build && SEANCE_E2E_IRC_URL=wss://fractalrealities.afternet.org:9998/ corepack yarn test:e2e`
Expected: 2 passed. Without the env var: `corepack yarn test:e2e` → 2 skipped.

- [ ] **Step 5: Lint and commit**

Run `corepack yarn format:prettier && corepack yarn lint`. If eslint complains that `test/e2e/*.ts` or `playwright.config.ts` is not in a tsconfig project, add `"test/e2e/**"` and `"playwright.config.ts"` to `ignorePatterns` in `.eslintrc.cjs`. Ensure `test-results/` and `playwright-report/` are in `.gitignore`.

```bash
git add package.json yarn.lock playwright.config.ts test/e2e/markdown.spec.ts .gitignore .eslintrc.cjs
git commit -m "test(e2e): playwright markdown rendering test against a live ircd"
```

---

### Task 7: Documentation

**Files:**

- Create: `docs/projects/markdown-messages.md`
- Modify: `CLAUDE.md` (Architecture → `client/` bullets; Common commands table)
- Modify: `docs/superpowers/specs/2026-08-29-markdown-messages-design.md` only if the implementation deviated.

- [ ] **Step 1: Project note**

Create `docs/projects/markdown-messages.md`:

```markdown
# Markdown messages

Status: implemented on `markdown-messages-development` (2026-08-29).

Discord-style Markdown is rendered in everything `ParsedMessage` shows when
the `markdown` setting (default on, Settings → Appearance → Messages) is set.
Display-only; nothing changes on the wire.

Design: `docs/superpowers/specs/2026-08-29-markdown-messages-design.md`.

## How it works

`parse()` runs `parseStyle` → **`applyMarkdown`** → finders → `merge` →
`createFragment` → **`groupNodes`**. `applyMarkdown`
(`client/js/helpers/ircmessageparser/parseMarkdown.ts`) removes the marker
characters and sets flags on the style fragments; `groupNodes` (`parse.ts`)
wraps runs of nodes sharing a `quote`/`codeBlock`/`spoiler`/`href` flag in one
element. URLs are opaque to the tokenizer, and nick/channel/emoji finders are
suppressed inside code.

## Tests

- `test/helpers/parseMarkdown.ts` — tokenizer and fragment stage (mocha).
- `test/e2e/markdown.spec.ts` — `SEANCE_E2E_IRC_URL=wss://host:port/ yarn test:e2e`
  drives the built client against a live ircd with Playwright.

## Follow-ups

- `test/client/**` is not run by mocha and the webpack test bundle only globs
  `.js`; the component-level `parse` test there is dead. Reviving it would let
  `parse()` be unit-tested.
```

- [ ] **Step 2: CLAUDE.md**

In the `client/` bullets add:

```markdown
- **Markdown** — `parse()` renders Discord-style Markdown when the `markdown` setting is on (default): `client/js/helpers/ircmessageparser/parseMarkdown.ts` (`tokenize`/`applyMarkdown`/`stripMarkdown`, no DOM/store imports, tested by `test/helpers/parseMarkdown.ts`) and `groupNodes` in `parse.ts`. See `docs/projects/markdown-messages.md`.
```

In the commands table add a row: `| Playwright e2e (needs a built public/ and SEANCE_E2E_IRC_URL) | \`yarn test:e2e\` |`. Also add `test/helpers/`and`test/e2e/` to the Conventions bullet that lists test dirs.

- [ ] **Step 3: Commit**

```bash
corepack yarn format:prettier
git add docs/projects/markdown-messages.md CLAUDE.md
git commit -m "docs: markdown messages project note"
```

---

## Self-review

- Spec coverage: syntax table → Tasks 2–3; architecture (`applyMarkdown`, flags, `stripMarkdown`, finder suppression, grouping/wrapping, setting, CSS) → Tasks 1, 4, 5; tests → Tasks 2–4, 6; docs → Task 7. Out-of-scope items untouched.
- Placeholders: none; every code step has content. The "existing branches unchanged" note in Task 5 refers to code already in `parse.ts:122-208` that the implementer moves verbatim.
- Type consistency: `Range`, `MarkdownRange`, `MarkdownTokens`, `tokenize`, `applyMarkdown`, `stripMarkdown`, `ParseOptions`, `WrappedNode`, `groupNodes`, `renderPart` are used with the same names and signatures throughout.
