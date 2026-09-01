# Reactions and the emoji picker

A reaction is a `+draft/react` tag carrying **free text** (bus-contract §1.4).
That is the fact the whole UI is built around: `👍` is a reaction, so is
`🎉🎉🎉`, and so is `lol`. Nothing anywhere assumes one emoji, one grapheme or
even one word.

## Where a reaction comes from

| Entry point                                         | Lives in                                 |
| --------------------------------------------------- | ---------------------------------------- |
| The 😀 button on a message's hover toolbar          | `client/components/MessageActions.vue`   |
| The `+` at the end of an existing reaction row      | `client/components/MessageReactions.vue` |
| Clicking a reaction badge (adds or takes yours off) | `MessageReactions.vue`                   |
| `/react <text> [msgid]`, `/unreact …`               | `client/js/irc/commands/react.ts`        |

All of them end at `socket.emit("msg:react", {target, msgid, text, remove})`,
which the IRC layer turns into one TAGMSG. `remove` is decided from
`myReactions(message, nick)` (`client/js/helpers/messageUpdates.ts`): picking
something you already reacted with takes it back off, from the picker as well
as from the badge, so there is one toggle and not two verbs.

`/react` takes everything up to an optional trailing msgid as the reaction, so
`/react so cool` sends "so cool". A last word only counts as a msgid when it
names a message **loaded in this channel** (`Channel.idOf`) — the client knows
which msgids are real here, and no shape heuristic could tell `awesome` from
an opaque id. `:shortcodes:` are expanded on the way out, the same as in the
picker.

## The picker (`ReactionPicker.vue`)

One component, opened from either anchor, `<Teleport>`ed to `<body>` because
the scrollback would otherwise clip it, and positioned from JS against the
button it belongs to: below it, flipped above when there is no room, clamped
into the viewport, re-pinned on scroll and resize, and closed once the message
it belongs to has scrolled away. Under 480px wide it is a sheet along the
bottom edge instead, and the search field does not take focus on a coarse
pointer — the on-screen keyboard would cover what the user came to tap.

Its parts, top to bottom:

- **Search / type field.** Doubles as the free-text entry: whatever is typed is
  offered as a reaction of its own ("React with …"), which is how a word or a
  run of emoji is sent from a desktop with no emoji keyboard. Where that row
  sits decides what Enter does, because the first option is the highlighted
  one: an **exact** alias (`tada`, `:tada:`, `+1`) is somebody naming an emoji,
  so the emoji comes first; anything else (`lol`, `same`, `brb`) is words, so
  the text row comes first and the emoji it happens to prefix — 🍭 lollipop for
  `lol` — is one keypress away. Searching itself is looser than that: `party popper` and `flag de` find what they describe.
- **Group tabs**, the nine Unicode groups plus the recents row, with a scroll
  spy keeping the current one lit.
- **The list**, sections with sticky headings. One delegated click and one
  delegated hover handler for ~1900 options, and `role="listbox"` with
  `aria-activedescendant` on the field, so the field keeps focus and the
  keyboard drives the grid: ↑/↓ move a row (found by geometry — sections wrap
  and a remembered word is wider than an emoji, so there is no column count to
  count), ←/→ move one, but only once the caret has nowhere left to go, and
  Enter sends what is highlighted. Reactions already on the message are ticked.
- **Preview bar**: the highlighted emoji, its `:shortcode:` and its
  description — or "Remove" when it is one of yours.

### Recently used

`client/js/helpers/reactionRecents.ts` keeps the last 36 reactions **sent from
the UI** in `localStorage` under `thelounge.reactions.recent`, newest first,
deduplicated. They are whole reaction strings, words included, and they open
the picker as its first section; before there is any history the section shows
`DEFAULT_REACTIONS` instead. `/react` does not feed the list: it records what
was picked here, not everything that was ever sent.

### The catalog

`client/js/helpers/emoji-catalog.json` is generated from the `gemoji`
devDependency by `tools/generate-emoji-catalog.mjs` — 1870 emoji in nine
groups, each with its primary shortcode, description and keywords, as tuples.
Regenerate it (and re-run prettier over it) only when the dep is bumped; the
generator fails loudly if gemoji grows a category the tab bar has no group for,
or a name `findShortcode` would not recognise.

`emoji.ts` reaches it through `loadEmojiCatalog()`, an `import()` — the data is
its own ~88 kB chunk (`public/js/emoji-catalog.js`) that nobody downloads until
they open the picker. `searchEmoji()` scores every token against the name, then
the description and keywords, and requires all of them to match, so `red heart`
finds ❤️ rather than everything red; ties keep Unicode order.

`normalizeReaction()` is the one gate before sending: shortcodes expanded,
control characters and whitespace runs flattened, trimmed, and cut to
`MAX_REACTION_LENGTH` (64) **code points** — a `slice` would split a surrogate
pair. `IrcClient.sendTagmsg` still refuses anything that will not fit in
`MAX_LINE_BYTES` once escaped, which is the real limit.

### Rendering a word reaction

`isEmojiOnly()` decides how a badge is set: emoji at full size, anything else
as a text pill, ellipsised at 22ch with the full text and the nicks in the
`title`. The picker does the same for remembered reactions and for the
"React with …" row.

## Tests

- `test/helpers/emoji.ts` — catalog shape, search ranking, normalisation.
- `test/helpers/reactionRecents.ts` — the MRU list and its storage.
- `test/tests/messageUpdates.ts` — `applyReaction` and `myReactions`.
- `test/irc/reactions.ts` — the wire side and `/react`'s argument rules.

No test mounts the picker (the suite has no DOM), so the parts only a browser
can show — where the popover lands, the lazily loaded catalog, keyboard
navigation, the round trip through the ircd and the phone-sized sheet — are a
scenario instead:

```sh
corepack yarn build && python3 -m http.server -d public 8000 &
tools/nefarious-dev/run.sh -d
node tools/browser-drive.mjs tools/scenarios/reaction-picker.mjs
```

See `docs/resources/browser-testing.md`. The channel keeps history, so the
scenario marks its own message and works only on that one; and it waits out
the 120 ms entrance animation before measuring anything, or it measures the
animation's rect rather than the layout's.
