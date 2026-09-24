# The `ps` theme: peace on the plains

Date: 2026-09-24. Branch `theme-ps` (worktree `.claude/worktrees/theme-ps`), forked from `theme-heart` at `a64a16cb`.

Status: **design approved, not yet built.** The groundwork is done (§14): the fork is renamed, its animals are off and its glitter is gone. This document is the spec for the rest: the scene, the glass chrome, the type, the embers and the private view. The implementation plans are written from it (§13).

The design was drawn and decided with the user over nine rounds of a live mockup. Its approved state is kept in the repository at `docs/resources/themes/ps-plains/mockup.html` (the README beside it explains how to drive it), and was published as https://claude.ai/artifact/4n67vQ1gJtPyuHwf22HrGQ. **The mockup's window is the reference drawing for everything visual here.** Where this document and the mockup disagree, this document wins: it records decisions made after drawing, and it converts the mockup's px and page script into the repo's conventions.

## 0. For review: decisions the mockup did not show you

The mockup settled how the theme looks and behaves. Building it into the app needs these engineering calls too. None of them changes what you see, but each one is a real choice, so they are listed first.

1. **The scene is real page elements, loaded only for `ps`.** Every other theme is one CSS file, and so was the `<3` meadow: background images painted on the chat pane. The plains cannot be built that way. A background image cannot be recoloured by the hour, cannot carry its own filter (the fiery sun, the heat haze over the land and yurt together) and cannot host the birds' wingbeats. So the scene is SVG and HTML, as in the mockup, in its own script chunk that only `ps` loads. Other themes download nothing new.
2. **The app gains one small, theme-neutral hook** so a theme can bring a scene. The hook keeps a table of the themes that have one; when such a theme is applied, the app mounts its scene behind everything, and when the theme changes the scene is removed. Only `ps` has one.
3. **The colours of the day are computed in a TypeScript module, not in the stylesheet.** The `<3` plan kept every colour in CSS. Here that would mean 13 times of day × 4 seasons × 6 weathers of CSS rules. More importantly, a module lets the test suite check text contrast at every minute of every season, and the suite has no browser. The chrome's two palettes (day glass and night glass) stay in `ps.css`, where a person retinting the theme would look.
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
| Yurt motion      | never slides; fading is allowed                                          | "don't slide animate the yurt in and out - you can use fade, but not movement on it"                                                                      |
| Name shadows     | never clipped                                                            | "the drop shadows appear slightly cut off on the names in channel"                                                                                        |
| Type             | **Mulish** for the words, **Fraunces** for names and titles              | "use fraunces for the names", "change the message text to mulish"                                                                                         |
| Private messages | the plains behind **frosted glass**, **still**                           | "I love the frosted glass look", "it can stay still, it doesn't need to move"                                                                             |

Carried from the `<3` design (`docs/projects/heart-theme.md` §11–§13) and still binding: the scene follows the viewer's **local clock** through a small script hook; the **moon's phase is the true one**, and a **new moon is no moon**; at night **the whole interface goes dark**; private messages get a **plainer, still** background.

## 3. Architecture

