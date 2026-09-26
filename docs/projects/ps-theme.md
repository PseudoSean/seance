# The `ps` theme: peace on the plains

Date: 2026-09-24. Branch `ps-theme` (worktree `.claude/worktrees/theme-ps`), the theme's work rebased onto `develop`; it began on the branch `theme-ps`, forked from `theme-heart` at `a64a16cb`.

Status: **plan 2 (the chrome) landed, 2026-09-25** (branch `ps-theme`, the commits from "ps: Mulish and Fraunces, as the mockup loaded them" through "ps: the browser check's canvas proof points at the latin-ext trap"), after **plan 1 (the seam), 2026-09-24** (the commits from "ps: the engine — local clock to sun, moon, season and weather" through "browser-drive: say what a failed load looks like in page.logEntries"). Commits are named by subject, not hash, because a hash does not survive a rebase. The groundwork (§14) and plans 1 and 2 (§13) are built: the engine, the palette, the hook, a minimal scene on the real clock, the daylight fallback, the message column's own palette and its two text treatments, the glass chrome with its day and night palettes, Mulish and Fraunces, and the treatments' strength measured from rendered pixels. This document is still the spec for what plans 3 and 4 (the plains, the rest) have yet to build.

The design was drawn and decided with the user over nine rounds of a live mockup. Its approved state is kept in the repository at `docs/resources/themes/ps-plains/mockup.html` (the README beside it explains how to drive it), and was published as https://claude.ai/artifact/4n67vQ1gJtPyuHwf22HrGQ. **The mockup's window is the reference drawing for everything visual here.** Where this document and the mockup disagree, this document wins: it records decisions made after drawing, and it converts the mockup's px and page script into the repo's conventions.

## 0. For review: decisions the mockup did not show you

The mockup settled how the theme looks and behaves. Building it into the app needs these engineering calls too. None of them changes what you see, but each one is a real choice, so they are listed first.

1. **The scene is real page elements, loaded only for `ps`.** Every other theme is one CSS file, and so was the `<3` meadow: background images painted on the chat pane. The plains cannot be built that way. A background image cannot be recoloured by the hour, cannot carry its own filter (the fiery sun, the heat haze over the land and yurt together) and cannot host the birds' wingbeats. So the scene is SVG and HTML, as in the mockup, in its own script chunk that only `ps` loads. Other themes download nothing new.
2. **The app gains one small, theme-neutral hook** so a theme can bring a scene. The hook keeps a table of the themes that have one; when such a theme is applied, the app mounts its scene behind everything, and when the theme changes the scene is removed. Only `ps` has one.
3. **The colours of the day are computed in a TypeScript module, not in the stylesheet.** The `<3` plan kept every colour in CSS. Here that would mean 13 times of day × 4 seasons × 6 weathers of CSS rules. More importantly, a module lets the test suite check text contrast at every minute of every season, and the suite has no browser. The chrome's two palettes (day glass and night glass) stay in `ps.css`, where a person retinting the theme would look; the colours that must hold a floor over the sky (the glass's opacity, its soft ink, the badge, the text accent, every nick colour and every colour the message column reads) are generated into it by `tools/ps/palette-blocks.ts`, so those are retinted in the generator (§11).
4. **The animals stay off, and stay removable-to-restore.** The old meadow is replaced, and with it the layers the "animals off" switch lived in. The new scene keeps one animal layer on the ground with a fixed cast (horse, bunny, a deer far off) and the same off switch: one block empties it, and deleting that block brings them back. The files, rigs and generator are untouched, and the tests still prove no animal file is downloaded.
5. **Every channel shows the same place.** The per-channel seed (`channelSeed.ts`, `data-scene`) is shared code the `<3` theme uses, so it stays in the app; `ps` just stops reading it.
6. **Performance has rules and a measured budget** (§10). Only the weather that is happening is built, the scene stops completely when the page is hidden, and there is a pre-decided fallback for phones if glass over a moving scene measures too slow.

Three **assumptions** were never confirmed and need your eye:

- The sun keeps **real hours for a latitude of 45° north**, and the seasons are the **northern hemisphere's**. The theme does not know where you are.
- In **right-to-left** languages the **whole scene is mirrored**, so the yurt stays in the far third of the reading direction and the sunset still falls behind it.
- The **weather is chosen per calendar day** from the season's odds, the same for everyone on that date.

## 1. What it is

A theme whose whole window is open steppe that keeps the viewer's own clock and calendar: vivid plains with a river, a detailed, welcoming yurt in the far third of the view, a sun that burns like a brilliant fire and crosses the sky with the clock, beautiful sunrises and sunsets, the moon in its true phase at night, and the seasons turning the grass, bringing weather and sending flocks over. Nobody is obviously home in the yurt, but at night smoke rises from its crown and warm light leaks out of it. The interface floats over this as tinted glass.

The essence, in the user's words: **"peace on the plains"**. Everything that moves does so slowly. Nothing sparkles.

## 2. Decisions, in the user's words

Decided against the mockup, 2026-09-24:

| Topic            | Decision                                                                 | The user's words                                                                                                                                          |
| ---------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Name             | `ps`; no "ps <3" anywhere                                                | "call the theme ps … there is no longer a ps <3"                                                                                                          |
| Animals          | disabled, not removed                                                    | "disable but don't remove the animals walking across"                                                                                                     |
| Scene            | vivid, detailed meadow on the plains with a detailed, welcoming yurt     | "a more vivid and detailed meadow in the plains, where there is a detailed welcoming yurt"                                                                |
| Sun              | follows the clock; animated like a brilliant fire; sunrise and sunset    | "the sun moving with the clock … a more vivid and detailed sun (animated like a brilliant fire), with beautiful sunsets and sunrise"                      |
| Moon             | true phases, more vivid                                                  | "at night the moon phases are present … but a more vivid moon picture"                                                                                    |
| Yurt at night    | smoke from the centre, warm glow leaking out, nobody visibly home        | "it's not obvious anyone is home … at night smoke eminates from the center … a warm glow leaks out"                                                       |
| Glitter          | removed; replaced by **embers**                                          | "I like embers best as the effect"                                                                                                                        |
| One place        | every channel the same                                                   | "instead of seeded channels, all channels will appear the same"                                                                                           |
| Whole window     | the scene is the whole page; panels coloured to match                    | "the entire page should have this meadow scene … make appropriate colors in the areas where the text input box would go or where user lists might appear" |
| Text             | clear by day and night; white with a drop shadow while the light changes | "it's only difficult to read at dusk and dawn, day and night are very clear"                                                                              |
| Fireflies        | in the far fields at the right time                                      | "Add some fireflies at the appropriate time of day in the far fields"                                                                                     |
| Seasons          | tracked: birds migrating, rain, wind, summer heat                        | "use season tracking, which might have rainstorms, or wind, or radiating summer heat, spring with birds migrating across (maybe also in winter)"          |
| River            | dry in summer, running otherwise                                         | "the river drives up in summer and runs in the other seasons"                                                                                             |
| Yurt placement   | the far third of the reading direction                                   | "the yurt should be in the far third"                                                                                                                     |
| Heat shimmer     | gentle, and it bends the yurt too                                        | "a little too intense … it doesn't apply to the yurt like I would expect"                                                                                 |
| Birds            | realistic                                                                | "make them a little more bird realistic"                                                                                                                  |
| Migration        | flocks at night and around sunset; other birds by day                    | "birds migrate at night (like geese) and maybe sunset time … If you have other birds, they can be out in the day"                                         |
| Yurt motion      | never slides; fading is allowed                                          | "don't slide animate the yurt in and out - you can use fade, but not movement on it"                                                                      |
| Name shadows     | never clipped                                                            | "the drop shadows appear slightly cut off on the names in channel"                                                                                        |
| Type             | **Mulish** for the words, **Fraunces** for names and titles              | "use fraunces for the names", "change the message text to mulish"                                                                                         |
| Private messages | the plains behind **frosted glass**, **still**                           | "I love the frosted glass look", "it can stay still, it doesn't need to move"                                                                             |

Carried from the `<3` design (`docs/projects/heart-theme.md` §11–§13) and still binding: the scene follows the viewer's **local clock** through a small script hook; the **moon's phase is the true one**, and a **new moon is no moon**; at night **the whole interface goes dark**; private messages get a **plainer, still** background.

Decided while plan 2 was built, each after measured crops of the candidates (§6, §7):

| Date       | Topic                           | Decision                                                                                                                                                                                                              | The user's words                              |
| ---------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| 2026-09-24 | White words over bright grounds | the subtitle outline, **"B"**: eight 1 px offsets (0.0625rem, blurred 0.0625rem) at 78 % black, under the approved soft shadow                                                                                        | "go with B"                                   |
| 2026-09-24 | Nick colours after dusk         | **names-large**: held at 3 : 1 as WCAG large text over the sky and the moon's and sun's discs; below the default font-size step, where they are not large text, the **sky** set, 4.5 : 1 over the sky                 | "names-large is easiest to read"              |
| 2026-09-25 | The accent as chrome text       | **1A**: a text accent in the accent's own hue for the chrome's links, button labels and the marks that must read; the spec's accent stays for the open row's marker, the caret, the focus glow and the accent's tints | "i will accept your recommendations on these" |
| 2026-09-25 | A parted row at night           | **2A**: `#feaf98`; coffee's `#e08a72` reads 3.15 : 1 on the night glass                                                                                                                                               | "i will accept your recommendations on these" |
| 2026-09-25 | Washes on the glass             | every wash moves away from its text: lighter toward the paper by day, deeper toward **black** at night; navy was shown too, and vanishes over a dark sky                                                              | "I'll take your recommendation"               |
| 2026-09-25 | The reaction row's "+"          | **full strength**: the "+" at opacity 1 on its own grey chip; three-quarters and `style.css`'s 55 % were shown too                                                                                                    | "full, I'll take your recommendation"         |

## 3. Architecture

```
client/js/themeScene.ts        theme-neutral hook: mount/unmount a theme's scene, tell it what is open
client/js/scenes/ps/engine.ts  Vue-free, DOM-free: date → everything the scene and the chrome need
client/js/scenes/ps/palette.ts Vue-free, DOM-free: the colour tables and their interpolation
client/js/scenes/ps/scene.ts   builds and updates the scene's elements (DOM, no Vue); its own chunk
client/themes/ps.css           the chrome, the type, the fallback daylight, the scene's static styling
tools/ps/legibility.ts         the legibility model: the checked grounds, the surfaces, the measured strengths
tools/ps/palette-blocks.ts     the generator of ps.css's two colour blocks (§7, §11)
tools/ps/calibrate.mjs         measures the text treatments' strength from rendered pixels (§11)
tools/ps/fetch-fonts.mjs       fetches Mulish and Fraunces and writes their @font-face rules (§8)
```

