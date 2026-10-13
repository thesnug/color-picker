# POD production-file approval

Use this branch for final local color approval that unattended POD will publish.
Source-file color screening is provisional until the native production files and
garment proofs exist. A larger source canvas or an earlier numerical pass never
approves the file POD subsequently enlarges or prepares.

## Prepare, review, continue

1. Resolve the accepted Product Recipe, its Version, placement, artwork options,
   intended colors, default, and target Stores. Start or resume one native
   Creative run with a color review stop. Prepare the full print canvas and each
   enabled native area/size geometry before final local color approval. Keep
   publication pending while that approval is required.
   Done: the same native Product and run have a completed proof packet and the
   Creative item is awaiting color review after independent final inspection.
2. Read `GET /api/creative-preparations/{id}/print-review` through the existing
   signed-in session or a read-scoped preparation credential. This endpoint is a
   read: it performs no preparation or publication. If the deployed POD does not
   expose it yet, report that production-file approval is unavailable and retain
   provisional status; source-file screening cannot substitute for it.
   Download the exact files at `review.files[].imageUrl`. Retain
   `review.packetHash`, `review.approval`, each native rendition identity and
   checksum, requirements, content bounds, garment hex, and area placement.
   Done: the local files match the exported checksums and their native identity
   is recorded, with no source-file substitution.
3. Call `check_print_legibility` on those downloaded files, with their exported
   content bounds and the exact garment hexes from `review.verdicts`. Compare
   checksums, engine version, and protocol. Present actual garment proofs and
   distinguish the numerical verdict from POD's production decision below.
   Done: every approved color/ink/area pair has the same native and local file,
   recorded numerical evidence, disclosed warnings, and a readable, recognizable
   proof at the approved placement.
4. Record the authorized color decision against the exact native packet hash and
   continue that same run through unattended listing preparation and publication.
   Use the publication workflow's session-only color decision; an API key is not
   a person's approval. Existing publication authorization remains in force.
   Done: unattended work retains the reviewed rendition IDs, checksums,
   requirements, placement, default, and ordered artwork/color assignments.

For a separate native library handoff that does not already belong to an active
Product/run, supply `printApprovalByAsset` in `POST /api/creative-intake`, keyed
by the primary native Design Asset ID. Its value is the exported
`review.approval`, under a matching preserved Profile. It pins the Recipe Version,
snapshot hash, placement, every ordered color's source and production rendition,
and all managed geometries. Include its `primary` default rendition when every
color uses an Artwork Option. These pins apply to ready native Assets; import
unimported files before preparation and review. Prefer resuming existing work
over another intake of the same approved artwork.

## Production decision

The color-picker tools retain the strict `ink-legibility-v2` numerical result.
POD's `production-contrast-warning-v1` policy interprets that measurement without
changing its values:

- **Pass:** the strict numerical check passes. Proof readability and structure
  still require review.
- **Warning:** the strict check fails, but the same ink boundary/framing
  calculation passes with a narrow 2.90:1 contrast floor. The color-distance
  minimum and ink-share limits still apply. The native export reports
  `severity: warning`, `numericalPass: false`, its exact reason, and unchanged
  measurements. Review wording, recognizable structure, and fit on the exact
  proof. A warning alone neither rejects nor approves it.
- **Blocker:** the measurement fails beyond the narrow margin, artwork is empty,
  or the measurement is approximate. Technical failures such as changed bytes,
  missing transparency, clipping, or incompatible geometry also block.

Use the native export to classify warnings, especially when a near-threshold
outline supports a faint fill. Checking just one ratio cannot reproduce the
framing calculation. `batch_product_colors` retains its strict numerical gate;
when it refuses a warning pair that passed visual review, retain the native
preserved packet and its stock evidence instead of treating that tool's refusal
as a reason to recolor or substitute a garment.

Keep approved colors and ink versions in unattended work. A missing or changed
production file, placement, or geometry invalidates its approval and stops for
fresh review. Report the affected file, color, measurement, and proof. Resolve a
substantive readability failure through the person's artwork or assortment
decision; a prior source-file approval does not cover new production pixels.