```
client/js/themeScene.ts        theme-neutral hook: mount/unmount a theme's scene, tell it what is open
client/js/scenes/ps/engine.ts  Vue-free, DOM-free: date → everything the scene and the chrome need
client/js/scenes/ps/palette.ts Vue-free, DOM-free: the colour tables and their interpolation
client/js/scenes/ps/scene.ts   builds and updates the scene's elements (DOM, no Vue); its own chunk
client/themes/ps.css           the chrome, the type, the fallback daylight, the scene's static styling
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

- **The sun** rides one arc from the reading start (sunrise) to the reading end (sunset); it grows up to 45 % larger and warms from gold to deep orange as it nears the horizon. **The moon** rides the same arc through the night.
- **The moon's phase** is the true elongation: the moon's ecliptic longitude minus the sun's, with the six largest periodic terms (`heart-theme.md` §11.2b). Illumination is `(1 − cos D) / 2`. Drawn with three shapes (a dark disc, the lit half, one ellipse of horizontal radius `R · |cos D|`), mirrored when waning, northern-hemisphere orientation. **Within 9° of new, there is no moon at all**, and the night is darker and starrier for it.

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

Flocks cross by daylight in spring and autumn, and more rarely in winter, heading one way in spring and back in autumn; rain and storms thin them. Each bird is a side-on silhouette (a goose with its neck held straight out; a crane trailing its legs) whose near and far wings sweep through a real stroke: a quicker downstroke that lifts the body, an upstroke with the wrist bent, edge-on at mid-stroke. Every bird has its own beat, and cranes glide between bursts. Three skeins: a V of geese with uneven arms and a straggler, a slanting line of cranes, and a small, pale far skein. Each bird drifts about its place, and each skein rises, sinks and leans as it goes. The mockup's `bird()` is the reference, including its pose paths.

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

The sidebar, the channel header, the composer, the user list and the reaction chips are **tinted glass** over the scene: a translucent tint with a 10 px (rem-converted) backdrop blur and a hairline edge. The message list itself has no background; the words sit directly on the plains. Menus, the emoji picker, the upload preview, the settings pane and other modal surfaces are **solid** glass-coloured panels, because they hold dense text and controls.

Two palettes, both in `ps.css`, switched by `data-ps-light` with a 0.8 s transition:

| Token         | Day glass                | Night glass              |
| ------------- | ------------------------ | ------------------------ |
| glass tint    | `rgb(255 251 244 / 62%)` | `rgb(12 17 32 / 58%)`    |
| solid surface | `#fbf8f2`                | `#121827`                |
| ink           | `#1f2a3d`                | `#e9eef7`                |
| soft ink      | `#55627a`                | `#a7b3c8`                |
| edge          | `rgb(255 255 255 / 55%)` | `rgb(255 255 255 / 9%)`  |
| input field   | `rgb(255 255 255 / 72%)` | `rgb(255 255 255 / 7%)`  |
| selected row  | `rgb(255 255 255 / 60%)` | `rgb(255 255 255 / 11%)` |
| accent        | `#c2562b`                | `#d9784a`                |

Every coffee token the app reads (`--chat-*`, `--rail-*`, `--composer-*`, notice boxes, code tokens, scrollbars, focus ring) is defined for both, which makes the night palette a second full palette, not a tint pass (`heart-theme.md` §12).

**The iOS status bar** reads `#status-bar-tint`, which must paint and must not carry a backdrop filter (`CLAUDE.md`, "The iOS status bar"). Its colour and the page canvas's are `--canvas-bg-color`, which `ps` sets to the scene's sky-top colour of the hour, so the bar matches the sky under it. The scene's own element is a second candidate for iOS to sample: it is fixed, full width and flush with the top, and nothing documents which element iOS picks when two qualify. So:

- `#theme-scene` comes after `#status-bar-tint` in the document;
- its `background-color` is also `--canvas-bg-color`, with the sky gradient in `background-image` above it, so the bar is right whichever element iOS samples;
- this needs checking on a real device, with the icon removed and re-added (§12), because no scenario can prove it.

## 7. The words over the plains

Two treatments, switched by `data-ps-text`:

- **Ink**, in full daylight (darkness below 0.05): ink `#1b2638`, faint ink `#4c5a72`, with a close three-layer halo (6, 2 and 1 px, rem-converted) in `--ps-halo`, the horizon colour of the hour mixed 55 % toward white.
- **Light**, while the light changes and all night: white ink, faint ink white at 80 %, with a close three-layer dark shadow (`0 1px 1.5px` at 70 %, `0 0 3px` at 45 %, `0 1px 10px` at 35 % black).

