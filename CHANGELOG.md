# Changelog

Each release is a git tag, `vX.Y.Z`, that consumers pin as
`github:thesnug/color-picker#vX.Y.Z`. Write changes under "Unreleased" as they
merge; `npm run release -- prepare <version>` turns that section into the
release's entry. See "Releases" in [AGENTS.md](AGENTS.md).

## Unreleased

### Library

- `describeToColor` in `@thesnug/color-picker/jev` resolves a free-text color
  description ("the brick shirt", "something autumnal for a coffee brand") to a
  Wada color or a product color. The name lookup runs first; Jev is asked only
  when it misses. Name matches return nearest colors with distances; Jev matches
  return up to three colors with probabilities.
- `rerankByMood` in `@thesnug/color-picker/jev` re-ranks the top ten garment
  recommendations or palettes by how well each suits the design's subject and
  mood, with one cached Jev request of Score questions. Each candidate gains
  `moodScore`, `confidence`, `moodLevel`, and a `combinedScore` weighted by
  `MOOD_WEIGHT`; `combineMood` reweighs without calling Jev. Without Jev the
  order is unchanged and a note says why.
- `vettedRecolorPlans` and `vetRecolorPlans` in `@thesnug/color-picker/jev` ask
  Jev whether each recolor swap keeps the design reading as the same subject.
  Each mapping entry gains `plausibility`; a plan below `PLAUSIBILITY_THRESHOLD`
  (0.4) is marked `implausible`, named in `reasons`, and dropped unless
  `includeImplausible` is set. Without Jev or a description, plans pass with
  `plausibility: null`.

### CLI and MCP

- `--mood` on `recommend` and `palettes` (with `--design <file>`), and `mood` on
  the `recommend_product_colors` and `palettes_for_product_color` tools. HTML
  cards show the mood level as a badge.
- `color-picker recolor --vet` and `recolor_plans` with `vet` describe the
  design and drop implausible plans; `--include-implausible` and
  `includeImplausible` keep them, marked.

### Release tooling

- The release script reports a failed tag push with the commands to recover or
  delete the local tag. `tag X.Y.Z --push-existing` validates its version and
  built release tree before pushing without rebuilding it.

## [0.1.0] - 2026-09-24

The first release.

### Library

- Color math in OKLab and OKLCH: distance, WCAG 2.x and APCA contrast, and
  color-vision-deficiency simulation.
- Nearest Wada color from a hex value or a color name.
- The book's combinations for a color, with Wada-snapped harmonies as a fallback
  and a neutral anchor for gray inputs.
- Palettes for a product color by name, built on precomputed product-to-Wada
  equivalents.
- A combination checker against the accessibility rules in
  `assets/accessibility.json`.
- Web themes from a combination: role assignment, ramps, and CSS variable,
  Tailwind, and design-token output.
- Garment color recommendations for a design, as is or with a recolor plan and
  a generation prompt.

### Entry points

- `@thesnug/color-picker/data`: the cleaned Wada dataset, combinations as
  first-class objects, products, equivalents, and accessibility rules, typed.
- `@thesnug/color-picker/render`: SVG cards, an HTML wrapper, and terminal
  swatches.
- `@thesnug/color-picker/fingerprint`: a design fingerprint from an image file,
  with a cached vision description.
- `@thesnug/color-picker/jev`: the TypeSafe client wrapper with a versioned
  answer cache.
- `color-picker` CLI and `color-picker-mcp` MCP server.

### Data

- Comfort Colors 1717 is the default product. Swatch hex values come from
  Printify; unstocked colors are gap-filled from retail charts with
  `available: false`; eight colors carry reviewed values (INT-2260).
- The Wada neutral hex values are still under review against the printed book
  (INT-2277). A later release will carry any corrections.
