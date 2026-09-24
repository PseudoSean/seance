# The `ps` theme

Date: 2026-09-24. Branch `theme-ps` (worktree `.claude/worktrees/theme-ps`), forked from `theme-heart` at `a64a16cb`. Status: the groundwork is done: the theme is renamed, its animals are off and its glitter is gone. The scene redesign has not started.

`ps` is a fork of the `<3` theme ("ps <3", `heart`), whose design record stays in `docs/projects/heart-theme.md`. Everything that doc says about the fonts, the tokens, the meadow's layers and the animal pipeline still describes this theme's code, with `heart` read as `ps`. This file records what the fork changed and what it is for.

## What the user asked for

> fork this branch into theme-ps, call the theme ps, inside this fork rename the theme so that there is no longer a ps <3. disable but don't remove the animals walking across [...] I'd like to remove the glitter animations and effects for something more elegant and beautiful, soothing and warm. the essence of this theme is peace on the plains

## What the groundwork did

- **Renamed.** The theme's id is `ps` and its display name is `ps` (`client/js/configuration.ts`). No `ps <3` is left anywhere a user can see it. The stylesheet is `client/themes/ps.css` and its fonts, licences and animal files are `client/themes/ps/`. Both were moved with `git mv`, and the bytes are unchanged: `node tools/heart/generate.mjs` regenerates the SVGs into the new folder with no diff. The custom properties are `--ps-*`, the keyframes are `ps-*`, the test is `test/themes/ps.ts` and the browser check is `tools/scenarios/theme-ps.mjs`. The generator in `tools/heart/` and its tests in `test/tools/heart/` keep their historical names, but everything they read and write points at `client/themes/ps/` and `client/themes/ps.css`.
- **Animals off, not removed.** Every rig, every file under `ps/` and the whole scene table stay. One commented block after the scene rules sets `--ps-slot-a`, `-b` and `-f` to `none` in every scene. It uses `#chat-container, #chat-container[data-scene]`, which ties with the scenes on specificity and wins by coming after them, and the bare selector also covers a conversation with no scene. Reduced motion repoints the animal tokens, never the slots, so no still is painted either. Deleting the block brings the animals back. `test/themes/ps.ts` checks that the block is there once, after every scene, and covers all three slots, and that nothing after it puts an animal back into a slot. The scenario checks in a real browser that **no** animal file is fetched: not in `#seance`, not in a second scene, and not under emulated reduced motion. A control makes sure Resource Timing is recording the theme's own stylesheet and fonts, so an empty list is evidence and not a blind spot.
- **Glitter out.** From the stylesheet only: the four burst token sets and their heart and star icons, the sparkle keyframes, the send burst on `.msg.self:last-child` and the text-column offsets it hung off, the reaction burst, and `heart-hold`, the do-nothing animation that kept Vue's enter class alive for the burst. `ps.css` no longer mentions `.reaction(s)-enter-active`, so the reaction pop is style.css's 160 ms `reaction-pop`, the same for every theme and already off under reduced motion. `MessageReactions.vue`'s transitions are untouched. The gentle motion stays: message fade-in, the chrome rising into place, and the mention glow.

## How it was checked

- `node tools/heart/generate.mjs` regenerated all eight animals into `client/themes/ps/`, and the result had no diff against the moved files.
- `test/themes/ps.ts` has new assertions for the no-glitter state. Each one was run against the stylesheet from before the removal and failed there.
- `tools/scenarios/theme-ps.mjs` ran in Chromium against a production build on 2026-09-24, on the dev ircd, with all 34 checks passing:
  - The theme list offers `ps` as "ps", and nothing in it is `heart` or "ps <3".
  - The meadow keeps its fourteen layers with every slot empty, and 0 of the 32 animal files it names were fetched in `#seance` (scene 3), in `#kittens` (scene 4), or under emulated reduced motion.
  - The echo of a send fades in, and a reaction pops in with `reaction-pop`. Neither starts any animation on a pseudo-element.
- The scenario was also watched failing. Two rules were appended to the served stylesheet: `#chat .header{background-image:var(--ps-horse)}` and a `::before` animation on `.msg.self:last-child`. The run reported `horse.svg` fetched in both scenes, `horse-still.svg horse.svg` under reduced motion, and a pseudo-element animation on the send, and exited non-zero.
- The scenario also had to learn to leave the Settings modal through Done, which develop introduced after the `<3` scenario was written. Before that fix it timed out before any theme check ran.

## What is next

The scene is being redesigned as **peace on the plains**: vivid plains, a yurt, and a sun and moon that follow the local clock. Nothing replaces the glitter yet. Whatever does (the brief says "more elegant and beautiful, soothing and warm") is the user's call, and so is the new scene. Until then, `ps` looks like `<3` without its visitors and its bursts.

## A stored `heart` theme

This build has no theme called `heart`, so a browser that stored `theme: "heart"` falls back to the default at boot, the same way browsers that had `default` stored came over to `coffee` (`client/js/boot.ts`):

1. `loading-error-handlers.js`, and after it the settings store, point the stylesheet link at `themes/heart.css`, which returns 404, so for a moment the page is unthemed.
2. `boot.ts` then finds no theme of that name and stores `configuration.defaultTheme` (`coffee`, or whatever the deploy's `config.json` names).

The user lands on coffee, not on `ps`, and the stored setting is rewritten. This was checked in Chromium: a profile seeded with `theme: "heart"` requested `themes/heart.css` once (404, no console error), ended on `themes/coffee.css` with `coffee` stored, and did not request `heart.css` again on the next load. Mapping `heart` to `ps` would be a one-line alias in that fallback, but it has not been added.
