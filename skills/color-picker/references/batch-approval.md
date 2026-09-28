# Batch selection and production approval

Use this workflow when choosing a final eight-color apparel assortment or
preparing publication. Exploratory suggestions
can use `recommend_product_colors` without prepared renditions or provider stock
evidence; label them provisional.

1. Read each design's brief and latest decisions. Gather the original and existing
   approved alternate inks with their exact prepared production rendition IDs.
   Analyze the actual transparent production file, not an opaque imported source.
   Run `recommend_product_colors` with `mood: true` for each viable ink version;
   review the candidate range before taking the top eight. Do not treat a low
   deterministic rank as an automatic rejection: an alternate ink may make a
   strong, distinctive garment viable. If needed, request
   `recolor_plans` with `vet: true`, then review the resulting art. Preserve wording,
   composition, alpha, object colors needed for recognition, dimensions and placement.
   Completion: viable ink versions are identified and each has a traceable prepared file.
2. Review legibility and subject recognition per artwork/color combination.
   Distinguish lettering and unoutlined disappearing details from small outlined
   fills. Ratios are evidence, not automatic rejection: a low-contrast fill may
   remain readable when contrasting lettering and outlines define its subject. Vision
   receives a visible backdrop; ink analysis uses original alpha. Disclose uncertain
   recognition and visually inspect the art before approving any candidate.
   Completion: each alternate has explicit reviewed color slugs, with contextual
   explanations for warnings. Never label a candidate reviewed from score alone.
3. Check the provider's current variant availability for S, M, L, XL, 2XL and
   3XL for every candidate color. Give `batch_product_colors` a `sizeAvailability`
   entry per approved slug with `sizes`, `checkedAt` and `source`. A product's
   catalog `available` flag is not proof of six-size availability. If evidence is
   absent or incomplete, do not select that color.
   Call `batch_product_colors` with designs, defaultSlug, and artworks containing
   artworkId, renditionId, designPath (the prepared print file), and approvedSlugs.
   Include recent proposals as `recent` when available; disclose missing history.
   Read the requesting project's brief for assortment goals. If it specifies
   color groups, pass them as `desiredGroups` with a name and allowed slugs or
   families; use `excludeSlugs` when a family has exceptions. The tool has no
   built-in garment palette or preferred named colors. Without project groups,
   it selects eight distinct reviewed candidates by artwork fit and diversity.
   If a requested group has no viable color, the tool fills from other eligible
   colors and returns the gap in `unfilledGroups`. Explain the gap and try a
   viable artwork variation where one exists. Preserve intentional defaults
   and design-supporting colors. `batch_repetition_report` also reports manually revised
   selections. Complete with current/recent usage by name, family, lightness,
   saturation and similar shades. These are proposal counts, never inventory.
4. Recheck provider availability for the selected colors before approval. Verify front
   print-area coverage and placement compatibility for each prepared rendition,
   including any size limits in the requesting project's brief.
   Produce one eight-composition proof per shirt using the exact rendition and
   placement assigned to each color. A swatch card is not a composition proof.
   Completion: eight colors, one default, eight explicit artwork/rendition mappings,
   six-size availability evidence, print-area/placement evidence, and one proof
   per shirt are present. Present the packet when the user asks to review the
   final assortment or the publication workflow requires approval.
5. Before authorized publication, resolve each color to the rendition shown in its
   approved proof and reuse it. Determine background handling from source alpha AND
   the approved preparation requirements. An opaque source with an approved
   transparent rendition may require `remove`; a transparent proof does not imply
   that re-preparing with `preserve` is correct. Download the provider print file and
   call `verify_print_rendition` against the exact approved transparent production
   file. Any alpha, dimension or visible-pixel mismatch blocks publication. Correct
   the rendition, regenerate affected mockups/proofs, and obtain renewed approval
   when their appearance changes. Completion: all provider files match the approved
   production pixels and every affected mockup reflects the matched rendition.

Carry `mood.reason`/`vet` explanations when semantic judgments cannot run.
`batch_product_colors` applies deterministic scoring to reviewed candidates; it
performs neither mood ranking nor recolor vetting and says so. External stock,
placement, proof and publication checks remain the agent/POD system's responsibility.