Nick colours need two generated sweeps of the app's 32 (`.user.color-1` … `-32`): a dark sweep for ink text and for the day glass, and a light sweep for light text and for the night glass. Each surface picks the sweep for its own state, so at dusk a nick in the chat (light treatment) and the same nick in the user list (still day glass) can differ. The sweeps are generated by a script and checked in as values, with a warm-leaning hue spread like the mockup's four (rust, teal, violet, ochre).

**Shadows are never clipped.** Anything that clips its text for an ellipsis (the nick column, channel names) pads its clip box by the shadow's reach and takes the padding back with a negative margin, so nothing moves.

## 8. Type

- **Mulish**, weight 500, for everything read: messages, the sidebar, the composer, menus and settings. Bold is 800.
- **Fraunces**, weight 700, for the names the eye jumps to: nicks, channel and network names, the header title.

Both are bundled as Google Fonts' variable woff2 files in `client/themes/ps/` with their OFL licences, Latin plus Latin Extended, replacing the `<3` theme's Nunito and Baloo 2 (whose files leave this branch). Coverage is proved by rendering, not by FontFace status (the latin-ext subset trap). Fraunces has no Cyrillic or Greek, so names in those scripts fall back to the system serif; Mulish covers Cyrillic. The timestamp column widths in `style.css` are restated for Mulish's metrics, as the `<3` theme had to for Nunito.

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
- Backdrop blur only on the chrome's glass panels and chips, never on the scene or on `#status-bar-tint`.
- Under the phone layout (`PHONE_LAYOUT_QUERY`), particle counts are halved.

Budget: a plan task measures the idle cost of the scene in Chromium (a 10-second performance trace of a quiet channel at midday on a clear day and on a rainy one, desktop and phone layouts, with and without 4× CPU throttling) and records the numbers in this document as the baseline. If the phone layout measures badly, the **pre-decided fallback** is glass without backdrop blur on the phone layout, with the tint made more opaque to keep the contrast floors.

## 11. Legibility floors

Held at **every minute of every season and every weather**, and checked in mocha from the palette module:

- ink and every nick colour ≥ 4.5 : 1, faint ink ≥ 3 : 1, against their **effective ground**;
- on glass: the glass tint composited over the lightest and darkest scene colour that can sit behind that panel at that minute;
- over the open scene: every sky and land colour of that minute (a full scrollback covers the whole column), composited with the treatment's own layer at strength α. Ink text is measured against the halo, and light text against the dark shadow. α is 0.6 until a plan task calibrates it once from rendered pixels, by sampling the ring of pixels around real glyphs in Chromium screenshots, and records the measured value here. From then on the check uses whichever is lower, 0.6 or the measured value, so calibration can only make it stricter.

The browser check also samples rendered glyphs against their surrounding pixels at noon, golden hour, sunset, dusk, midnight and first light, in summer and in snowy winter, because dusk is where a palette that is fine at both ends goes wrong.

## 12. Verification

- **mocha**: the engine (sunrise and sunset against known values at 45° N, the canonical mapping continuous across a whole day, season weights summing to 1, weather deterministic per day with the stated odds over a long run, moon elongation against known new and full moons, a new moon hiding the moon), the palette (continuity at every stop, the contrast floors of §11 across minutes × seasons × weathers), both nick sweeps against their floors, and `test/themes/ps.ts` (the fallback daylight palette is defined outside any state selector, the animal off-switch, no glitter, the fonts).
- **Browser** (`tools/scenarios/theme-ps.mjs`, extended):
  - the scene mounts only under `ps` and is gone after switching theme;
  - no animal file is fetched;
  - screenshots across a day, read by a person;
  - the glyph contrast samples;
  - a query is frosted with zero running animations;
  - under RTL the yurt is in the far third;
  - the yurt is never caught between places across a move;
  - reduced motion leaves no running scene animations and keeps the right colours;
  - a hidden page pauses the scene;
  - `#status-bar-tint` paints the sky colour;
  - a failed scene chunk still leaves the daylight fallback.
- **On a real iPhone**, once, after plan 2: the status bar takes the sky colour at two times of day, installed fresh from the home screen. This is the one check the scenario cannot make.

