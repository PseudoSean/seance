# The `<3` theme

Date: 2026-09-10. Branch `theme-heart` (worktree `.claude/worktrees/theme-heart`). Status: plan 1 (theme, motion, meadow's sky) landed; plans 2–3 (the animals) follow.

Mockups the decisions were made on (private artifacts, viewable only by their author):

- The whole theme in a mock of the app: https://claude.ai/code/artifact/5b2eb3b8-7be8-49ba-a00d-4ae7741c57f4
- The character pipeline (horse, puppy, bunny): https://claude.ai/code/artifact/8f7564e2-c793-4962-9f41-7e00c1e795bc
- Earlier rounds: fonts, parade vs. scene, placements, per-channel scenes, gaits.

## 1. What it is

A seventh theme for Seance, display name `<3`, file `client/themes/heart.css` (a `<` cannot be in a stylesheet URL). Vivid, highly animated, romantic pastels on a blue sky, dark blue text in a charming, highly legible font. Messages fade in, glitter bursts on send, hover and reactions, the chrome rises into place, and behind the chat a meadow lives that belongs to the channel: pale far hills, nearer hills, a ground line, drifting clouds, and silhouette animals that walk, run, play and turn back.

The theme is **one stylesheet plus static assets** (fonts, animated SVG characters). No script ships with the theme. Two small app changes make it possible (§7).

## 2. Decisions already made, in the user's words

| Topic            | Decision                                                                                                                                                                                                                                                                                                                                                                         |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mechanism        | CSS only (no theme script). Mouse-tracking glitter dropped.                                                                                                                                                                                                                                                                                                                      |
| Fonts            | Nunito for text at **weight 600**, Baloo 2 (700) for channel/network names and nicks. Bundled, OFL.                                                                                                                                                                                                                                                                              |
| Message entrance | **Fade in**, 340 ms ease-out (chosen over pop and rise).                                                                                                                                                                                                                                                                                                                         |
| Glitter          | On send, on hovering a message row, on reactions. **Four different bursts**, cycled so consecutive sends differ: sparks, hearts rising, four-point stars twinkling, confetti with stars.                                                                                                                                                                                         |
| Scene            | Not a parade of floating images. A **meadow behind the whole chat**: sky fills the message area, hills and animals at the foot at a fixed scale; **animals are lightened (opaque) under text**; text gets a faint sky halo.                                                                                                                                                      |
| Per channel      | The meadow is **seeded by the lower-cased channel name** (hills, tint, clouds, who visits and when). Same name, same meadow, on any network.                                                                                                                                                                                                                                     |
| Depth            | Pale far hills → a level far plateau → mid hills → near ground; distant visitors smaller and paler, walking on the plateau **behind** the mid hills; the far legs of an animal in a lighter tint of its own colour.                                                                                                                                                              |
| Colour           | **Each animal has its own pastel** (horse rose, puppy apricot, bunny lavender, deer lilac, kitten teal, teddy bear caramel, bird turquoise, dolphin sky, frog mint, ladybug coral); never the ink. **Silhouettes are opaque**: under text they are lightened by mixing the colour about 35 % toward the sky, never made translucent — the hills must not show through an animal. |
| Characters       | Silhouettes with real, non-repetitive behaviour (gallop/prance, bound-skid-sit-look-shake, hop/sit-up/twitch), rounded and smooth, no seams, no pointy detail. Cast: horse, puppy, bunny (done to standard), deer, kitten, teddy bear, bird, dolphin, frog, ladybug (to do).                                                                                                     |
| Idle             | The meadow pauses while the composer has focus. Everything stands down under `prefers-reduced-motion`.                                                                                                                                                                                                                                                                           |

## 3. Visual system

### 3.1 Tokens (`:root` in `heart.css`)

```
--sky        #dbeeff   chat surface, also the meadow's upper sky
--sky-deep   #c6dffa   lower sky
--paper      #f4f9ff   header, composer, menus, code
--ink        #1e3a6e   text            (on --sky ≈ 9:1)
--ink-muted  #536a8e   timestamps, topic, placeholders (on --sky 4.6:1; #5a7399 measured 4.07 and was darkened)
--ink-faint  #8fa3c2   counts, disabled (icons only, ≥ 3:1)
--rule       #c5dcf5   hairlines
--rose       #d9457f   the one accent as a fill: caret, send, badges, focus edge
--rose-text  #b9376b   rose wherever it is text (links, actions, code keywords): 4.6:1 on --sky
--rose-soft  #f08fb4
--blush      #ffd6e6   highlight rows, selection, own reactions
--lilac      #e6d9ff   sidebar top
--peach      #ffe3d1   sidebar bottom
--mint       #1f7354   joins (text, so 4.5:1 on --sky; the lighter #2f8f6b measured 3.4)
--hill-far   #dbeee1  --hill-mid #cbe6d3  --ground #b7dcc2   (base; tinted per channel, §5 —
  in the shipped CSS these three are computed at runtime from the seeded hue on #chat-container,
  hsl(var(--heart-hill-hue) ...); the hexes here are the fallback that applies only outside
  #chat-container, where var(--channel-seed) never resolves)
--horse #d97a9c / far #ecbccb   --puppy #e39a5a / #f1cba6   --bunny #9b82dc / #cbbfee
--deer #b48ad6  --kitten #5aa9b8  --teddy #c98a6a  --bird #52b3b3  --dolphin #6f9fe0  --frog #6fbf8a  --ladybug #e0524f
(each animal's far legs and its distant appearances use the "far" tint: the colour mixed ~55 % toward --sky)
```

`color-scheme: light`. TheLounge's variables (`--body-color`, `--window-bg-color`, `--link-color`, `--highlight-bg-color`, the `--tok-*` code colours, …) are mapped onto these at the end of `:root`, the way `coffee.css` does, so the parts of `style.css` that read variables follow along. The theme then restates the selectors that still carry literal colours (sidebar rows and badges, header icons, input, context menu, message-type icons, mIRC colour table) — the same list `coffee.css` covers.

The **32 nick colours** (`.user.color-1`…`-32`) are generated the way the handoff themes do it: hues swept round the wheel at one oklch lightness, chroma ≈ 0.115, every slot ≥ 4.5:1 on `--sky` and on `--blush`, biased toward the pastel-romantic range (rose, lilac, teal, gold, sky, coral) rather than a uniform sweep. Generated by a small script, checked in as values.

Sidebar: a lilac→peach vertical gradient on `#sidebar` and `body` (so the gutter continues the rail, as `themes.md` describes). Active row: white at 70 %. Unread badge: rose.

### 3.2 Type

- `@font-face` for Nunito (600 regular + italic, 800 for bold) and Baloo 2 (700), woff2 files under `client/themes/heart/` referenced relative to the stylesheet. webpack's `client/themes/*` copy pattern is extended to copy the subdirectory (`client/themes/**/*` → `themes/`), keeping the theme self-contained and offline.
- Body text `font-weight: 600`. Nicks, channel and network names, headings in the settings: Baloo 2 700. Timestamps stay Nunito 600 at the muted tone with `font-variant-numeric: tabular-nums`.
- Sizes are untouched: the theme is colour, type and motion; layout stays `style.css`'s rem system.

## 4. Motion

All motion is CSS animations/transitions on elements the app already renders, keyed to classes it already sets. No script.

| Moment             | Hook                                                                                                              | Motion                                                                                                    |
| ------------------ | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| A message appears  | any `#chat .msg` inserted into the DOM (history loads and channel opens included: everything animates into place) | `fade` 340 ms ease-out, opacity 0 → 1.                                                                    |
| A mention          | `.msg.highlight`                                                                                                  | blush background plus a `glow` (inset rose shadow, 1.8 s, twice) on insertion.                            |
| Own message sent   | `.msg.self.pending` (the pending copy, §bus-contract 1.9)                                                         | two star bursts on `::before`/`::after` (see below), 0.9–1.4 s, once.                                     |
| Hovering a message | `.msg:hover`                                                                                                      | a twinkle by the tools (`::after`), 1 s, once per entry; a smaller spark on `.msg .actions button:hover`. |
| A reaction         | `.reaction-enter-active` (Vue transition group on `.msg-reactions-list`) and `.msg-reaction.self` on toggle       | hearts rising + stars, 1.2 s.                                                                             |
| The chrome on load | `#sidebar .channel-list-item` (staggered by `nth-child`, 45 ms steps), `#chat .header`, `#form`                   | `rise` 450–500 ms: opacity 0 → 1, translateY 8px → 0.                                                     |
| Composer focus     | `#form:focus-within`                                                                                              | rose top edge (the existing focus-ring convention) and rose caret.                                        |

**Glitter bursts** are backgrounds on pseudo-elements: layered `radial-gradient` sparks, `linear-gradient` confetti strips, and data-URI SVG hearts and four-point stars in rose, yellow, sky and lilac. Four bursts (`--burst-1..4`) and four keyframe sets (`sparkle`, `sparkle-rise`, `sparkle-pop`, `sparkle-twinkle`). The send burst is chosen by `.msg.self.pending:nth-child(4n+1)`…`(4n+4)` so consecutive sends differ. Hover and reactions use fixed pairings (stars; hearts + stars).

`@media (prefers-reduced-motion: reduce)`: every animation and transition off, the meadow shows a still (§5.6), bursts do not appear.

## 5. The meadow

### 5.1 Placement and layers

The meadow is painted behind the message list, inside `#chat .chat-content` / `.messages` (whichever is the scroll container's positioned parent), from the header to the composer. Nothing moves in the layout: the theme adds no elements, so the chat keeps its full height and text flows over the sky. Layers, back to front, all CSS on existing elements and their pseudo-elements:

1. Sky: `linear-gradient(--sky → --sky-deep)` on the message area's background.
2. Far hills, a level far plateau (a full-width band with softly rounded corners at 31 % of the strip, in the far green), one or two mid-hill bumps in front of it, and the ground band: background layers positioned at the bottom, sized from a fixed strip height `--strip: 8.75rem` (never from the area's height). Stacking: far hills and plateau, then distant visitors, then mid hills, then ground, then near visitors, so a nearer hill passes in front of a distant animal's feet.
3. Clouds: a pseudo-element with white rounded blobs (`radial-gradient`s) whose `background-position` drifts across the width on a 60–120 s loop.
4. Animals: pseudo-element slots (§5.4), each in its animal's pastel **mixed about 35 % toward the sky** (baked into the SVG's fills: the under-text tint is a colour, never `opacity`, so the hills never show through a silhouette). Distant visitors stand on the plateau (`bottom` about 29.5 % of the strip), at 70 % size and in the far tint (about 55 % toward the sky).
5. The messages themselves, with `text-shadow: 0 0 6px var(--sky), 0 0 2px var(--sky)` on `.msg` so ink stays clean over hills and silhouettes; `.msg.highlight` keeps a blush at 85 % so the mention row still reads as a row.

The chat's `.messages` gets `position: relative` and a stacking context so the pseudo-elements sit behind its children. The user list, search results, and the lobby (`data-type="lobby"`) show no meadow: the sky only, no hills, no animals. Queries (`data-type="query"`) get a meadow like a channel's, seeded by the nick.

### 5.2 The seed

The app publishes two attributes on `#chat-container` next to the existing `data-current-channel`:

- `data-scene="0".."5"`: a bucket of the hash, for selecting discrete variants with attribute selectors.
- `style="--channel-seed: 0.xxx"`: the hash as a unit float, for `calc()`-driven continuous variation (delays, positions, hue).

Both come from `helpers/channelSeed.ts`: FNV-1a over the lower-cased name of the conversation, the channel's name for a channel and the other person's nick for a query (network-independent by the user's choice), pure and unit-tested (`test/helpers/channelSeed.ts`). The lobby gets no scene. ≈ 15 lines in `Chat.vue` and the helper.

### 5.3 What the seed decides (CSS only)

- Hill tint: `filter: hue-rotate(calc((var(--channel-seed) - 0.5) * 60deg))` on the hill layers.
- Hill layout: six layouts keyed by `data-scene` (which hills, their widths and heights).
- Clouds: `animation-delay: calc(var(--channel-seed) * -80s)` and a per-scene count.
- Cast and timing: per `data-scene`, which animal each slot shows and its route's `animation-delay` offset (`calc(var(--channel-seed) * -40s)`), so two channels with the same layout still differ in who is where.
- A rainbow (a pseudo-element arc of the pastel palette that fades in for a minute every few minutes) in two of the six scenes — placed in **plan 2**, with the animal slots: it needs a pseudo-element, which plan 1 does not add.

### 5.4 Animals

Each animal is a **self-animating SVG file** (`client/themes/heart/<animal>.svg`): the near silhouette and the far legs as two paths in the animal's own pastel and its far tint (baked as colours; the SVG is an image; a distant-visitor variant `<animal>-far.svg` carries the far tint on both), animated with SMIL `<animate attributeName="d">` between resampled outlines (§6). The file plays its behaviour sequence on a loop (walk, run, stop, sit, look, turn) and carries its own idle pose.

The theme places animals with pseudo-elements on existing elements (`.messages::before/::after`, `#chat .chat-view::before/::after`, `#chat-container::before/::after`, `#chat::before/::after`): up to eight slots. A slot is `position: absolute; bottom: <ground>; height: calc(var(--strip) * ratio); background: url(heart/horse.svg) no-repeat / contain`, and moves along a **route** — CSS keyframes on `transform` (translateX across the width, `scaleX(-1)` to face the other way) whose timing matches the SVG's own sequence (the generator writes both, §6). A far visitor is smaller, paler (`filter: brightness(1.35) saturate(0.7)`) and higher up. Slots run on 90–140 s loops with long gaps, so at most one or two visitors are on screen and the meadow is often empty, which is what makes an arrival an event.

Direction changes: the route flips `scaleX` while the character is stopped (sitting, looking), never mid-stride.

### 5.5 Idle

`#chat-container:has(#input:focus) .chat` pauses every route (`animation-play-state: paused`) and swaps each slot's image for the animal's still (`<animal>-still.svg`, one frame, generated too) so a paused horse does not gallop in place. Focus leaves, the meadow resumes.

### 5.6 Reduced motion

Under `prefers-reduced-motion: reduce` the meadow shows sky, hills, and two still animals (the still files), nothing moves.

### 5.7 Budget

- Only `transform`, `opacity` and `background-position` animate. No layout, no filters animating.
- Each SVG ≤ 120 KB uncompressed (§6.4), stills ≤ 6 KB; total assets for the theme ≤ 1 MB (fonts ≈ 150 KB, animals ≈ 800 KB, gzip ≈ ¼ of that on the wire).
- Phones keep the meadow, reduced: under `max-width: 600px` the strip height drops to 6.5rem and only two animal slots stay active (the rest are hidden).

## 6. Characters: the pipeline

Everything under `tools/heart/` (Node, ESM), run by hand and checked-in outputs, the way `tools/generate-emoji-catalog.mjs` works.

### 6.1 Rigs

`tools/heart/rigs/<animal>.mjs` exports a rig: parts (paths, circles, ellipses in local coordinates), a tree of pivots (`pivot`, `rot` channel, `ty`/`scale` channels), the layer (`near`/`far`), markers (muzzle tip, toes) for outline anchoring, and gaits/sequences as pose tables and cyclic keys — exactly the data shapes proven in the mockups (`heart-core.js`). The rules that emerged from review are constraints the generator checks:

- every joint cap is larger than the piece it caps (coincident vertices break unions);
- every leg's top extends inside the body at every pose (no piece detaches);
- tail roots, far hips and skull sit inside the body; the neck's base is a chord of a disc buried in the shoulder; the tail hangs from a disc buried in the rump;
- far legs are 5 % shorter, slightly raised, barely set back, never below a near foot;
- folded limbs do not touch the belly or each other (an enclosed pocket changes the outline's topology).

### 6.2 Outlines

Per frame: pose → union of the near parts into one closed path (paper.js in Node via `paper-jsdom`), each far leg into its own; a union that comes back larger than its parts is retried with a nudged pose; the outline is resampled to N points starting at the rig's marker, aligned to the previous frame, and run through the concave-only fillet (rounds ~14, strength 0.5). Audit: max frame-to-frame outline-length change (< 2 % body, < 6 % far legs) and no union failures; the generator refuses to emit a clip that fails.

### 6.3 Output

`client/themes/heart/<animal>.svg`: viewBox, two (or three) `<path>`s, each with `<animate attributeName="d" values="…" keyTimes="…" dur="…" repeatCount="indefinite" calcMode="linear">`. Frames at 15–24 fps for sequences, 30 fps for gaits; coordinates rounded to one decimal. `<animal>-still.svg`: the idle pose. A `routes.css` fragment per animal with the keyframes that match the sequence's stops and turns, included into `heart.css` at build by the generator (the theme stays one file; the fragment is generated text between markers).

### 6.4 Cast and behaviours

| Animal     | Sequence (loop)                                                                               | Notes                                                       |
| ---------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Horse      | gallop across · slow to a prance · prance in place · gallop off; a second clip: prance across | done to standard in the mockup                              |
| Puppy      | bound ×3 · skid · sit, look around, wag (hearts) · shake · stand · bound back the other way   | done                                                        |
| Bunny      | hop ×3 · sit up, nose twitch, ears · hop ×3                                                   | done                                                        |
| Deer       | walk · pause and graze (head down) · look up, ear flick · bound off                           | horse rig with slimmer body, longer neck, short tail        |
| Kitten     | trot · pounce (crouch, wiggle, leap) · sit and wash (paw over ear) · trot on                  | puppy rig with pointed ears, long tail with its own channel |
| Teddy bear | waddle · sit down · wave · stand · waddle                                                     | upright biped, two arms, round ears                         |
| Bird       | flap across the sky · glide · land on the ground line · hop twice · take off                  | flies in the sky band, the only slot with a high route      |
| Dolphin    | leaps in an arc from the far hill's edge (a "pond" is a lighter ellipse in two scenes)        | appears only in scenes with the pond                        |
| Frog       | sit · big hop · sit · tongue flick · hop                                                      | low route, small                                            |
| Ladybug    | walks along the ground line · opens its wings and flies a short arc · lands                   | tiny; wings are two half-ellipses on their own channels     |

Hearts from the puppy are part of its SVG (a small heart path with its own animate on opacity/translate), so no extra element is needed.

## 7. App changes

1. `helpers/channelSeed.ts` + `Chat.vue`: publish `data-scene` and `--channel-seed` (§5.2). Test in `test/helpers/channelSeed.ts`.
2. `configuration.ts`: `{name: "heart", displayName: "<3", themeColor: "#f4f9ff"}`; `test/tests/build.ts`: add `heart` to the list of theme files expected in `public/themes/`, and expect `themes/heart/nunito-600.woff2` and `themes/heart/horse.svg`.
3. `webpack.config.ts`: the themes copy pattern includes subdirectories.
4. `docs/resources/themes.md`: the `heart` row and a section on the meadow and the generator; `CLAUDE.md` gets one paragraph pointing there; `docs/projects/heart-theme.md` carries this spec once the work lands (per the repo's `docs/superpowers/` convention).

Nothing else in the app changes. The theme must degrade gracefully on a deploy that lacks the seed attributes: no `data-scene` means scene 0.

## 8. Verification

- `yarn test`: the build test above; the seed helper's unit tests; generator tests under `test/tools/heart/` (a rig round-trips through union → resample → fillet; the audit rejects a rig with a detached piece; the emitted SVG parses and has equal `values` counts across paths).
- Browser: `tools/scenarios/theme-heart.mjs` on the dev ircd: pick the theme in Appearance, assert the stylesheet link, the seed attributes for a channel, that `.messages` carries the meadow background, that a `.msg` inserted after connect runs the fade (computed animation name), that a pending own message has the burst pseudo-element, contrast of ink/muted/nick-on-blush ≥ 4.5:1 as `themes.mjs` measures, and a screenshot in each of two channels showing different meadows. Also `--mobile`.
- A spike, first in the plan: **SMIL animation inside an SVG used as a CSS background image** in Chromium, Firefox and WebKit. If any engine does not animate background SVGs, the fallback is CSS animations inside the SVG (`<style>` in the file); if that also fails somewhere, that engine gets the stills. The generator can emit either form.

## 9. Out of scope

- The parade of Twemoji images (superseded), mouse-tracking glitter (needs script), sound.
- A dark variant of `<3` (a night meadow) — a natural follow-up, not in this branch.
- Reworking layout, spacing or type sizes; the theme is colour, type and motion only.
- Making the meadow reflect activity (a visitor when someone joins) — would need app hooks beyond the seed; noted as a later idea.

## 10. Questions resolved with the user (2026-09-10)

1. Sidebar gradient: **lilac → peach**, as mocked.
2. Queries: **get a meadow**, seeded by the other person's nick.
3. Phones: **keep a reduced meadow** (6.5rem strip, two visitor slots), never hidden.
