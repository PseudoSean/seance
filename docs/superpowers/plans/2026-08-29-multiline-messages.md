# Multi-line Messages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send and receive IRCv3 `draft/multiline` messages as single multi-line messages, with exact fallback to today's per-line behaviour when the capability is absent.

**Architecture:** A `multiline.ts` module in the IRC layer owns both directions: a `draft/multiline` batch handler that joins buffered lines into one synthetic PRIVMSG/NOTICE (folding into a parent batch when nested), and a `sendMultiline()` used by `IrcClient.sendMessage` that emits `BATCH +ref draft/multiline` with concat chunking and limit splitting. `dispatchInput` stops splitting plain text on newlines when the cap is on.

**Tech Stack:** TypeScript, the existing `CapNegotiator`, batch registry (`handlers/batch.ts`), `splitMessage`/`trailingLine` (`message.ts`, `wire.ts`), mocha + sinon `FakeTransport`, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-29-multiline-messages-design.md`

## Global Constraints

- Tabs; Prettier (`corepack yarn format:prettier` before every commit); `yarn` is not on PATH — `corepack yarn`.
- `client/js/irc/*` stays free of store/DOM imports (mocha loads it). Handlers mutate the client's model and emit through the client only (`CLAUDE.md` § Working in the IRC layer).
- `MAX_LINE_BYTES = 500` is not raised; every line inside a batch obeys it, tags included.
- Never wait for a reply the server already knows (pipelining rule); the batch is sent in one flush.
- New bus behaviour is documented in `docs/resources/bus-contract.md` in the same commit.
- Test files follow the `test/irc/batch.ts` conventions: own `FakeTransport`, guard the root-level `socket.dispatch` spy (`isSinonProxy`) and only `restore()` a spy you own.
- Run one file: `npx cross-env NODE_ENV=test TS_NODE_PROJECT='./test/tsconfig.json' npx mocha --config=test/.mocharc.yml test/irc/multiline.ts`. Full: `corepack yarn test:mocha` (builds first). Live: `SEANCE_IRC_URL=wss://fractalrealities.afternet.org:9998/ …multiline.live.ts` — one live file at a time.
- Commit per task, conventional subjects. Never push.

---

### Task 1: Capability

**Files:** `client/js/irc/caps.ts` (`SEANCE_CAPS.wanted`, doc comment), `client/js/irc/client.ts` (accept hook, a `multilineLimits()` accessor), `client/js/irc/multiline.ts` (new: `parseMultilineValue`), `docs/resources/nefarious2-websocket.md` (table row + stale note), `test/irc/multiline.ts` (new).

**Interfaces produced:**

```ts
// multiline.ts
export const MULTILINE_CAP = "draft/multiline";
export const CONCAT_TAG = "draft/multiline-concat";
export type MultilineLimits = {maxBytes: number; maxLines: number};
export function parseMultilineValue(value: string | undefined): MultilineLimits | undefined; // "max-bytes=16384,max-lines=100" → limits; undefined when either is missing/≤0
// client.ts
multilineLimits(): MultilineLimits | undefined; // undefined unless the cap is enabled with a valid value and `batch` is enabled
```

- [ ] Tests first (`describe("multiline cap")`): `parseMultilineValue("max-bytes=16384,max-lines=100")` → `{16384,100}`; missing/zero/garbage → `undefined`; a connection whose `CAP LS 302` offers the cap with a valid value ends up with `CAP REQ` containing `draft/multiline` and `client.multilineLimits()` set; an invalid value → the cap is not requested (accept hook) and limits are `undefined`. Drive with `FakeTransport` lines the way `test/irc/caps.ts` does.
- [ ] Implement; update the `caps.ts` doc comment (remove the "blocked by 528-byte bug" sentence) and the websocket doc row (`later` → `yes`, note #98 fixed 2026-08-28).
- [ ] Commit `feat(irc): negotiate draft/multiline`.

### Task 2: Receive

**Files:** `client/js/irc/multiline.ts` (`multilineBatch` handler + `joinMultiline`), `client/js/irc/handlers/index.ts` (register), `client/js/irc/handlers/batch.ts` (only if a small hook is needed to fold a handled batch into its parent — prefer walking `batch.parent` from the handler as `persistence.ts` `inBouncerReplay` does), `test/irc/multiline.ts`, `test/irc/batch.ts` + `test/irc/history.ts` (update the two tests that pin the old fold-line-by-line behaviour).

**Interfaces produced:**

```ts
export function joinMultiline(
  lines: IrcMessage[]
): {command: "PRIVMSG" | "NOTICE"; target: string; text: string; source: string} | undefined; // undefined when malformed
export const multilineBatch: BatchHandler;
```

`multilineBatch` builds a synthetic `IrcMessage` (command from the lines, params `[target, text]`, tags = opener's tags minus `batch`, prefix from the first line) and either (a) pushes it into the parent batch's `messages` when `batch.parent` is open, or (b) calls `client.handleMessage(synthetic)` — check how `deliver()` re-feeds lines and use the same entry point so interception is not re-applied.

- [ ] Tests first: join of 3 lines → `"a\nb\nc"`; concat chunk appends without `\n`; opener `msgid`/`time`/`+draft/reply` appear on the dispatched `msg` payload (`msgid`, `time`, `replyTo`); `\x01ACTION x\x01` lines → one `action` message with joined text; NOTICE batch → `notice`; mixed targets → lines delivered individually; empty batch → nothing; batch nested in a `chathistory` batch → one joined message inside the `more` payload in the right position; `echo-message` own batch → `self: true`.
- [ ] Update `test/irc/batch.ts` "folds a nested unhandled batch into its parent" (use a different unknown type, e.g. `example.org/foo`, so it still tests the fold) and `test/irc/history.ts:705-728` (expect one joined message).
- [ ] Commit `feat(irc): receive draft/multiline batches as one message`.

### Task 3: Send

**Files:** `client/js/irc/multiline.ts` (`planMultiline`, `sendMultiline`), `client/js/irc/client.ts` (`sendMessage`, `editMessage`, batch ref allocator `nextBatchRef()`), `client/js/irc/commands/index.ts` (`dispatchInput`), `client/js/irc/commands/{me,notice,msg}.ts` (pass multi-line rest through), `docs/resources/bus-contract.md` (§ input), `test/irc/multiline.ts`, `test/irc/commands.ts` (if any existing test asserts the per-line split for plain text, adjust to "when multiline is off").

**Interfaces produced:**

```ts
export type MultilineLine = {text: string; concat: boolean};
export type MultilinePlan = MultilineLine[][]; // one inner array per batch
export function planMultiline(
  text: string,
  prefixBytes: number,
  limits: MultilineLimits
): MultilinePlan; // splits >budget lines into concat chunks, then packs lines into batches under maxLines/maxBytes
export function sendMultiline(
  client: IrcClient,
  target: string,
  command: "PRIVMSG" | "NOTICE",
  plan: MultilinePlan,
  openerTags: Record<string, string>,
  action: boolean
): void;
```

`sendMessage`: if `text.includes("\n") && client.multilineLimits()` → plan + send, and synthesise locally when `echo-message` is off (joined text, one message per batch); else today's path (which still replaces `\n` with a space — keep that fallback exactly). `dispatchInput`: when `client.multilineLimits()` and `text.includes("\n")`: first line not a command → `inputLine(client, chan, text, opts)` once; first line `/me|/notice|/msg|/query` → the command gets `rest` with the newlines intact; otherwise per-line loop. Edits: `opts.edit` path uses the multiline path too when available.

- [ ] Tests first: sending `"a\nb"` produces exactly `BATCH +m1 draft/multiline #seance`, `@batch=m1 PRIVMSG #seance :a`, `@batch=m1 PRIVMSG #seance :b`, `BATCH -m1` (assert on `transport.sent`); reply tag on the opener only; a 1200-byte line → chunks with `draft/multiline-concat` on chunks 2+; 101 lines with `maxLines=100` → two batches `m1`,`m2`; `maxBytes` packing; `/me a\nb` → ACTION-wrapped lines; `/notice #c a\nb` → NOTICE batch; `/join #x\n/part` → per-line as today; no cap → two separate PRIVMSGs (today); no `echo-message` → one local `msg` with `"a\nb"`; edit with newline → opener carries `+seance/edit`.
- [ ] Implement; amend the bus contract's `input` row.
- [ ] Commit `feat(irc): send multi-line input as draft/multiline batches`.

### Task 4: Errors, live test, e2e, docs

**Files:** `client/js/irc/handlers/standard-replies.ts`, `test/irc/multiline.ts` (FAIL cases), `test/irc/multiline.live.ts` (new, `describe.skip` unless `SEANCE_IRC_URL`), `test/e2e/multiline.spec.ts` (new), `docs/projects/multiline-messages.md` (new), `CLAUDE.md` (IRC layer bullet: `multiline.ts`; live-test list), `CONTEXT.md` (**Multi-line message** term).

- [ ] Tests first for `FAIL BATCH MULTILINE_MAX_LINES …` → `error` message in the target; implement.
- [ ] Live test: connect to the dev ircd, join `#seance`, send `"one\ntwo\nthree"`, assert a single `msg` dispatch with the joined text and a msgid; note any deviation from the draft in `docs/resources/nefarious2-websocket.md` (e.g. how the server echoes ACTION lines, whether it re-tags concat).
- [ ] e2e (`SEANCE_E2E_IRC_URL`): type `line one`, `Shift+Enter`, `line two`, `Shift+Enter`, `line three`, `Enter`; assert one `.msg[data-from=<nick>]` whose `.content` text contains all three and that no second message with the token exists. Reuse `connect()`/token helpers from `test/e2e/markdown.spec.ts` (extract to `test/e2e/helpers.ts` if needed).
- [ ] Docs + `CONTEXT.md` entry; commit `feat(irc): multiline FAIL replies, live and e2e tests, docs`.

## Self-review

Spec coverage: cap → T1; receive incl. nesting/malformed → T2; send incl. concat, limits, commands, no-cap/no-echo, edits → T3; errors/tests/docs → T4. Interface names consistent across tasks: `MULTILINE_CAP`, `CONCAT_TAG`, `MultilineLimits`, `parseMultilineValue`, `multilineLimits()`, `joinMultiline`, `multilineBatch`, `planMultiline`, `sendMultiline`, `nextBatchRef()`.