## 13. Plans

One spec, four plans, each shippable on its own:

1. **The seam.** The hook, the empty mount element and the scene chunk. The engine and palette modules with their tests. A minimal scene (sky, sun, moon, stars) driven by the real clock. `data-ps-light`, `data-ps-text` and `--ps-halo` published. The daylight fallback. This proves the risky parts end to end before any detail is drawn.
2. **The chrome.** Glass over the scene: both palettes, the two text treatments, both nick sweeps, the shadow-safe clipping, Mulish and Fraunces, `--canvas-bg-color` by the hour, the contrast floors in mocha, and the α calibration.
3. **The plains.** Land, river, yurt (placement and fade), smoke, grass, clouds, fireflies, birds, weather, seasons and the animal layer with its off switch, plus the performance rules and the measured budget.
4. **The rest.** Embers, the frosted still private view, right-to-left, reduced motion, pausing when hidden, the full browser check, and the documentation (`docs/resources/themes.md`, `CLAUDE.md`).

## 14. The groundwork (done 2026-09-24)

`ps` is a fork of the `<3` theme ("ps <3", `heart`), whose design record stays in `docs/projects/heart-theme.md`.

The user's request:

> fork this branch into theme-ps, call the theme ps, inside this fork rename the theme so that there is no longer a ps <3. disable but don't remove the animals walking across [...] I'd like to remove the glitter animations and effects for something more elegant and beautiful, soothing and warm. the essence of this theme is peace on the plains

What the groundwork did:

- **Renamed.** The theme's id is `ps` and its display name is `ps` (`client/js/configuration.ts`). No `ps <3` is left anywhere a user can see it. The stylesheet is `client/themes/ps.css`, and its fonts, licences and animal files are in `client/themes/ps/`. Both were moved with `git mv`, and the bytes are unchanged: `node tools/heart/generate.mjs` regenerates the SVGs into the new folder with no diff. The custom properties are `--ps-*`, the keyframes are `ps-*`, the test is `test/themes/ps.ts` and the browser check is `tools/scenarios/theme-ps.mjs`. The generator in `tools/heart/` and its tests in `test/tools/heart/` keep their historical names, but everything they read and write points at `client/themes/ps/` and `client/themes/ps.css`.
- **Animals off, not removed.** One commented block after the scene rules sets `--ps-slot-a`, `-b` and `-f` to `none` in every scene. Deleting the block brings the animals back. `test/themes/ps.ts` checks that the block is there once, after every scene, covers all three slots, and that nothing after it refills a slot. The scenario checks in a real browser that **no** animal file is fetched: not in `#seance`, not in a second scene, and not under emulated reduced motion. A control makes sure Resource Timing is recording the theme's own stylesheet and fonts, so an empty list is evidence and not a blind spot. (Plan 3 moves this switch into the new scene's animal layer, §5.6.)
- **Glitter out.** From the stylesheet only: the four burst token sets and their heart and star icons, the sparkle keyframes, the send burst on `.msg.self:last-child` and the text-column offsets it hung off, the reaction burst, and `heart-hold`. The reaction pop is `style.css`'s 160 ms `reaction-pop`, the same for every theme. The gentle motion stays: message fade-in, the chrome rising into place, the mention glow.

How it was checked:

- The regenerated animals had no diff against the moved files.
- The no-glitter assertions in `test/themes/ps.ts` were each run against the stylesheet from before the removal and failed there.
- `tools/scenarios/theme-ps.mjs` passed all 34 checks in Chromium on 2026-09-24, and was watched failing when an animal and a pseudo-element animation were injected. It now leaves the Settings modal through Done.

**A stored `heart` theme.** This build has no theme called `heart`. A browser that stored `theme: "heart"` requests `themes/heart.css` once (404, no console error), and then `boot.ts` stores `configuration.defaultTheme` (`coffee`, or the deploy's choice). Checked in Chromium. Mapping `heart` to `ps` would be a one-line alias in that fallback; it has not been added.
