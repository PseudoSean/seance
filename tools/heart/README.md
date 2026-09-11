# tools/heart — the `<3` theme's generator

The meadow's animals are silhouettes drawn by a rig and rendered into self-animating SVG
files that the theme paints as background layers (`docs/projects/heart-theme.md`). Nothing
here runs in the browser: the files under `client/themes/heart/` are committed, and this
directory is how they are made.

## Regenerate

    node tools/heart/generate.mjs            # every animal
    node tools/heart/generate.mjs puppy      # one

Read the audit it prints, look at the result in a browser (a `tmp/` page with the file as a
`background-image`, or the theme itself), then commit the files. A problem in the audit
leaves the old files in place and exits 1.

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
   never drifts. Segments marked `turn` flip the facing. A segment may set `travel` (units/s)
   to drive its own ground speed instead, when the rig's swing does not lift the feet clearly
   enough for the stance measurement to trust — the approved mockups' puppy and bunny don't;
   the audit still prints the measured stance speed beside the one actually applied.
5. **Files** (`lib/svg.mjs`, `lib/build.mjs`): a wide stage (`sequence.stage.aspect` × the
   animal's height); one `<path>` per outline, far legs first, each morphing through the
   clips (`<animate attributeName="d">`, integer relative coordinates) chained by syncbase
   timing so a gait repeats and the loop restarts after the off-stage gap; the travel as an
   animated translate; the turn as a discrete mirror about the animal's centre. Four files
   per animal: the near tint, the distant-visitor tint (`-far`), and a still of each for
   reduced motion.

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
- the outline's length changes ≤ 5 % between stored frames (near), ≤ 10 % (a far leg);
- the visit ends off-stage on either side, the off-stage gap is ≥ 2 s;
- sizes: `horse.svg` ≤ 200 KB, `puppy.svg` and `bunny.svg` ≤ 160 KB, stills ≤ 8 KB.

## Budget and browsers

Each near file is 100–200 KB uncompressed (gzip ≈ ¼ on the wire); the theme's directory
stays under 1.3 MB. Chromium runs SMIL — chained clips, additive transforms, path morphs —
inside a CSS `background-image` (`spike-svg-background/`). Firefox and Safari still need
their rows in that spike's README filled in.
