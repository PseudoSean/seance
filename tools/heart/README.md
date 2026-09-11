# tools/heart — the `<3` theme's generator

The meadow's animals are silhouettes drawn by a rig and rendered into self-animating SVG
files that the theme paints as background layers (`docs/projects/heart-theme.md`). Nothing
here runs in the browser: the files under `client/themes/heart/` are committed, and this
directory is how they are made.

## Regenerate

    node tools/heart/generate.mjs            # every animal
    node tools/heart/generate.mjs puppy      # one

Read the audit it prints, look at the result, then commit the files. A problem in the audit
leaves the old files in place and exits 1.

## Look at it

    node tools/heart/contact-sheet.mjs puppy          # tmp/heart-puppy-sheet.png
    node tools/heart/contact-sheet.mjs puppy --times=0,5,11,16 --height=220

`contact-sheet.mjs` photographs one animal's visit through a real browser — twelve cells
across the window it is visible, each one a slot like the theme's over the theme's sky and
ground, the stage's background-position tracked so the animal is in the middle of its cell
rather than 1/24 of it — and stitches them into one PNG you can read pose by pose. Times are
seconds after the sequence's `first`, the same clock as the audit's `onStage` and `tExit`.
The animation is SMIL inside a `background-image` and cannot be seeked from outside, so the
tool reaches a time by waiting for it: a twelve-cell sheet takes about one visit (~40 s for
the puppy). Chromium is launched through `tools/browser-drive.mjs` and must be: a container's
64 MB `/dev/shm` kills the renderer on these layers without the `--disable-dev-shm-usage`
the driver passes. The audit says whether a rig is sound; the sheet is the only thing that
says whether the animal looks like the animal.

## The pipeline

1. **Rig** (`rigs/<animal>.mjs`): parts as paper.js paths in local coordinates under a tree
   of pivots, each node rotating on a channel; gaits as cyclic key tables per channel; poses
   and wobbles; a sequence of segments (a gait for n cycles, a blend into a gait, a pose
   with a blend and a hold, a wobble around a pose) with the frame rate per segment. The
   shapes and tables are the ones the mockups were approved with, moved here verbatim.
2. **Sample** (`lib/sampler.mjs`): the segments become a list of poses at their frame rates.
3. **Outline** (`lib/outline.mjs`): per stored frame, the near parts are united into one
   closed outline and each far leg into its own (paper.js boolean ops, no canvas), the
   outline is resampled from the rig's marker, rotated to line up with the previous frame,
   and its concave vertices — only those — are filleted, so joints soften and tips stay sharp.
   A gait stores one cycle; everything else stores every frame.