**The hook** (`themeScene.ts`) is the only change the app itself sees. It keeps a small table of the themes that have a scene, keyed by theme name (`{ps: () => import("./scenes/ps/scene")}`), so `configuration.ts` stays plain data. When `settings.ts` applies a theme (and on boot's fallback path, when a stored theme no longer exists), the hook unmounts any current scene and mounts the new theme's, if it has one. The mount target is one empty element in `client/index.html`, `<div id="theme-scene" aria-hidden="true">`, placed after `#status-bar-tint` and before the app's root, and fixed behind `#viewport`. The hook also tells the scene which kind of conversation is open (`channel`, `query` or `other`) and when the page is hidden or shown. It never reads colours, times or anything else theme-specific. A scene module exports `mount(el): {update(view), destroy()}`.

**The engine** is pure arithmetic from a `Date`: minutes since local midnight, day of year, sunrise and sunset, the canonical-day position, season weights, the day's weather, the sun's and moon's positions on their arcs, the moon's elongation, and the scalar levels (darkness, star and Milky Way opacity, glow, smoke, fireflies, birds, water, snow cover, flowers). It loads under mocha.

**The palette module** holds the colour tables and turns the engine's output into colours: the scene's continuous colours (sky, land, felt, glow, cloud, sun) and the two continuous colours needed outside the scene: the daytime text halo and the sky-top colour that the page canvas and the iOS status bar take. Tables and interpolation follow the mockup exactly (§5.2).

**The scene module** builds the elements once (stars, clouds, land, yurt, grass, fireflies, birds; weather particles only while that weather is on), then on each tick writes the engine's and palette's output as custom properties on its own root. All motion is CSS animation or SVG animation; **no script runs per frame**. It ticks once a minute, aligned to the minute, and again whenever the page becomes visible.

**The chrome** reads what the scene publishes on `<html>`: two discrete states, `data-ps-light="day|night"` (the glass panels flip at darkness 0.5) and `data-ps-text="ink|light"` (the words over the open scene flip at darkness 0.05), and two colours, `--ps-halo` for the daytime text and `--canvas-bg-color`, the sky-top colour of the hour (§6). Everything else about the chrome is ordinary CSS in `ps.css`.

**Without the scene** (the chunk has not loaded yet, failed to load, or an older build is running), `ps.css` alone renders a legible daytime version: a fixed daylight sky on the page canvas, the day glass and ink text, with daylight values for `--ps-halo` and `--canvas-bg-color` defined outside any state selector. It never falls back to an unstyled or midnight state.

## 4. The model of time

All of this is the mockup's arithmetic, moved into `engine.ts` and made testable.

- **The clock** is the viewer's local time. Minutes since local midnight, refreshed each minute.
- **Day length** comes from the day of year at an assumed latitude of 45° N: solar declination `−23.44° · cos(2π (doy + 10) / 365)`, hour angle from `cos H = −tan φ · tan δ`, solar noon fixed at 12:30 (allowing for daylight saving on average).
- **The canonical day.** Every palette stop was tuned for sunrise at 06:30 and sunset at 19:15. A real day of any length is mapped onto that one: 90 minutes of dawn before sunrise and 105 of dusk after sunset keep their true lengths, the day between stretches linearly, and the night takes the rest. So the stops stay pinned to the real sunrise and sunset in every season.
- **Seasons** are weights that sum to 1, blended between four anchors at the cross-quarter days (winter 1 Feb, spring 1 May, summer 1 Aug, autumn 1 Nov, day-of-year 32/121/213/305). The land's colours shift from midsummer green towards the season's own palette, more strongly by day. Snow darkens the land's colours at night in proportion to winter's weight.
- **Weather** is drawn once per local calendar day from a hash of the day number and the season's odds:

  | Season | Odds                                   |
  | ------ | -------------------------------------- |
  | spring | rain 30 %, wind 12 %, otherwise clear  |
  | summer | heat 45 %, storm 12 %, otherwise clear |
  | autumn | wind 38 %, rain 20 %, otherwise clear  |
  | winter | snow 42 %, wind 12 %, otherwise clear  |

  Each weather sets the dimming veil, cloud greying, how much of the sun and moon it hides, particles, wind (sway amplitude, faster clouds, seeds on the air), lightning (storm) and heat (daylight only). The values are the mockup's `WX` table.

  One thing here is not the mockup's: `engine.ts`'s `rng`, which seeds this hash and the star positions, is mulberry32 where the mockup used an LCG, so each day's weather and where the stars sit differ from the mockup's.

- **The sun** rides one arc from the reading start (sunrise) to the reading end (sunset); it grows up to 45 % larger and warms from gold to deep orange as it nears the horizon. **The moon** rides the same arc through the night.
- **The moon's phase** is the true elongation: the moon's ecliptic longitude minus the sun's, with the six largest periodic terms (`heart-theme.md` §11.2b). Illumination is `(1 − cos D) / 2`. Drawn with three shapes (a dark disc, the lit half, one ellipse of horizontal radius `R · |cos D|`), mirrored when waning, northern-hemisphere orientation. **Within 9° of new, there is no moon at all**, and the night is darker and starrier for it.

The tests pin the true instants against measured values, not the mean month, to within 0.1° of elongation (about 12 minutes, `test/scenes/ps/engine.ts`): full moon 2026-09-26 16:52 UTC (published 16:49, 3 minutes off) and new moon 2026-10-10 16:00 UTC (published 15:50, 10 minutes off). An earlier `<3` figure for the same two events — 2026-09-26 15:02 UTC and 2026-10-10 14:02 UTC, computed for that theme's day/night plan — was an hour or two off; these are the ones the engine is checked against.

## 5. The scene

### 5.1 Layers, back to front

The mockup's window is the drawing. In order:

1. **Sky**: a three-stop gradient (top, mid, horizon) filling the window.
2. **Milky Way**: a soft band, visible on dark nights, strongest when there is no moon.
3. **Stars**: about 190, some brighter, some twinkling; they fade up through dusk and out through dawn.
4. **Horizon glow**: warm light on the side the sun is rising or setting.
5. **Sun**: a fire. An SVG turbulence-displaced disc with a bloom and slow rays. **Moon**: the phase shapes, with a soft halo.
6. **Clouds**: a field of six at three sizes, heights and speeds, drifting. Overcast weather greys them and hides the sun.
7. **The ground**, one group, so that heat shimmer bends all of it together:
   - the land: distant mountains (snow-capped in winter), the far plain, two bands of hills with trees, shrubs and tufts, and a rim of light along the hills at sunrise and sunset;
   - the river, reflecting the sky; in summer it dries to a stony bed, and in spring, autumn and winter it runs;
   - fireflies in the far fields;
   - the animal layer, empty (§5.6);
   - the yurt and its smoke (§5.3).
8. **Near grass**: blades along the foot of the window that sway, faster in wind, with small flowers in spring and summer. Outside the heat group, so the foreground stays crisp.
9. **Birds** (§5.4).
10. **Weather overlays**: the dimming veil, rain, snow, seeds on the wind, the storm's lightning, the heat band.

Geometry is in `%` of the scene's box, so the picture is the window at any size; small marks (stars, particles, embers) are in `rem`, per the repo's sizing convention. The scene is `aria-hidden`, holds no text and uses no CSS `content:` strings.

### 5.2 Colour through the day

Thirteen stops across the canonical day (00:00 night, 05:00, 05:45, 06:30 sunrise, 07:30, 10:00, 13:00, 16:00, 18:00, 19:00, 19:45, 21:00, 24:00), each giving 15 colours (sky top, mid and horizon, mountains, far plain, two hills, grass, grass blades, felt, the yurt's band, its door, cloud, cloud underside, horizon glow) and 4 levels (glow opacity, stars, Milky Way, darkness). Colours between stops are mixed linearly in sRGB, exactly as the mockup did. The table is the mockup's `K`; the season land table is its `SEASON_LAND`, relative to the midsummer `REF`. They move into `palette.ts` verbatim. Tuning them is a later, separate change, and the first build must match the approved drawing.

The sun's colours (core, edge, flame, bloom) mix from noon gold to horizon orange by how low it is. Smoke colour follows darkness.

### 5.3 The yurt

The mockup's drawing: felt walls and roof with a rope band and ribs, a patterned band, a carved and painted door, a crown ring with a stove pipe, stones and a woodpile beside it, a worn path to the door, desaturated so text over it stays readable.

- **Placement: the far third.** It stands at 72 % of the message column's width, measured from the column's reading-start edge, on the ground band. The message column is `#chat .chat` (`MessageList.vue`'s scroll container), which excludes the user list: `#chat` itself includes the user list and would push the yurt behind it. The scene measures the column and re-measures it when it resizes. With no message column on screen (Settings, Help, the connect form), the yurt keeps its last place.
- **It never moves.** When its place changes by more than 1.5 rem (the user list opens, the pane resizes, a private conversation opens), it fades out where it stood, jumps while unseen and fades back in where it now stands, 0.4 s each way, and its smoke goes with it. A smaller change, such as a window being resized, simply follows the layout with no animation. Nothing may transition its position.
- **At night**: the door, the seams and the crown glow warm from inside, a soft spill of light falls on the path, and smoke rises from the crown. By day there is no smoke and no glow, and nobody is ever drawn.
- **In winter** the roof carries snow.

### 5.4 Birds

Migrating flocks cross **at night and around sunset**, as geese do, in spring and autumn and more rarely in winter, heading one way in spring and back in autumn; rain and storms thin them. By day the sky has other birds, the steppe's own, which do not migrate; which ones is for plan 3 to mock up (a hawk or a kestrel circling, a lark rising). A skein at night is a dark shape on a dark sky, so how it reads — crossing the moon and the Milky Way, faintly lit from below by the moon, or both — is a question plan 3 answers with a mockup before it builds. Each bird is a side-on silhouette (a goose with its neck held straight out; a crane trailing its legs) whose near and far wings sweep through a real stroke: a quicker downstroke that lifts the body, an upstroke with the wrist bent, edge-on at mid-stroke. Every bird has its own beat, and cranes glide between bursts. Three skeins: a V of geese with uneven arms and a straggler, a slanting line of cranes, and a small, pale far skein. Each bird drifts about its place, and each skein rises, sinks and leans as it goes. The mockup's `bird()` is the reference, including its pose paths.

### 5.5 Fireflies, heat, river

- **Fireflies**: in the far fields on summer and late-spring evenings and nights, never in rain, snow or storm.
- **Heat**: on hot summer days while the sun is up, a gentle displacement shimmer over the ground group, the yurt included, plus a faint band above the horizon. The near grass stays crisp. The mockup's final values are the reference (turbulence frequency 0.007 by 0.05, displacement 2, a 9 s cycle), about 40 % of the first draft's strength.
- **River**: its water fades out as summer's weight rises and the stony bed shows through.

### 5.6 The animals, switched off

The scene carries one animal layer on the ground band with a fixed cast: a horse and a bunny near, and a deer far off. The files, rigs and generator are the `<3` theme's and stay where they are (`client/themes/ps/`, `tools/heart/`). One commented block in `ps.css` empties the layer's three slots. It is the only thing keeping them off, and deleting it brings them back. `test/themes/ps.ts` asserts the block exists and nothing after it refills a slot, and the browser check asserts that no animal file is ever fetched.

### 5.7 Private conversations

In a query, the same scene at the same hour is shown **behind frosted glass, completely still**: blurred (18 px, rescaled to rem), slightly desaturated, scaled up just enough to hide the blur's edge. Every CSS animation in the scene is paused and so are its SVG animations; its colours still follow the hour. Channels, the lobby and every other view show the scene as usual.

### 5.8 Right-to-left

Under `dir="rtl"` the whole scene is mirrored, so the sun still rises at the reading start and sets behind the yurt in the far third. The chrome follows the app's own RTL rules (logical properties). Each message keeps its own direction, as the app's `<bdi>` already does.

## 6. The chrome: glass over the plains

The sidebar, the channel header, the composer, the user list and the reaction chips are **tinted glass** over the scene: a translucent tint with a 10 px (0.625rem) backdrop blur, saturated 1.12, and a hairline edge on the side that meets the message column. The composer is one surface with its reply, upload and connection bars and the typing strip, so none of them takes a second blur. The message list itself has no background; the words sit directly on the plains. What holds dense text and controls is **solid**, the glass's colour made opaque: the settings pane, Help, the changelog, the connect form (not the one embedded in Settings, which sits on the pane), the context menu, the Mentions popover, the composer's autocomplete, the emoji picker and its sticky headings, the upload preview, the confirm dialog, the push prompt and the jump-to-recent disc. The message toolbar is solid too, but it follows the column's treatment rather than the chrome's light, because its icons are the column's colours. The chips follow the chrome's light, in the glass ink with no shadow under it; the viewer's own pressed chip and the "+" keep their own tints.

Two palettes, both in `ps.css`, switched by `data-ps-light` with a 0.8 s transition (`--ps-flip`, 0 s under reduced motion). The values as shipped, with the spec's first value in brackets where it moved:

| Token                      | Day glass                       | Night glass                                   |
| -------------------------- | ------------------------------- | --------------------------------------------- |
| glass tint                 | `rgb(255 251 244 / 78%)` (62 %) | `rgb(12 17 32 / 74%)` (58 %)                  |
| solid surface              | `#fbf8f2`                       | `#121827`                                     |
| ink                        | `#1f2a3d`                       | `#e9eef7`                                     |
| soft ink                   | `#4e5b73` (`#55627a`)           | `#b4c1d6` (`#a7b3c8`)                         |
| edge                       | `rgb(255 255 255 / 55%)`        | `rgb(255 255 255 / 9%)`                       |
| input field                | `rgb(255 255 255 / 72%)`        | `rgb(255 255 255 / 7%)`                       |
| selected row               | `rgb(255 255 255 / 60%)`        | `rgb(0 0 0 / 60%)` (`rgb(255 255 255 / 11%)`) |
| hovered row                | `rgb(255 255 255 / 30%)`        | `rgb(0 0 0 / 29%)`                            |
| the composer's bars        | `rgb(255 255 255 / 30%)`        | `rgb(0 0 0 / 19%)`                            |
| a hovered user in the list | `rgb(255 255 255 / 60%)`        | `rgb(0 0 0 / 40%)`                            |
| accent                     | `#c2562b`                       | `#d9784a`                                     |
| text accent                | `#9a3a10`                       | `#fbb291`                                     |
| badge fill                 | `#c05429`                       | `#b85a2b`                                     |

- **The opacity, the soft ink, the badge and the text accent are generated**, into `ps.css`'s `ps:glass-palette` block, with the chrome's two nick sweeps (§7). The generator raises each tint's opacity from the spec's until the glass ink and soft ink hold 4.5 : 1 over every ground behind it (§11). Both stopped at their caps, 0.78 and 0.74, so both soft inks also moved under rule 2 (§11): by day `#55627a` → `#4e5b73` (OKLCH L −0.025), whose worst ground is the dusk sky of early January at 17:00 behind the glass (`#d1d1d8`); at night `#a7b3c8` → `#b4c1d6` (+0.043), over the full moon or the low sun behind the glass.
- **The text accent** (1A, §2). The spec's accent reads 2.97 : 1 on the day glass and 2.63 : 1 on the night glass, short of the floor wherever the chrome writes or marks with it. `--ps-g-accent-text` keeps the accent's hue and chroma, and its lightness is solved against the worst glass ground like a nick's: `#9a3a10` (4.63 : 1 on the glass, 6.63 : 1 on the solid) and `#fbb291` (4.64 : 1, 10.02 : 1). Links, button labels, the send and connecting icons, the reply bar's rule and a chip's hover and focus border take it; text on it is white by day and the night solid at night. The spec's accent stays for the open row's marker, the caret, the focus glow and the accent's tints.
- **One badge**, as the mockup draws it: unread and mention alike, the generated fill (the accent, darkened until its white numeral holds 4.5 : 1) and a white numeral. A mentioned row still stands out by its name in the full ink.
- **The washes move away from the text** (§2). By day every wash on the glass lightens toward the paper: the spec's selected row and its hover, and in place of creama's grey tints the composer's bars at white 30 % and a hovered user at white 60 %. At night they deepen toward black: the selected row 60 %, a hover 29 %, the bars 19 %, a hovered user 40 %. Each night strength is the weakest black as visible as the white it replaces (the median contrast between the washed and the bare glass over the checked grounds), and `test/themes/ps.ts` holds each at that visibility and never below 1.02 : 1 over the darkest sky. The solid panels keep creama's and coffee's tints.
- **The phone's drawer stays glass.** `style.css` dims the whole viewport under the open drawer, and the glass frosted that dimming into a grey drawer whose soft ink fell to 4.20 : 1. The scrim starts at the drawer's inner edge instead (`left: var(--sidebar-width)`, physical like the drawer), so the drawer frosts the undimmed plains as on the desktop, and the strip beside it still dims and still takes the tap that closes it. Since the measured budget (§10) the phone's always-on glass (the header, the composer, the chips) has no backdrop filter and keeps the generated tint. The drawer and the user list, which lie over the chat, keep their glass (§10.1, "Task 8c"): shown, they are blurred and brightened by day, on the chips' tint in every state, so the drawer frosts the undimmed plains again.
- **A conversation on a network that is down** fades its messages and the jump-to-recent disc's arrow rather than `.chat-content`: an opacity under 1 makes an element a backdrop root, and the user list inside it lost its blur. The fade's transition is on the base rules, so it eases back on reconnect as well as out.
- **Reduced transparency** (`prefers-reduced-transparency: reduce`) makes every glass surface solid, `--ps-g-solid` with no blur, by day and at night.

Every coffee token the app reads (`--chat-*`, `--rail-*`, `--composer-*`, notice boxes, code tokens, scrollbars, focus ring) is defined for both, which makes the night palette a second full palette, not a tint pass (`heart-theme.md` §12); the night one also sets `color-scheme: dark`, so native controls turn dark on the navy solid. The secondary colours are creama.css's by day and coffee.css's at night. Six of them fell short on the glass or the solid and moved under rule 2: by day `--event-quit` `#a4472e` → `#973c23`, `--nick-default` `#9c5f13` → `#834c01` and `--event-join` `#5f8033` → `#5a7b2d`; at night `--nick-default` `#e6a45c` → `#f8b56d`; and the code comment outside the column (the Mentions popover) `#8a8075` → `#7c7268` by day and `#8b8177` → `#998f84` at night. A parted or disconnected row's name at night needed more than rule 2 allows: coffee's `#e08a72` → `#feaf98` (OKLCH L +0.106) is the user's 2A (§2). These moves are recorded in `ps.css`'s comments and held by the chrome's floors test; the mocha bound on rule 2's 0.08 covers the generated soft inks and the column's faint ink.

**The iOS status bar** reads `#status-bar-tint`, which must paint and must not carry a backdrop filter (`CLAUDE.md`, "The iOS status bar"). Its colour and the page canvas's are `--canvas-bg-color`, which `ps` sets to the scene's sky-top colour of the hour, so the bar matches the sky under it. The scene's own element is a second candidate for iOS to sample: it is fixed, full width and flush with the top, and nothing documents which element iOS picks when two qualify. So:

- `#theme-scene` comes after `#status-bar-tint` in the document;
- its `background-color` is also `--canvas-bg-color`, with the sky gradient in `background-image` above it, so the bar is right whichever element iOS samples;
- no glass blur is ever put on `#status-bar-tint` or an ancestor of it (`html`, `body`): `test/themes/ps.ts` holds the stylesheet to that, and the browser check reads the tint's own computed `backdrop-filter`;
- this needs checking on a real device, with the icon removed and re-added (§12), because no scenario can prove it. Plan 2 has landed and the check is still to do: it is the user's, on an iPhone.

**`theme-color` follows the sky too.** Each tick the scene writes the hour's sky-top into `<meta name="theme-color">`, so the browser's own bar runs on into the sky; it keeps the value the theme had and hands it back when it is destroyed, unless something else has written the meta since. Before the scene loads, `configuration.ts` gives `ps` `#3f8fe6`, the daylight fallback's canvas.

## 7. The words over the plains

Two treatments, switched by `data-ps-text`:

- **Ink**, in full daylight (darkness below 0.05): ink `#1b2638`, faint ink `#38455c`, with a close three-layer halo (6, 2 and 1 px, rem-converted) in `--ps-halo`, the horizon colour of the hour mixed 55 % toward white. The faint ink was `#4c5a72`, and moved under rule 2 (§11, OKLCH L −0.076): through the halo, over the sky-top of an early-January late afternoon (`#547bc1`, 8 January at 16:10), it read 2.18 : 1 and reads 3.02 : 1.
- **Light**, while the light changes and all night: white ink, faint ink white at 80 %, with a close three-layer dark shadow (`0 1px 1.5px` at 70 %, `0 0 3px` at 45 %, `0 1px 10px` at 35 % black) plus, under it, an eight-way 1 px outline at 78 % black — the calibration (§11) found the shadow alone too weak over the brightest grounds (the moon's disc, the sun's low core, a bright dawn/dusk horizon); shown three measured candidates, the user chose this one, "B" (https://claude.ai/artifact/TGGrXDMs2fxLrV9NekKMWJ: "go with B").

Every colour the column reads is generated into `ps.css`'s `ps:message-palette` block by `tools/ps/palette-blocks.ts` and checked in as values: each keeps its base's OKLCH hue and chroma, and only its lightness is solved against the worst ground its treatment meets (§11).

- **The nicks** (the app's 32 slots, `.user.color-1` … `-32`) all come from one table of 32 hues, warm-leaning like the mockup's four (rust, teal, violet, ochre), at OKLCH chroma 0.11. The column has a dark sweep for ink text and, for light text, the user's **names-large** set (§2): held at 3 : 1 as WCAG large text over the sky and the moon's and sun's discs, since a nick at the default font-size step is Fraunces 700 at 20 px, 15 pt bold. At the tiny, small and medium steps, and on an `<html>` that carries no step yet, the names are not large text, so they take the paler **sky** set, held at 4.5 : 1 over the sky. The chrome has two sweeps of its own from the same hues, for the day and the night glass, in the `ps:glass-palette` block. Each surface picks the sweep for its own state, so at dusk a nick in the chat (light treatment) and the same nick in the user list (still day glass) can differ.
- **Every other coloured word** (muted text, links, join and quit, notices, the default nick) is held at 4.5 : 1. Under the light treatment that holds over the discs as well as the sky, which leaves them nearly white, so colour alone no longer marks a link there: **links in the column are underlined** under the light treatment. By day the ink treatment's link colour still marks them.
- **The column's code boxes** (a code block, inline code, inline monospace, the monospace block) paint their own opaque surface, `--ps-code-bg`: `#f4f9ff` in the ink treatment, `#121827` in the light. The code highlighter's tokens are solved on that box, not on the plains.

**Shadows are never clipped.** The nick column clips for its ellipsis: it pads its clip box by the shadow's reach and takes the padding back with a negative margin, so nothing moves. The chrome's clipped text (channel names) sits on the glass, which draws no text shadow, so nothing else needs the same.

## 8. Type

- **Mulish**, weight 500, for everything read: messages, the sidebar, the composer, menus and settings. Bold is 800.
- **Fraunces**, weight 700, for the names the eye jumps to: nicks, channel and network names, the header title.

Both are bundled in `client/themes/ps/` with their OFL licences as Google Fonts' variable woff2 files, in the weight ranges the approved mockup loaded: Mulish 400–800, upright and italic, and Fraunces 600–700. Each style is three files, Latin, Latin Extended and Vietnamese, and a face needs all of them, or plain, accented or Vietnamese text draws partly in the fallback font (the latin-ext trap; Vietnamese's stacked letters, ệ and ễ in U+1EA0–1EF9, are in neither Latin file, so "Nguyễn" drew partly in the fallback until the third file shipped). The Vietnamese rule is written first: where the ranges overlap (ă, đ, ơ, ư, ₫ and a few combining marks), the face defined last is tried first, so the Latin files still draw everything they drew before. `node tools/ps/fetch-fonts.mjs` fetches the nine files and two licences, refusing any answer that is not a 2xx, and writes the `@font-face` rules into `ps.css` between its `ps:fonts` markers. Coverage is proved by rendering, not by FontFace status: the browser check reads which fonts Chromium drew in, for an italic hostmask, for a Latin Extended name, line and query name, and for a Vietnamese name upright, in italic and as a query. No other subset is bundled, so Cyrillic, Greek and every other script fall back to the system stack mid-line (Fraunces has no Cyrillic or Greek at all, and Mulish's Cyrillic is left unbundled); a name in one falls back to the system serif. The `<3` theme's Nunito and Baloo 2 are gone.

No timestamp width is restated. Mulish's tabular numerals fit `style.css`'s own `ch` widths for every clock format at every font-size step: the widest case, 12-hour with seconds at the xlarge step, is 129 px of text in a 180 px column (`tools/scenarios/message-gutter.mjs` with `SEANCE_THEME=ps`).

## 9. Motion

- **Embers** replace the glitter, on the same two moments the glitter used (`heart-theme.md` §4): an own message arriving, and a reaction being added. A few small glowing sparks rise and fade from the message or the chip over about two and a half seconds, staggered. CSS only, on pseudo-elements.
- Kept from the groundwork: messages fade in, the chrome rises into place on load, and a mention glows twice.
- Colour changes between minutes are too small to see; the flip between day and night glass and between the two text treatments transitions over 0.8 s.

**Reduced motion** (`prefers-reduced-motion: reduce`) stands down: drifting clouds, twinkling stars, the sun's fire and rays, grass sway, smoke, fireflies, birds (hidden), rain, snow and seeds (their dimming veil stays, so a rainy day still looks rainy), lightning, heat shimmer, embers, and the fades and rises. **The colours stay correct for the hour**: a reader at midnight gets the night.

## 10. Performance

Rules:

- No script per frame. The scene updates once a minute and when the page becomes visible.
- Only the weather that is happening exists in the page: rain drops are built on rainy days, not hidden on clear ones.
- The page hidden means the scene stopped: all its animations paused, SVG animations paused, no timer.
- Nothing animates unseen: a layer with a window (the stars, the fireflies and the smoke by day, the sun once it is down, the skeins by day, a flock past the night's count, the buzzard, the larks, the heat band) is out of the render tree outside it, its SMIL paused, rather than animating at opacity 0. It goes once its fade is over and comes back before it fades in (`layers.ts`, §10.1).
- Backdrop blur only on the chrome's glass panels and chips, never on the scene or on `#status-bar-tint`.
- Under the phone layout (`PHONE_LAYOUT_QUERY`), particle counts are halved.

Budget: a plan task measures the idle cost of the scene in Chromium (a 10-second performance trace of a quiet channel at midday on a clear day and on a rainy one, desktop and phone layouts, with and without 4× CPU throttling) and records the numbers in this document as the baseline. If the phone layout measures badly, the **pre-decided fallback** is glass without backdrop blur on the phone layout, with the tint made more opaque to keep the contrast floors.

### 10.1 The measured budget (plan 3, 2026-09-25)

**The fallback applies.** On the phone layout at 4× throttling the main thread was busy 87–99 % of every trace, against the 50 % threshold. The frame interval passed only as the compositor counts it. Frames reaching the screen came 16.6–32.9 ms apart on average, under the 33 ms threshold in every weather, with the hot day closest. The main thread's own frames came 85–107 ms apart, and those frames are what advance the SMIL and every animation the compositor cannot run. Under `PHONE_LAYOUT_QUERY` the glass surfaces (the sidebar, the header, the user list, the composer, the risen composer and the chips) now carry no `backdrop-filter`: no blur and no day brightening. They take the generated tint, `--ps-g-tint-a` (0.78 by day, 0.74 at night), instead of the scene's per-surface day tints. Those tints are solved through `brightness(1.3)`, so without it they are not proven. The generated tint is the legibility model's, which counts no filter: over the sparse sweep and the pinned moments, the day glass's soft ink reads 4.50 : 1 at worst and its join-green marks 3.11 : 1, and the night soft ink 4.52 : 1. The suite holds the text at this opacity (`test/scenes/ps/legibility.ts`, the declared opacity); the marks' 3.11 was checked outside it, with a scratch script, when this was measured. `test/themes/ps.ts` pins both halves and that the phone rule comes after every rule it overrides. Reduced transparency's solid still wins over it. `#status-bar-tint`, `html` and `body` carry no filter, as before. The desktop is unchanged. (Task 8c, below, gave the drawer and the user list their glass back while they are shown.)

**What the fallback shows: the conversation through the drawer.** Without the blur, the conversation's own words show through the phone's open drawer and through a user list laid over the chat. They show at 22 % by day and 26 % at night; `tools/scenarios/theme-ps.mjs`'s `ps-phone-night-sidebar` screenshot is the plainest case. The legibility model counts the scene's grounds, not the words' outline and shadow. Where a drawer glyph in the soft ink crosses a word's dark outline by day, the local contrast is about 4.06 : 1 (the outline taken as black under the 78 % tint). At night, the soft ink over a white word behind reads 4.45 : 1; the full inks hold (8.28 and 7.03). Whether those two overlays should instead be solid on the phone, as the dense panels are, is the user's call. Task 8c (below) gave them their glass back, which blurs the words away, and measured what it leaves.

**The fallback does not bring the phone under budget.** After it, the phone at 4× is still 91–99 % busy. It took the compositor's share down (the GPU process's compositor thread on a clear day from 24 % to 15 %, rain 56 → 45 %, dusk 41 → 30 %, heat 93 → 88 %) but not the main thread's. The main thread's cost is the scene's animation, not the glass (below).

**How it was measured.** The machine was a production build served statically, driven by `tools/browser-drive.mjs` in headless Chrome for Testing 153 (Playwright's build). It ran with `--disable-gpu`, so **software compositing, no GPU**, on a shared Intel Xeon E5-2680 v4 (2.4 GHz) host at `nice 19`. The numbers are pessimistic: the backdrop blur and the scene's SVG filters are rasterized on the CPU, where a phone's GPU would do them. **iOS Safari cannot be measured here**; nothing here says what WebKit's compositor or an iPhone's GPU makes of it. The page was an idle `#seance` on the dev ircd with about 55 messages of history on screen, the user list open on the desktop and closed on the phone, and the drawer closed. The desktop layout was 1280 × 900. The phone layout was 390 × 844 with mobile and touch emulation at a device scale factor of 1; a real phone draws 3× the pixels each way. Each run pinned the scene's clock with a `Date` shim under a GMT time zone, flipped the page hidden and visible so the scene ticked, and settled for 5 s. It then traced 10 s with `devtools.timeline` and `disabled-by-default-devtools.timeline.frame`, plus `disabled-by-default-devtools.timeline`, `toplevel` and `blink.user_timing`, which give the top-level tasks and the window's marks. Each trace opened about 3 s before a minute boundary that starts a new 5-minute tint step, so the scene's own tick and its day-glass solve fall inside it. The traces ran one at a time. 4× is `Emulation.setCPUThrottlingRate`, which slows the renderer's main thread only.

- **busy**: the union of the page renderer's main-thread top-level tasks over the window;
- **frame**: the interval between consecutive `DrawFrame` events on the page's compositor thread, which is what reaches the screen, compositor-driven animations included;
- **main frame**: the interval between `BeginMainThreadFrame` events, which is how often SMIL and every animation the compositor cannot run advance;
- **style, layout, paint**: `UpdateLayoutTree`, `Layout` and `Paint` events per second on the main thread (layout counts equal style counts in every run: one of each per main frame);
- **viz**: the GPU process's compositor thread busy, where software compositing draws.

The days: 25 September is clear and 26 September rainy. 1 July is hot, with the heat haze. Dusk is 25 September at 18:30: sunset is 18:23, the day glass is still up, and the three autumn skeins fly (the moon rises between 18:30 and 18:45, so they are not yet moonlit). "Birds" names what was on screen when the trace opened. The skeins cross during the trace.

| Layout  | Run             |   × | Birds on screen             | Busy % | Frame mean / p95 (ms) | Main frame mean / p95 (ms) | Style/s | Layout/s | Paint/s | Viz % |
| ------- | --------------- | --: | --------------------------- | -----: | --------------------: | -------------------------: | ------: | -------: | ------: | ----: |
| desktop | clear           |   1 | buzzard                     |   72.7 |           31.1 / 38.7 |                38.6 / 67.2 |    51.8 |     51.8 |    1114 |    91 |
| desktop | clear           |   4 | buzzard                     |   92.1 |           32.5 / 38.6 |              117.1 / 167.9 |    17.1 |     17.1 |     369 |    85 |
| desktop | rain            |   1 | none                        |   67.9 |           43.8 / 78.1 |                47.7 / 81.9 |    41.9 |     41.9 |     902 |    97 |
| desktop | rain            |   4 | none                        |   92.2 |           47.5 / 73.9 |              139.9 / 196.3 |    14.4 |     14.4 |     309 |    88 |
| desktop | heat            |   1 | buzzard, 3 larks            |   20.1 |         117.4 / 222.6 |              124.5 / 222.1 |    16.1 |     16.1 |     352 |    99 |
| desktop | heat            |   4 | buzzard, 3 larks            |   72.3 |         117.3 / 223.2 |              132.5 / 236.2 |    15.1 |     15.1 |     333 |    99 |
| desktop | dusk            |   1 | 3 skeins (38 geese)         |   58.7 |           39.2 / 71.7 |                44.1 / 73.2 |    45.3 |     45.3 |     971 |    97 |
| desktop | dusk            |   4 | 2 skeins (26 geese) in view |   88.7 |           41.9 / 70.8 |              105.8 / 149.5 |    18.9 |     18.9 |     403 |    91 |
| phone   | clear           |   1 | buzzard                     |   99.3 |           16.7 / 29.7 |                30.8 / 49.3 |    32.5 |     32.5 |    1398 |    25 |
| phone   | clear           |   4 | buzzard                     |   98.9 |           16.7 / 29.7 |               92.6 / 128.8 |    10.8 |     10.8 |     464 |    24 |
| phone   | rain            |   1 | none                        |   98.2 |           16.7 / 30.3 |                28.6 / 48.5 |    35.0 |     35.0 |    1503 |    56 |
| phone   | rain            |   4 | none                        |   99.2 |           16.6 / 29.3 |               98.7 / 126.8 |    10.1 |     10.1 |     435 |    56 |
| phone   | heat            |   1 | buzzard, 3 larks            |   70.4 |           32.4 / 38.5 |                37.9 / 65.3 |    26.4 |     26.4 |    1160 |    95 |
| phone   | heat            |   4 | buzzard, 3 larks            |   87.3 |           32.9 / 42.5 |              107.1 / 134.9 |     9.3 |      9.3 |     411 |    93 |
| phone   | dusk            |   1 | 3 skeins (20 geese in view) |   98.4 |           16.7 / 29.9 |                29.3 / 42.8 |    34.0 |     34.0 |    1460 |    40 |
| phone   | dusk            |   4 | 3 skeins (15 geese in view) |   99.2 |           16.7 / 29.5 |               85.2 / 104.7 |    11.7 |     11.7 |     501 |    41 |
| phone   | fallback: clear |   1 | buzzard                     |   99.3 |           16.7 / 29.8 |                31.7 / 47.5 |    31.5 |     31.5 |    1357 |    15 |
| phone   | fallback: clear |   4 | buzzard                     |   99.2 |           16.7 / 28.0 |               98.8 / 135.1 |    10.1 |     10.1 |     434 |    15 |
| phone   | fallback: rain  |   1 | none                        |   98.9 |           16.7 / 30.3 |                31.3 / 43.3 |    31.9 |     31.9 |    1374 |    44 |
| phone   | fallback: rain  |   4 | none                        |   99.2 |           16.6 / 28.3 |              108.5 / 157.8 |     9.1 |      9.1 |     394 |    45 |
| phone   | fallback: heat  |   1 | buzzard, 3 larks            |   76.8 |           29.7 / 40.8 |                34.8 / 57.8 |    28.7 |     28.7 |    1263 |    93 |
| phone   | fallback: heat  |   4 | buzzard, 3 larks            |   90.9 |           32.4 / 38.1 |              101.6 / 134.1 |     9.8 |      9.8 |     433 |    88 |
| phone   | fallback: dusk  |   1 | 3 skeins (20 geese in view) |   98.8 |           16.7 / 29.6 |                29.3 / 44.4 |    34.1 |     34.1 |    1463 |    30 |
| phone   | fallback: dusk  |   4 | 3 skeins (13 geese in view) |   99.2 |           16.7 / 28.2 |               96.8 / 131.0 |    10.3 |     10.3 |     441 |    30 |

**Where the main thread goes: style recalculation for the scene's animations.** It takes 48–74 % of the phone's main thread. On the desktop it takes 37–56 %, except on the hot day, when the compositor holds the frames back. Every main frame restyles about 610 elements, or 770 on a rainy day with its drops. Each costs 30–45 µs, some 20–23 ms per frame on this CPU unthrottled. Two attribution runs, on the phone with the fallback on a clear noon at 1×, split it:

- with the scene's SMIL paused and its CSS running, 350 elements are restyled per frame and the thread is 89 % busy, with almost no painting (4 paints/s);
- with its CSS paused and its SMIL running, 250–300 elements are restyled per frame (78 µs each) and the thread is 96 % busy, painting 1427 times a second.

Either half alone keeps the thread near full. Part of it animates unseen. By day the three skeins are laid out at opacity 0 with their wingbeats (SMIL) and flight (CSS) still running. The larks do the same out of season, and the skeins on a day with none (count 0). Nothing here was changed; it is a candidate for its own task.

**The heat haze is the compositor's heaviest item.** On a hot day the GPU process's compositor thread is 88–99 % busy on both layouts. The desktop draws 8.6 frames a second (a 117 ms mean) even unthrottled, which is why its main thread idles at 20 %: it is waiting on frames. That is software compositing's worst case, and the one to recheck on a device.

**A hidden page does no scene work.** On the hot day, the haze's SMIL included, all 49 of the scene's SVGs report their animations paused and none of its 162–196 CSS animations is running. The 10 s trace, which spans the minute boundary the scene's timer was set for, holds no timer firing, no animation frame, no style, layout or paint, and no drawn frame, on both layouts. The page renderer used 0.1 % of a core.

**The day glass's solve (task 7b) is cheap.** The scene's tick at a new 5-minute step, with the solve included, took 2.3–3.9 ms unthrottled and 3.1–6.7 ms at 4× across the runs. Timed alone around the visibility flip on one clear day, 15 new steps against the same 15 steps again, the medians were 2.6 against 0.9 ms (the solve about 1.7 ms) and at 4× 9.2 against 3.2 ms (about 6 ms; the throttle works in time slices, so short spans at 4× are noisy). It runs once per 5 minutes.

**`brightness(1.3)` costs nothing measurable.** A clear noon with the shipped filter against the same noon with `--ps-g-lift` overridden to nothing:

| Layout  |   × | Busy % (shipped / no lift) | Frame mean ms | Viz %   |
| ------- | --: | -------------------------- | ------------- | ------- |
| desktop |   1 | 72.7 / 74.7                | 31.1 / 30.2   | 91 / 91 |
| desktop |   4 | 92.1 / 92.9                | 32.5 / 31.9   | 85 / 85 |
| phone   |   1 | 99.3 / 98.5                | 16.7 / 16.6   | 25 / 24 |
| phone   |   4 | 98.9 / 99.2                | 16.7 / 16.7   | 24 / 24 |

The differences are within the run-to-run noise.

#### After Task 8b (2026-09-26)

**Two invisible changes took most of the scene's cost out. The phone at 4× is now under budget on a clear day (36–44 % busy over three runs), and over it in rain (80 %), heat (62–69 %) and at dusk (99 %).** The fallback stays (below).

**Why it cost so much.** Chromium restyles the element of every running animation on every main frame, composited or not. The scene's SMIL keeps main frames at 60 Hz all day: the sun's fire by day, the wingbeats around sunset and at night. So every animation in the scene paid a restyle 60 times a second, the unseen ones included. Each restyle was also far dearer than it needed to be, and dragged the element's children along.

- **Candidate 1: a layer outside its window leaves the render tree** (`layers.ts`, §10's rule above). By day that removes about 150 of the 160 CSS animations and 120 of the 123 SMIL ones: the skeins, the stars, the fireflies, the smoke and, out of season, the larks. The heat haze's SMIL is paused while it bends nothing.
- **Candidate 3: the scene states its `box-sizing`** (`#theme-scene, #theme-scene * { box-sizing: border-box }`). `style.css`'s `*, *::before, *::after { box-sizing: inherit }` marks every element as explicitly inheriting a non-inherited property. Chromium then recalculates an element's children with it, and each recalculation cost about 4× as much (26–36 µs per element unthrottled before, 7–8 µs after). The value is the one `html` already gave every scene element.
  - It was found by elimination: turning the app's stylesheet off took a frame's style recalc from 3.3 to 0.27 ms, and this one rule takes it to 0.28 ms.
  - The hypothesis Task 8 left, the per-element custom properties, was tested and is not the lever. `@property { inherits: false }` on them made each element slower (64 → 278 µs, one run with the rule injected at runtime). Writing the timing values inline saves 8–14 % of the style time, which is within the run-to-run spread per frame, so it was not made.

**Which helped by how much.** Phone, 4×, main-thread ms per main frame (busy % ÷ main frames per second). At 60 frames a second, 50 % busy is 8.3 ms.

| Run   | Before | + candidate 1 | + candidate 3 |
| ----- | -----: | ------------: | ------------: |
| clear |   93.6 |          14.4 |           7.4 |
| rain  |  109.0 |          21.7 |          13.5 |
| heat  |   98.2 |          22.2 |          10.4 |
| dusk  |  105.5 |          86.1 |          45.6 |
| night |   96.4 |          86.4 |          47.7 |

**The measurements.** The method is §10.1's, on a production build served from 127.0.0.1:8054. The baseline was re-measured at `a95e9a2c` (the shipped scene with the fallback) and is within a point of Task 8's table. The traces ran one at a time, without `nice`. Main frames are `BeginMainThreadFrame`; "ms/frame" is the main thread's work per main frame; frame is `DrawFrame` on the compositor.

| Layout | Run   |   × | Busy % before → after | Frame mean / p95 ms (after) | Main frame mean / p95 ms (after) | Main frames/s | ms/frame before → after | Viz % before → after |
| ------ | ----- | --: | --------------------: | --------------------------: | -------------------------------: | ------------: | ----------------------: | -------------------: |
| phone  | clear |   1 |           99.1 → 11.6 |                 16.7 / 16.8 |                      16.7 / 16.8 |            60 |              31.7 → 1.9 |              20 → 19 |
| phone  | clear |   4 |           99.2 → 43.9 |                 16.7 / 16.8 |                      16.7 / 17.3 |          59.7 |              93.6 → 7.4 |              15 → 17 |
| phone  | rain  |   1 |           98.9 → 20.4 |                 16.7 / 16.9 |                      16.7 / 16.8 |            60 |              29.6 → 3.4 |              44 → 48 |
| phone  | rain  |   4 |           99.2 → 79.5 |                 16.7 / 19.7 |                      16.9 / 19.5 |          59.1 |            109.0 → 13.5 |              44 → 48 |
| phone  | heat  |   1 |           75.8 → 16.8 |                 16.7 / 16.8 |                      16.7 / 16.8 |            60 |              27.0 → 2.8 |              93 → 23 |
| phone  | heat  |   4 |           91.3 → 61.9 |                 16.7 / 18.5 |                      16.9 / 17.2 |          59.3 |             98.2 → 10.4 |              88 → 22 |
| phone  | dusk  |   1 |           98.5 → 55.6 |                 16.7 / 17.1 |                      16.7 / 16.9 |          59.9 |              27.3 → 9.3 |              30 → 34 |
| phone  | dusk  |   4 |           99.2 → 99.0 |                 16.7 / 30.9 |                      46.0 / 53.2 |          21.7 |            105.5 → 45.6 |              29 → 34 |
| phone  | night |   1 |           98.9 → 61.0 |                 16.7 / 16.9 |                      16.7 / 16.8 |          59.9 |             30.5 → 10.2 |              29 → 35 |
| phone  | night |   4 |           99.3 → 98.8 |                 16.7 / 30.7 |                      48.3 / 54.8 |          20.7 |             96.4 → 47.7 |              23 → 29 |
| desk   | clear |   1 |            72.2 → 8.2 |                 34.1 / 42.2 |                      34.1 / 42.2 |          29.4 |              29.5 → 2.8 |              96 → 98 |
| desk   | clear |   4 |           92.5 → 39.6 |                 27.9 / 30.1 |                      28.6 / 30.3 |          34.9 |             94.4 → 11.3 |              84 → 97 |
| desk   | rain  |   1 |           53.5 → 17.8 |                 45.0 / 83.2 |                      45.2 / 83.1 |          22.0 |              29.2 → 8.1 |              95 → 96 |
| desk   | rain  |   4 |           85.8 → 61.7 |                 44.9 / 84.2 |                      49.1 / 85.5 |          20.4 |            112.9 → 30.2 |              89 → 96 |
| desk   | heat  |   1 |           19.8 → 13.6 |                 30.3 / 31.7 |                      30.7 / 31.8 |          32.6 |              25.4 → 4.2 |              99 → 97 |
| desk   | heat  |   4 |           79.0 → 51.5 |                 30.3 / 33.7 |                      31.5 / 36.7 |          31.8 |             98.8 → 16.2 |             100 → 97 |
| desk   | dusk  |   1 |           66.2 → 29.7 |                 39.3 / 73.5 |                      41.5 / 73.7 |          24.0 |             29.3 → 12.4 |              96 → 96 |
| desk   | dusk  |   4 |           89.6 → 68.2 |                 40.7 / 68.0 |                     80.7 / 108.9 |          12.4 |            103.0 → 55.0 |              93 → 91 |
| desk   | night |   1 |           65.5 → 32.4 |                 35.8 / 66.8 |                      36.7 / 66.8 |          27.2 |             27.6 → 11.9 |              98 → 97 |
| desk   | night |   4 |           92.7 → 74.5 |                 35.2 / 46.4 |                     71.5 / 100.9 |          14.0 |             93.6 → 53.2 |              98 → 97 |

- **Where busy % stays high, the frames got cheap and more frequent.** On the phone at 4× the main thread now runs 59–60 frames a second in every daytime weather, where it ran 9–11. At dusk it runs 22 frames a second, where it ran 9.
- **The phone's clear day was repeated** because it sits within reach of the line: 43.9, 36.3 and 41.5 %. The hot day read 61.9, 65.3 and 69.0 %.
- **The hot day's compositor load was not the haze.** It was the invisible fireflies and smoke animating inside the filtered ground group: every frame they changed the group's content and made the filter run again over the whole ground. With them out of the tree by day (candidate 1 alone), the phone's GPU compositor thread on the hot day went from 88 to 22 %. The desktop's hot-day frames, baseline against final, went from 119 to 30 ms apart. Turning the haze off altogether takes the phone to 17 %.
- **The desktop is now held back by its compositor, not by the scene.** The desktop's compositor thread is 91–98 % busy in every weather: the glass's backdrop blur under software compositing, with the user list open. Its frames come 28–45 ms apart. That needs a device with a GPU to judge.
- **The hidden page still does no work**, on both layouts: 49 of 49 SVGs paused, no CSS animation running, and no call into the scene's script over a 10 s trace that crosses its minute. The one timer in the phone's hidden trace is the app's own (`helpers/expirySweep.ts`).

**The fallback stays.** It was re-decided by its own rule with the blur and the day's brightening back, reverted locally on the phone at 4×. Busy was clear 43.1 %, rain 90.0 %, heat 66.7 % and dusk 99.0 %, with frames 16.7 ms apart in all four. Rain, heat and dusk are over 50 %, so the fallback holds. Its show-through question (above) is still open.

**Proof that nothing changed on screen.** The scene was shot alone, with every CSS animation paused at the same `currentTime` and every SVG at the same `setCurrentTime`. That covers ten moments (every weather here, dawn, a hot evening and night, a May noon) at two animation times each, on both layouts.

- **Candidate 3 against candidate 1:** identical.
- **Candidate 1 against the baseline:** the same drawing. Without the invisible animations beside them, the yurt, the flowers, the moon's halo and the hazed land are drawn on different compositor layers, which rounds their edges differently: up to 8 levels on a few thousand pixels, and up to 71 levels on 300 pixels of hazed land. With every static object pinned to a layer of its own in both builds, the difference goes to 0 on the desktop and to the base's own noise (2 pixels at 1 level) on the phone.
- **The fades:** sampled at each window's edge, they run the same curves before and after (for example the skeins at 0.30, 0.80, 0.99 and 1 at 0.3, 0.7, 1.2 and 2.5 s). A layer goes only once it has reached 0.

**Tested and not made:**

- **Moving each SMIL element out of the element it animates** (targeting it by `href`) saves about 8 % of a dusk frame.
- **Moving the blades' sway onto the SVG element**, where the compositor could run it, saves nothing: every animation is restyled each frame anyway. It also moves pixels by up to 6 levels.
- **Registering the per-element variables with `@property`** made each element slower.
- **Writing the timing values inline** (above) saves within the noise.

**What is left, and only a visible change would take it.** Measured on the phone at 4× after Task 8b, as ms per main frame, against 7.4 for a clear day and 45.6 for dusk:

- **The skeins:** 29 of the 45.6 ms at dusk. Most of it is the wingbeats: with the wings held still and the birds still flying, a dusk frame is 23.0 ms. Even with no skeins at all, dusk is 17 ms (95 %).
- **The fireflies:** 6 ms at dusk.
- **The stars' twinkling:** 3 ms at dusk.
- **The rain:** half the drops and seeds would take rain from 13.5 to 10.7 ms (63 %).
- **By day:** the blades' sway costs 1.0 ms and the sun's fire 0.8 ms. With everything that moves on the main thread by day held still (the fire, the rays, the blades, the buzzard, the larks), a clear day would be 1.8 ms (11 %).

None of these has been made. They are the user's call.

#### Task 8c: the phone's overlays keep their glass (2026-09-26)

**The open drawer and the user list laid over the chat have their glass back on the phone. The header, the composer and the chips keep the fallback.** The show-through above was the overlays', and every trace behind the fallback was taken with both closed. The fallback's measured saving is therefore the always-on glass's; an overlay is open for moments.

- **Shown, they carry the glass's filter again**, brightened by day. The selectors are `#viewport.menu-open #sidebar` and `#viewport.menu-dragging #sidebar` (the drawer on screen, open or following a swipe: `style.css`'s own pair), and `#viewport.userlist-open #chat .userlist` (on the phone the list is only displayed laid over the chat).
- **Both take the chips' tint in every state**, as at 8077585b: `--ps-g-tint-float`, falling back to `--ps-g-tint-a`. A tint that changed on opening would ease over `--ps-flip` while the drawer slid in.
- **Put away, they carry no filter.** The drawer waits off screen, and the list is not displayed. On closing, the blur goes at the start of the drawer's 160 ms slide out.
- **Reduced transparency names the state selectors itself**, since they outrank its bare ones. `test/themes/ps.ts` holds that, as well as the tint, the filter, the header, composer and chips keeping the fallback, and that no other rule on the phone blurs or reads a scene tint.

**The gate: the frame interval with the drawer open. It holds.**

- **The method** is §10.1's, on the phone at 4×.
- **The runs.** The drawer was open for the whole 10 s trace, at dusk and in rain, the two heaviest weathers after Task 8b. The opening itself was traced three times per weather, in 1 s windows around a touch tap on the header's menu button. Mark to mark, the windows ran 1.4–1.9 s, because each includes the tap's round trip.
- **The builds.** Both sides were one production build: "unblurred" is it with 7b4b521a's `ps.css` (the fallback's drawer), and "blurred" is the shipped one. Each run checked the drawer's computed filter.
- **These traces ran at `nice 19`**, as Task 8's did and 8b's did not. Both sides ran the same way.

| Run            | Drawer    | Frame mean / p95 / max (ms)       | Frames drawn /s | Dropped (10 s or window) | Viz %     | Busy %    |
| -------------- | --------- | --------------------------------- | --------------: | -----------------------: | --------- | --------- |
| dusk, open     | unblurred | 16.7 / 30.8 / 32.3                |            59.9 |                        0 | 35.8      | 98.9      |
| dusk, open     | blurred   | 16.8 / 29.1 / 53.5                |            59.5 |                        5 | 92.4      | 98.7      |
| rain, open     | unblurred | 16.7 / 21.3 / 28.3                |            60.0 |                        0 | 53.4      | 93.0      |
| rain, open     | blurred   | 19.5 / 27.6 / 36.8                |            51.3 |                       91 | 94.9      | 82.6      |
| dusk, tap (×3) | unblurred | 16.7–16.8 / 30.7–31.3 / 31.6–33.0 |       59.8–60.3 |                      0–1 | 32.9–40.1 | 98.0–98.8 |
| dusk, tap (×3) | blurred   | 16.7–16.9 / 29.3–31.1 / 31.8–44.5 |       59.6–60.0 |                      0–2 | 61.9–63.8 | 98.3–99.0 |
| rain, tap (×3) | unblurred | 16.7–16.8 / 22.3–24.6 / 26.6–29.3 |       59.6–60.0 |                      0–1 | 51.7–54.3 | 93.0–96.5 |
| rain, tap (×3) | blurred   | 17.9–18.5 / 24.1–27.8 / 31.8–38.9 |       54.0–55.8 |                      7–9 | 75.0–78.4 | 86.5–93.2 |

- **The mean frame interval is 16.7–19.5 ms blurred**, against the 33 ms threshold. An earlier build, which differed only in the put-away drawer's tint, read 16.9 and 18.6 ms open, and 16.8 and 17.5–18.8 ms on the taps.
- **The cost falls on the compositor.** With the drawer open and blurred, the GPU process's compositor thread is 92–95 % busy, against 36–53 % unblurred. In rain it draws 51 frames a second instead of 60 (91 dropped in 10 s), and the longest gap between frames grows from 28 to 37 ms. At dusk it grows from 32 to 54 ms.
- **The main thread is not charged.** In rain it is less busy with the blur, because it waits on frames.
- **This is software compositing** on a shared Xeon, at DPR 1: the blur is rasterised on the CPU here, where a phone's GPU would do it. Read the relative cost, not the absolute one.

**The show-through, measured in pixels.**

- **Method.** Task 8 modelled it; this measures it.
  - The overlay was opened over a busy `#seance` (55 messages), and its own contents hidden (`visibility`, so its glass stays).
  - The soft ink's contrast was read against every pixel of the overlay in the message band, below the header and above the composer. That was done with the conversation behind it, with its marker labels hidden, and with all of it hidden.
  - The unblurred side reproduces Task 8's model exactly (4.06 by day, 4.45 at night), which checks the method.
- **Moments.**
  - 1 January at 08:45: the year's lowest day float tint (0.52), with snow and ink words.
  - A clear noon on 25 September: tint 0.60, the commonest, with light words.
  - 22:05 that night.

| Moment            | Overlay | Unblurred: min, pixels under 4.5 | Blurred: min, pixels under 4.5 | Blurred, marker labels hidden |
| ----------------- | ------- | -------------------------------- | ------------------------------ | ----------------------------- |
| lowest float, ink | drawer  | 4.37, 10,502                     | 5.70, 0                        | 5.71                          |
| lowest float, ink | list    | 4.37, 2,828                      | 5.37, 0                        | 5.37                          |
| clear noon, light | drawer  | 4.06, 25,271                     | 4.29, 1,952                    | 4.60                          |
| clear noon, light | list    | 4.06, 9,733                      | 4.34, 1,064                    | 4.55                          |
| night             | drawer  | 4.45, 1,443                      | 6.59, 0                        | 6.57                          |
| night             | list    | 4.45, 1,669                      | 7.30, 0                        | 7.30                          |

- **The words are blurred away.** The soft ink reads 4.55 or more over them in every case.
- **What the blur cannot take away is an opaque box larger than itself.** The column draws three kinds:
  - the "New messages" and date labels, whose ground is the column's `--window-bg-color`: the night solid `#121827` under the light treatment, 20 px tall;
  - code boxes: `--ps-code-bg`, `#121827` under the light treatment;
  - media thumbnails, up to 104 × 58 px on the phone.
- **The label is partly dissolved**: 4.29 and 4.34 at noon, the only pixels under the floor in the table.
- **A code box and a black thumbnail are not.** Injected under the drawer at the same noon (275 × 70 and 104 × 58 px), they read 2.80 and 2.42 at their centres. The unblurred fallback reads 4.28 and 4.06 over the same boxes.
- **Why.** The chips' tint (0.52–0.62 by day) was solved over the scene's grounds, not over the conversation's content. It lets 38–48 % of a dark box through, where the fallback's 0.78 let 22 % through.
- **No tint under the 0.78 cap holds 4.5 over them.** With the blur and the brightening, a code box needs 0.795 and a black box 0.82. The label alone needs 0.64.
- **The same overlays at 0.78 with the blur** would read, modelled from the measured pixels: 5.55 over the words, 5.35 over the label, 4.36 over a code box and 4.06 over a black thumbnail. That is at or above the fallback everywhere.
- **Which of these ships is the user's call (§11, rule 3):** the chips' tint as now, 0.78 with the blur, or solid overlays.

**In the browser.** `tools/scenarios/theme-ps.mjs` checks three things on the phone:

- at noon, the open drawer and the overlaid user list are glass, blurred and brightened, at the tint the scene publishes;
- at 22:00, the open drawer is blurred night glass at 74 %, not brightened;
- the header and the composer stay the unblurred 78 % tint.

Against the unblurred build the three overlay checks failed, and nothing else new did. Against the shipped build they pass. The run's other 13 failures are the stale checks Task 9 fixes: the SVG clock and layer counts, ink text at noon, and the settle animation.

## 11. Legibility floors

Held at **every sampled minute of every season and every weather** (what is sampled, below), and checked in mocha from the palette module:

- text ≥ 4.5 : 1, faint text ≥ 3 : 1, and the marks that have to read (an icon, a chip's focus border) ≥ 3 : 1, against their **effective ground**. Three exceptions, each deliberate:
  - under the light treatment the column's 32 nick colours are held at 3 : 1 as WCAG large text at the default font-size step and above, and at 4.5 : 1 over the sky below it (the user's names-large, §2, §7);
  - the open row's marker has no mark floor: it is a redundant cue beside the selected wash and the full ink;
  - a badge is text on a fill: its white numeral holds 4.5 : 1 on the fill, and the fill has no mark floor of its own;
- on glass: the glass tint composited over every checked ground that can sit behind that panel at that minute, and under each wash the glass draws; the backdrop blur is left out, since it only averages neighbouring grounds;
- on the solid panels: the solid colour, and the field and the mention wash drawn on it;
- over the open scene: every checked ground of that minute (a full scrollback covers the whole column), composited with the treatment's own layer at strength α. Ink text is measured against the halo, and light text against the dark shadow and outline. Each treatment has its own α, measured from rendered pixels (below); the check uses whichever is lower, 0.6 or the measured value, so calibration can only make it stricter;
- in the column's code boxes: the box's own opaque colour (§7).

**The checked grounds** are what the scene paints today: the sky (its top, middle and horizon colours) and the two bodies, the moon's disc and the sun's core, each composited at the opacity the scene draws it, the disc counted whatever the moon's phase. The land and the weather veil are not among them, because the scene paints neither yet. Plan 3 adds them back when it draws them, and designs the land under the message column with the words in mind: over the storm-veiled near grass, dark day ink reads 3.17 : 1 at the measured α. The sun and the moon are never dimmed or shrunk to make a floor; the text treatments carry the strain.

**When a spec colour misses its floor**, the fixes are pre-ruled, least visible first:

1. the glass tint's opacity rises from the spec's in steps of 0.01, up to a cap: day 0.62 to at most 0.78, night 0.58 to at most 0.74;
2. **rule 2**: a secondary colour (a soft or faint ink, a secondary taken from creama or coffee) moves in OKLCH lightness, keeping its hue and chroma, by the smallest amount that clears its floor, at most 0.08;
3. anything beyond that (a primary ink, a move over 0.08, a cap reached with the floor still failing) is the user's call, shown a measured before and after first.

The generator applies the first two itself and throws on the third, and `test/scenes/ps/legibility.ts` holds its rule-2 moves (the glass's soft inks and the column's faint ink) within 0.08 of the spec's. What moved is in §6 and §7.

**α, measured (2026-09-24).** `tools/ps/calibrate.mjs`, a `browser-drive` scenario run against a production build, reads both treatments off a real message (`text-shadow`, font and colour, with `data-ps-text` forced and `--ps-halo` at `#ebf5fd`) and draws them on flat swatches of 360 × 48 CSS px in headless Chromium, at the default font-size step and at device scale factors 1, 2 and 3 (a phone): Mulish 500 and Fraunces 700 at 20 px, white with the shadow over the dusk amber, the moon's disc, the sun's core, snow, sky and grass, and `#1b2638` with the halo over sky, grass and amber (over snow the halo is too close to its ground to measure). A twin swatch with magenta text locates every pixel the glyphs paint. Each pixel one CSS px out from them is projected onto the line from its ground towards the treatment's colour, and a swatch's figure is the 10th percentile of that strength over its ring. The lowest swatch counts.

A first pass, at DPR 1 and 2 only, measured the shadow alone (no outline) at 0.1099 — far too weak to carry white text over the brightest grounds (the moon's disc, the sun's low core, a bright dawn or dusk horizon). Shown three measured candidates, the user chose **"B"** (https://claude.ai/artifact/TGGrXDMs2fxLrV9NekKMWJ: "go with B"): an eight-way 1 px outline at 78 % black, drawn under the soft shadow (§7). Measured again with DPR 3 added and B in place of the shadow alone: **the halo 0.2120** (Mulish at DPR 3 over amber; median 0.40 — DPR 3 turned up a slightly lower minimum for the halo too, though the ink treatment itself did not change) and **the shadow 0.5457** (Mulish at DPR 1 over the sun's core; median 0.87 — the outline more than quadruples the shadow's floor). `tools/ps/legibility.ts` records them rounded down, as `ALPHA_HALO` = 0.2119 and `ALPHA_SHADOW` = 0.5457, each written `Math.min(0.6, …)`. The figures hardly move with the ground (every ground reads within about 0.01–0.02 of the others). At these strengths white holds its floor over the discs as well (4.74 : 1 at worst, over the low sun's core; white at 80 %, 3.69 : 1 against its 3 : 1), and the day ink `#1b2638` clears its floor on the bare sky, narrowly: 4.749 : 1 at worst, over the sky-top `#547bc1` of a January late afternoon. Headless Chromium antialiases text in grayscale, so this is a proxy: subpixel antialiasing on a real screen colours the glyph's edge pixels differently.

The full browser check (plan 4) is also to sample rendered glyphs against their surrounding pixels at noon, golden hour, sunset, dusk, midnight and first light, in summer and in snowy winter, because dusk is where a palette that is fine at both ends goes wrong.

**What is sampled.** Moments, not a continuum: a floor is held at the samples, and nothing measures between them (`SAMPLING` in `tools/ps/legibility.ts`). The generator solves over the **dense** sweep: every day of the year, every 5 minutes, all six weathers, about 630,000 moments, in about a minute. The floors test holds the blocks over the **sparse** sweep, a subset of it (every 7th day from 1 January plus `DOYS`, the season anchors, solstices and equinoxes; every 10 minutes; all six weathers; about 50,000 moments), and over every moment a block header names. The worst grounds, as the headers print them:

- ink by day, through the halo: `#7890c1`, 8 January at 16:10, clear, over the sky-top `#547bc1`;
- light text, through the shadow and outline: `#747370`, 1 January at 07:40, the sun's core at full strength over the middle sky — counted though the sun is just under the horizon line, since with no land drawn yet nothing hides it — and then the full moon's disc at midnight (`#73726d`);
- the day glass: `#d1d1d8`, 2 January at 17:00, clear, the dusk sky-top `#2c3a76` behind 78 % glass;
- the night glass: `#4b4f58`, the same low sun behind 74 % glass, and then the full moon (`#4b4e56`).

Two moments are pinned by name, and the floors test checks the glass ink and soft ink at both: **dusk**, the darkest moment still under day glass (31 May at 20:15, darkness 0.49992), and **the moon**, its disc at full strength behind night glass (1 January at midnight). `npx tsx tools/ps/palette-blocks.ts` prints all of it; regenerating after a table change in `palette.ts` or `engine.ts` finds the new worst grounds by itself.

## 12. Verification

- **mocha**: the engine (sunrise and sunset against known values at 45° N, the canonical mapping continuous across a whole day, season weights summing to 1, weather deterministic per day with the stated odds over a long run, moon elongation against known new and full moons, a new moon hiding the moon), the palette (continuity at every stop, the contrast floors of §11 across minutes × seasons × weathers), both generated blocks and every nick sweep against their floors, the rule-2 bound (`test/scenes/ps/legibility.ts`), and `test/themes/ps.ts` (the fallback daylight palette is defined outside any state selector, both chrome palettes, the glass and solid surfaces, the chrome's floors on every ground it draws on, the washes' visibility, the animal off-switch, no glitter, the fonts).
- **Browser** (`tools/scenarios/theme-ps.mjs`, extended):
  - the scene mounts only under `ps` and is gone after switching theme;
  - no animal file is fetched;
  - all nine font files load and Chromium draws in them, a Latin Extended name and line and a Vietnamese name included (plan 2);
  - the chrome is glass at noon and at night, solid under reduced transparency, and `#status-bar-tint` never blurs (plan 2);
  - `theme-color` follows the sky, is coffee's own after a switch to coffee, and follows the sky again after the switch back (plan 2);
  - on a phone at night the open drawer is glass, above its scrim (plan 2);
  - screenshots across a day, read by a person;
  - the glyph contrast samples;
  - a query is frosted with zero running animations;
  - under RTL the yurt is in the far third;
  - the yurt is never caught between places across a move;
  - reduced motion leaves no running scene animations and keeps the right colours;
  - a hidden page pauses the scene;
  - `#status-bar-tint` paints the sky colour;
  - a failed scene chunk still leaves the daylight fallback.
- **On a real iPhone**, once, after plan 2: the status bar takes the sky colour at two times of day, installed fresh from the home screen. This is the one check the scenario cannot make. Plan 2 has landed, and this check is **still to do**: it is the user's, on a device.

## 13. Plans

One spec, four plans, each shippable on its own:

1. **The seam.** The hook, the empty mount element and the scene chunk. The engine and palette modules with their tests. A minimal scene (sky, sun, moon, stars) driven by the real clock. `data-ps-light`, `data-ps-text` and `--ps-halo` published. The daylight fallback. This proves the risky parts end to end before any detail is drawn.
2. **The chrome.** Glass over the scene: both palettes, the nick sweeps and the contrast floors in mocha for glass surfaces (landed for the message column in plan 1 — §7, §11), the shadow-safe clipping everywhere else text is clipped (channel names), Mulish and Fraunces, and the α calibration. (The two text treatments and `--canvas-bg-color` by the hour also landed in plan 1 — §3, §7.)
3. **The plains.** Land, river, yurt (placement and fade), smoke, grass, clouds, fireflies, birds, weather, seasons, plus the performance rules and the measured budget. (The animal layer and its off switch landed early, in plan 1 — §5.6.)
4. **The rest.** Embers, the frosted still private view, right-to-left, reduced motion's remaining stand-down (§9: clouds, grass, weather particles and embers, once they exist), the full browser check, and the documentation (`docs/resources/themes.md`, `CLAUDE.md`). (A hidden page pausing the scene, and reduced motion stopping every scene animation plan 1 built — stars twinkling, the sun's fire and rays — landed early, in plan 1; the message fade-in, chrome rise and mention glow already stood down before plan 1, from the groundwork.)

**Plan 1, landed 2026-09-24** (the plan-1 commits — the same span the status line above names by subject): everything the seam promised, built to the letter — the hook (`client/js/themeScene.ts`), the engine and palette (`client/js/scenes/ps/{engine,colour,palette}.ts`), a minimal scene (sky, sun, moon, stars) on the real clock, `data-ps-light`/`data-ps-text`/`--ps-halo`/`--canvas-bg-color` published, the scene stopping outright while the page is hidden and picking back up when it returns, the same stop under reduced motion, and the daylight fallback for a chunk that never loads.

**One scope move, out of plan 2.** Clearing the old meadow for the scene left the message column's text sitting straight on open sky, day and night, with none of plan 2's glass between them yet — the spec's own colours went dark ink on a dark night sky. A plan has to ship legible on its own, so plan 1 also carries: the message column's own palette (§7) and both its text treatments, both generated nick sweeps for that column, the nick column's shadow-safe clipping, and the contrast floors in mocha (§11) that hold all of it there. The rest stayed plan 2's, and landed with it (below).

**How plan 1 was checked.** `tools/scenarios/theme-ps.mjs` ran 64 checks against a production build: the scene mounts only under `ps` (sky, stars, sun, moon), the four published values at noon, night and dusk, a hidden page stopping the scene (and staying stopped under reduced motion), the view following the open conversation, a theme switch mounting and unmounting cleanly (including one applied while the page is hidden), and the daylight fallback when the scene chunk is blocked. It was watched failing twice on purpose: hiding `#theme-scene` outright dropped it to 57 of 64, and repainting an animal plus reviving the old glitter rule dropped it to 51 of 64.

**Plan 2, landed 2026-09-25** (the span the status line above names by subject): everything the chrome promised.

- **Mulish and Fraunces** (§8), with `tools/ps/fetch-fonts.mjs`.
- **The treatments' strength measured from rendered pixels** (`tools/ps/calibrate.mjs`, §11), and the subtitle outline the measurement led to (§7, the user's "B").
- **The legibility model and its generator** (`tools/ps/legibility.ts`, `tools/ps/palette-blocks.ts`, which was `tools/ps/message-palette.ts` in plan 1): the bodies among the checked grounds; the glass as a surface of its own; every nick sweep from one table of hues; the user's names-large set for the light nicks, with the sky set below the default font-size step; the column's code boxes on their own surface; links underlined once the words turn white (§7, §11).
- **The glass and the solid panels** (§6): both palettes, the solved opacities and the rule-2 moves, the text accent, one badge, the washes moving away from the text, the phone's drawer over the plains rather than its scrim, the user list keeping its blur while a network is down, reduced transparency, and `theme-color` by the hour.
- **The shadow-safe clipping everywhere else**: nothing further to build. The glass draws no text shadow, and the one clipped text that carries a shadow, the nick column, was done in plan 1.

**Known items handed to plan 2, and how each was settled:**

- **The α calibration.** Plan 1's model ran both treatments at α = 0.6, a guess. Measured from rendered glyphs at DPR 1 to 3 (§11): the halo 0.2119, and the shadow with the outline 0.5457. Both are under the guess, so the floors got stricter, as they only ever could.
- **The bodies.** The moon's disc and the low sun's core were not among plan 1's grounds, and the light sweep dipped to about 4 : 1 over them. They are checked grounds now (§11), and the calibration drew over both, at DPR 3 for a phone too. White with the outline holds 4.5 : 1 over them, every other coloured light word 4.5 : 1, and the names 3 : 1 as large text (names-large). The glass is held over them as well: the full moon is the night glass's second-worst ground. Neither body was dimmed or shrunk.
- **Dusk.** Plan 1's pastel semantic colours (notice, link, action, the reply quote) read soft over the bright amber lower sky. Held at 4.5 : 1 over the sky and the discs through the measured shadow and outline, every coloured word under the light treatment is now nearly white, and links are underlined in their place (§7). Only the nicks keep their hues, at 3 : 1. The chrome at dusk is held at a pinned moment, the darkest still under day glass (§11).
- **Faint ink.** `#4c5a72` fell to 2.995 : 1 on a day plan 1 did not sample. The generator now samples every day, and on the bare sky the spec's colour reads 2.18 : 1; rule 2 moved it `#4c5a72` → `#38455c` (OKLCH L −0.076), which reads 3.02 : 1 there (§7).
- **The generated ink's margin.** It held at 4.534 : 1 on a denser sweep than the one it was solved on. The generator now solves over the dense sweep itself, every day and every 5 minutes, and the test's sparse sweep is a subset of it (§11).
- **The chrome at night.** The night glass (§6).
- **The model's docstring.** `tools/ps/legibility.ts` claimed "every effective ground a message can meet". It now names what is sampled (`SAMPLING`: the days, the minute step, the weathers) and says a floor is held at those samples, with nothing measured between them.
- **The floors test's blind spots.** It carried the mention rows' washes as hard-coded copies and knew the generated block's rules by name only. It now reads the washes from `ps.css`, reads every declaration of both blocks in the forms they hold, fails on anything it cannot read, and counts them.
- **The reaction row's "+"** is drawn at full strength. It is not glass: the glass rule leaves out the "+" and the viewer's own pressed chip, which keep their own tints. It draws in the column's muted colour under the column's shadow and outline, and `style.css`'s 55 % opacity left that near 2 : 1 over the plains (2.33 at worst by day, 2.21 over the moon), so `ps.css` lifts it to 1: the "+" is the chip's only label, and it now holds 4.5 over every checked ground (4.65 at worst by day, 5.05 while the light changes and at night, 5.18 over the moon). Hovering still turns it from the muted colour to the body colour. The floors test holds it.

**How plan 2 was checked.** `tools/scenarios/theme-ps.mjs` grew from 64 checks to 102, against a production build: all six font files loaded, and which fonts Chromium drew in (an italic hostmask, a Latin Extended realname and line, a Latin Extended query name); the sidebar, header, user list and composer as glass at noon (the day tint at 78 %, the blur) and at 22:00 (the night tint at 74 %); `#status-bar-tint` never blurred; the send glyph in the text accent by day and at night; the night soft and full inks in the sidebar; reduced transparency turning the glass solid, and the glass coming back when it is lifted; `theme-color` following the sky through a switch to coffee and back; and a phone's open drawer at night being glass, above its scrim. It was watched failing: with `#sidebar{backdrop-filter:none!important}` appended to the served stylesheet it dropped to 98 of 102, on exactly the sidebar's glass checks. In mocha, `test/scenes/ps/legibility.ts` holds both generated blocks over the sparse sweep and the pinned moments, and the rule-2 bound, for the generated colours and for the six the chrome moved by hand (night `--event-quit` exempt by the user's decision 2A); `test/themes/ps.ts` holds both chrome palettes, the glass and solid surfaces, the chrome's floors on every ground it draws on (the sparse sweep and the pinned moments too), the washes' visibility, the badge, the scrim, the fade and the fonts. The final fix wave (2026-09-25) added the Vietnamese subset, and the browser check its three files and three renderings: 108 checks, all passing.

**Handed on:**

- **The iPhone status-bar check** (§6, §12): still the user's to do, on a device.
- **The land and the weather veil** join the checked grounds when plan 3 draws them, and plan 3 designs the land under the message column with its words in mind (§11).
- **The low sun counted under the horizon line** is the worst ground for the light treatment and the night glass alike (§11), because with no land drawn nothing hides it. Plan 3's land ends that.
- **The phone's blur fallback** (§10) waits for plan 3's measured budget. (Plan 3 measured it, and the fallback applies: §10. Task 8b re-measured it once the scene's own cost came down, and it still applies: §10.1, "After Task 8b". Task 8c took the open drawer and the overlaid user list out of it: §10.1, "Task 8c".)

## 14. The groundwork (done 2026-09-24)

`ps` is a fork of the `<3` theme ("ps <3", `heart`), whose design record stays in `docs/projects/heart-theme.md`.

The user's request:

> fork this branch into theme-ps, call the theme ps, inside this fork rename the theme so that there is no longer a ps <3. disable but don't remove the animals walking across [...] I'd like to remove the glitter animations and effects for something more elegant and beautiful, soothing and warm. the essence of this theme is peace on the plains

What the groundwork did:

- **Renamed.** The theme's id is `ps` and its display name is `ps` (`client/js/configuration.ts`). No `ps <3` is left anywhere a user can see it. The stylesheet is `client/themes/ps.css`, and its fonts, licences and animal files are in `client/themes/ps/`. Both were moved with `git mv`, and the bytes are unchanged: `node tools/heart/generate.mjs` regenerates the SVGs into the new folder with no diff. The custom properties are `--ps-*`, the keyframes are `ps-*`, the test is `test/themes/ps.ts` and the browser check is `tools/scenarios/theme-ps.mjs`. The generator in `tools/heart/` and its tests in `test/tools/heart/` keep their historical names, but everything they read and write points at `client/themes/ps/` and `client/themes/ps.css`.
- **Animals off, not removed.** One commented block after the scene rules sets `--ps-slot-a`, `-b` and `-f` to `none` in every scene. Deleting the block brings the animals back. `test/themes/ps.ts` checks that the block is there once, after every scene, covers all three slots, and that nothing after it refills a slot. The scenario checks in a real browser that **no** animal file is fetched: not in `#seance`, not in a second scene, and not under emulated reduced motion. A control makes sure Resource Timing is recording the theme's own stylesheet and fonts, so an empty list is evidence and not a blind spot. (Plan 1 moved this switch into the new scene's animal layer, `#theme-scene .ps-animals`, §5.6, done 2026-09-24; the layer already carries its fixed cast — horse, bunny, a deer far off, sized from `--strip` — and the off block sits right after it. What plan 3 still owes is the ground band it sits on: no land is drawn under it yet.)
- **Glitter out.** From the stylesheet only: the four burst token sets and their heart and star icons, the sparkle keyframes, the send burst on `.msg.self:last-child` and the text-column offsets it hung off, the reaction burst, and `heart-hold`. The reaction pop is `style.css`'s 160 ms `reaction-pop`, the same for every theme. The gentle motion stays: message fade-in, the chrome rising into place, the mention glow.

How it was checked:

- The regenerated animals had no diff against the moved files.
- The no-glitter assertions in `test/themes/ps.ts` were each run against the stylesheet from before the removal and failed there.
- `tools/scenarios/theme-ps.mjs` passed all 34 checks in Chromium on 2026-09-24, and was watched failing when an animal and a pseudo-element animation were injected. It now leaves the Settings modal through Done.

**A stored `heart` theme.** This build has no theme called `heart`. A browser that stored `theme: "heart"` requests `themes/heart.css` once (404, no console error), and then `boot.ts` stores `configuration.defaultTheme` (`coffee`, or the deploy's choice). Checked in Chromium. Mapping `heart` to `ps` would be a one-line alias in that fallback; it has not been added.
