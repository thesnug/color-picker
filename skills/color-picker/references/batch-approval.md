# Batch selection and production approval

Use this workflow for an eight-color apparel batch, especially Working Kitchen.

1. Read each design's brief and latest decisions. Gather the original and existing
   approved alternate inks with their exact prepared production rendition IDs.
   Analyze the actual transparent production file, not an opaque imported source.
   Run `recommend_product_colors` with `mood: true` for each viable ink version;
   review the candidate range before taking the top eight. If needed, request
   `recolor_plans` with `vet: true`, then review the resulting art. Preserve wording,
   composition, alpha, object colors needed for recognition, dimensions and placement.
   Completion: viable ink versions are identified and each has a traceable prepared file.
2. Review legibility and subject recognition per artwork/color combination.
   Distinguish lettering and unoutlined disappearing details from small outlined
   fills. Ratios are evidence, not automatic rejection: Fix with Butter can keep
   Butter because blue lettering and outlines define the yellow butter. Vision
   receives a visible backdrop; ink analysis uses original alpha. Disclose uncertain
   recognition and visually inspect the art before approving any candidate.
   Completion: each alternate has explicit reviewed color slugs, with contextual
   explanations for warnings. Never label a candidate reviewed from score alone.
3. Call `batch_product_colors` with designs, defaultSlug, and artworks containing
   artworkId, renditionId, designPath (the prepared print file), and approvedSlugs.
   Include recent proposals as `recent` when available; disclose missing history.
   It selects exactly eight distinct colors or explains the insufficiency. Preserve
   intentional defaults and design-supporting colors. The deterministic variety
   preference considers repetition and near shades; it does not maximize unique names
   or impose family quotas. `batch_repetition_report` also reports manually revised
   selections. Complete with current/recent usage by name, family, lightness,
   saturation and similar shades. These are proposal counts, never inventory.
4. Verify provider availability for S, M, L, XL, 2XL and 3XL for every selected color.
   Catalog `available` flags alone do not establish six-size stock. Verify front
   print-area coverage and placement compatibility for each prepared rendition;
   for Working Kitchen enforce the current visible-art height limit from its brief.
   Produce one eight-composition proof per shirt using the exact rendition and
   placement assigned to each color. A swatch card is not a composition proof.
   Completion: eight colors, one default, eight explicit artwork/rendition mappings,
   six-size availability evidence, print-area/placement evidence, and one proof
   per shirt are present. Ask for approval only when this packet is reviewable.
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