4. **Travel** (`lib/travel.mjs`): the lowest planted foot slides back by exactly what the body
   moves forward, so integrating its velocity gives a travel that never slips and a sit that
   never drifts. None of these animals ever walks backward on purpose, so a planted foot
   measured moving forward relative to the body — a touch-down mid-swing, common across a
   gait blend — clamps that frame's velocity at 0 rather than reading it as the body stepping
   back. Segments marked `turn` flip the facing. A segment may set `travel` to drive its own
   ground speed instead, when the rig's swing does not lift the feet clearly enough for the
   stance measurement to trust — the approved mockups' puppy and bunny don't — as a constant
   units/s, or `[from, to]` to ramp linearly across the segment's own span: clamping alone
   zeroes a gait blend's measured speed (the planted hoof swings forward there throughout),
   which read as the horse stalling for the length of every blend; the horse's own blends
   instead ramp between its two gaits' speeds, so it never stops or lurches at the switch. The
   audit still prints the measured stance speed beside whichever is actually applied (the
   ramp's own mean, for a ramp).
5. **Files** (`lib/svg.mjs`, `lib/build.mjs`): a wide stage (`sequence.stage.aspect` × the
   animal's height — sized so the visit actually crosses a wide chat rather than a slice of
   it: horse is aspect 16, puppy and bunny 24, since the small animals are half the horse's
   height and need the larger multiple to reach the same pixel width, about 1850 px at the
   theme's size), the animal starting flush with the stage's left edge; one `<path>` per
   outline, far legs first, each morphing through the clips (`<animate attributeName="d">`,
   integer relative coordinates) chained by syncbase timing so a gait repeats and the loop
   restarts after the off-stage gap; the travel as an animated translate — its own keyframes,
   independent of the outline's, from `travelCurve` (`lib/build.mjs`): a ramp segment is
   subdivided far finer than its own (cheap, low-fps) outline frames, since the translate
   costs nothing extra per sample and the outline costs bytes per frame, and every subdivided
   time is snapped to the same rounding precision (`TRAVEL_DECIMALS`, `lib/svg.mjs`) its
   position is computed against — skip that and a long loop period makes four decimals of a
   _fraction_ of it too coarse to tell two nearby frames' times apart, so a stored position
   pairs with a slightly different stored time than it was computed for and a velocity check
   reads a spurious jump that was never in the underlying motion; the turn as a
   discrete mirror about the animal's centre; the whole visit faded in over a second (or a
   quarter of the time on stage, if that is shorter) from the moment it appears, and faded out
   over the same span ending exactly when its box starts crossing the stage edge it leaves by
   (`tExit`, not the end of its time on stage — the sequence keeps sampling a little past
   that, and the animal keeps travelling on, invisibly, until the loop restarts) — so the
   animal never just appears, and is never visibly clipped at a stage edge inside the visible
   chat. Four files per animal: the near tint,
   the distant-visitor tint (`-far`), and a still of each for reduced motion. Durations are
   written to four decimals, so a chain of clips runs a few ten-thousandths of a second short
   of the loop's travel transform each period — about three seconds a week on a page left
   open, not worth twelve churned files.

## Rules a rig must keep

Learned the hard way in the mockups; the audit catches the symptoms, the rig author keeps
the causes out:

- every joint cap (disc) is larger than the piece it caps — coincident vertices break unions;
- every leg's top extends well inside the body at every pose; tail roots, far hips and the
  skull sit inside the body; the neck's base is a chord of a disc buried in the shoulder;
- far legs are 5 % shorter, slightly raised, barely set back, never below a near foot;
- folded limbs do not touch the belly or each other (an enclosed pocket changes the outline's
  topology; the outer boundary is kept, but a pocket that opens and closes jumps);
- feet carry a `foot` marker at the contact point, or the travel cannot see them.

## The audit

- zero union failures (a union that comes back bigger than its parts is retried with the
  pose nudged; four failures is a rig problem);
- the outline's length changes ≤ 5 % between stored frames (near), ≤ 10 % (a far leg).
  Current headroom: bunny near sits at 4.18 % of the 5 % limit, puppy far at 6.96 % of the
  10 % limit — so a new rig tuned blind against the limits knows how much room there really is;
- the visit ends off-stage on either side, the off-stage gap is ≥ 2 s;
- sizes: each animated file (the near tint and the `-far` one, which is the same
  shape) within its rig's own `budget`, stills ≤ 8 KB. The cast's budgets, which
  are also the rows `test/tools/heart/files.ts` holds the committed files to:

  | Animal  | Each animated file | Files             |
  | ------- | ------------------ | ----------------- |
  | horse   | 200 KB             | 4                 |
  | puppy   | 160 KB             | 4                 |
  | bunny   | 160 KB             | 4                 |
  | deer    | 150 KB             | 4                 |
  | kitten  | 150 KB             | 4                 |
  | teddy   | 120 KB             | 4                 |
  | bird    | 120 KB             | 4                 |
  | frog    | 100 KB             | 4                 |
  | ladybug | 100 KB             | 4                 |
  | dolphin | 120 KB             | 2 (far tint only) |

  A rig sets its `budget` to its row; the audit refuses to write a file over it,
  and the test skips an animal's rows until its files exist;

- the clip chain's total duration (Σ `dur` × `repeat` over the segments) agrees with the
  sampled `onStage` within 5 ms — the two are built from the same rounded frame counts and
  should always match exactly; a mismatch would mean the shape morphs and the travel have
  drifted out of sync with each other, animating a pose that no longer lines up with where the
  animal has travelled to;
- every hold — a `pose` segment with `hold > 0`, or a `wobble` — applies under 5 units/s: a
  stopped, sitting, or turning animal must not travel, even a little. A hold's _measured_
  stance speed can read higher than that (a blend into the hold can register real but
  spurious foot movement mid-transition); the fix is a `travel: 0` pin on that segment in the
  rig, not a change here — bunny's `crouch` needed exactly this (it measured ~5.3 units/s).

The per-segment speed the audit prints is never negative: a planted foot's measured velocity
is clamped at 0 (`lib/travel.mjs`), since none of these animals ever walks backward on purpose.

The audit also prints `tExit`, the sequence time its box starts crossing the stage edge it
leaves by (found by walking the travel back from the end, so the flush-left start at frame 0
is never mistaken for an exit) — that, not the end of its time on stage, is what the fade-out
in `lib/svg.mjs` is keyed to. If the exit condition is never found (it always should be, since
the exit rule above already guarantees the visit ends off-stage), `tExit` falls back to the
time on stage and the audit says so.

## Budget and browsers

Each near file is 100–200 KB uncompressed (gzip ≈ ¼ on the wire); the theme's directory
stays under 2.8 MB with the whole cast in it. That is not what a page downloads: a scene
casts three animals, and a `url()` sitting in a CSS custom property that no resolved
`background-image` substitutes is never fetched, so a page pulls three animal files out of
the directory however many are committed — the theme's browser scenario
(`tools/scenarios/theme-heart.mjs`) counts what one actually fetches. Chromium runs SMIL —
chained clips, additive transforms, path morphs — inside a CSS `background-image`
(`spike-svg-background/`). Firefox and Safari still need their rows in that spike's README
filled in.
