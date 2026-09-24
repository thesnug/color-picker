# Color Picker design

Status: agreed 2026-09-24. This document records the decisions behind the project so
later work can build on them without re-deriving them. Task tracking lives in the
Linear project **Color Picker** (`P-INT-53`, team Internal); see `AGENTS.md` for how
issues are added and kept in sync with this document.

## Goal

Given a single color, a color name, or a design file, produce reviewable color
palettes drawn from Sanzo Wada's *A Dictionary of Color Combinations*, and recommend
print-on-demand garment colors for a design. The same library serves web and
general palette work, so nothing in the core assumes a garment.

The concrete requests the tool answers:

1. A hex code: the closest Wada colors and the book's combinations for them.
2. A shirt color name: the best palettes for that garment.
3. A design: the best shirt color for it, unchanged.
4. A design: the best *n* shirt colors for it, unchanged.
5. A design: *n* shirt colors it would work on **with** recoloring, plus a
   machine-readable color mapping and a prompt describing the recolor.

Every answer is returned as swatches that can be reviewed in place. Hex codes alone
are never the deliverable.

## Data

### Wada reference (`assets/colors.json`)

Vendored from https://sanzo-wada.dmbk.io/assets/colors.json, the open-source web
edition by Dain Blodorn Kim (https://github.com/dblodorn/sanzo-wada). 157 colors,
348 combinations. Each color carries index, name, slug, CMYK, RGB, hex, and the IDs
of the combinations it belongs to. Combinations are not objects in the source; they
are reconstructed by grouping colors that share an ID. Sizes: 124 pairs, 112 triads,
99 tetrads, 3 of five, and 10 singletons.

Known issues to handle in a cleanup pass, keeping the original text as an alias:

- Typos in the web edition, checked against the printed book on 2026-09-24:
  "Calamine BLue", "Pomegranite Purple", "Sulpher Yellow", "Krongbergs Green"
  (the book has "Kronbergs Green", no apostrophe), and "Artemesia Green".
  "Cerulian Blue", "Antwarp Blue", "Rosolanc Purple", "Vandar Poel's Blue", and
  "Vistoris Lake" are the book's own spellings and stay canonical; the modern
  spellings are aliases where the equivalence is certain.
- Variant names such as "Eugenia Red | A" and "Grayish Lavender - A".
- The hex values are the site's sRGB conversions from the book's CMYK, not
  authoritative in general. Keep the CMYK alongside. The exception is the
  neutrals: on 2026-09-24 Jill checked all 19 grays, slates, drabs, and
  flagged-neutral colors against the printed book and confirmed every web hex
  matches (INT-2277). Their green lean is real, so the book has no true
  mid-gray and no override table exists for them.

`scripts/build-data.ts` derives two committed files, and CI fails when they are
stale. `assets/derived/colors.json` carries each color with its canonical name,
aliases (the source name always among them when it differs), slug, hex, RGB, CMYK,
OKLab, OKLCH, and a neutral flag. `assets/derived/combinations.json` makes each
combination a first-class object: ID, member colors, size, harmony label, average
lightness, hue spread, and whether it contains a neutral. Everything derivable is
precomputed and committed so runtime queries are file reads.

### Products (`assets/products/`)

One JSON file per product plus an `index.json` naming the default product.
**Comfort Colors 1717 is the default** when no product is named.

Per product: id, brand, model, display name, print method, print areas. Per color:
name, slug, hex, aliases, family, `available` flag, and provenance (`source` and a
date). Optional per color: the public garment image URL and its SHA-256 (a pointer,
never the bytes), and a `pod` block holding the POD Color Asset Version ID for the
picker's use.

Ownership: this repo owns product facts (name, hex, availability, Wada equivalents).
The maker-method-picker and POD own the render pipeline (Shot, asset versions,
mockups). This repo never decides which render version is current.

### Hex provenance for Comfort Colors 1717

Decision: **pull swatches from Printify directly** (blueprint 706, the print
provider in use) via an import script, record `source: printify` and the fetch date,
and never route values through POD's catalog normalizer.

Why:

- The existing 66-color set in `maker-method-picker/app/prototype/color-study/colors.json`
  came from Printify shop option swatches via POD, and has a rendered garment image
  pinned to each color. It is the in-stock truth for the POD provider.
- POD's `services/catalog/normalize.ts` resolves a color name through a generic
  hardcoded map *before* the provider hex, so Black and White arrived as pure
  `#000000` and `#FFFFFF`. A fix in POD is tracked separately; this repo avoids
  the path entirely. (The first direct import, 2026-09-24, found Printify's own
  swatches for Black and White are also pure `#000000` and `#ffffff`, so those two
  need the review pass regardless of path. Every other swatch matched the color
  study exactly.)
- Retail charts disagree with each other as much as with Printify (median OKLab
  distance about 9 between two charts, 40 apart on Hemp). They are not measurements.

Three rules follow:

1. **Gap fill.** Colors on the 2026 retail chart that Printify does not stock
   (Emerald, Dusk, Rose Quartz, Neon Cantaloupe at the time of writing) enter with a
   chart hex, `available: false`, `source` naming the chart, and the chart page as
   `sourceUrl`. A color no chart publishes a hex for enters with `hex: null`. Emerald
   is listed without a hex on the 2026 chart; its value comes from an older
   Comfort Colors chart and says so in `sourceNote`. Renderers mark unstocked
   colors "not stocked" with a dashed outline.
2. **Review pass.** The first swatch card renders each hex tile beside its garment
   image so mismatches are corrected once. A corrected value gets `source: reviewed`
   and the import script never overwrites it. Regenerating a mockup is cheaper than
   a returned product.
3. **Equivalents are stored.** `assets/products/<product>.equivalents.json` holds
   each product color's nearest Wada colors with distances, regenerated by script and
   checked for staleness in CI.

### Accessibility (`assets/accessibility.json`)

Numbers live in JSON, math lives in code. Contents: WCAG 2.x thresholds (AA and AAA
for body text, large text, and UI components), APCA lightness-contrast levels, print
rules (minimum distance between adjacent print colors, the dark-ink-on-dark-garment
cutoff, an underbase note for light ink on dark garments), and the color-vision
deficiency simulations to run (protan, deutan, tritan). A `check` function evaluates
any combination against these and returns pass/fail with reasons.

## Architecture

**A single package with subpath exports, no framework, no AI in the core.**

| Entry point | Contents |
| --- | --- |
| `@thesnug/color-picker` | Color math, nearest match, combinations, recommendations, recolor plans |
| `@thesnug/color-picker/data` | The JSON assets, typed |
| `@thesnug/color-picker/render` | SVG, HTML, and terminal swatch renderers |
| `@thesnug/color-picker/fingerprint` | Design fingerprints from image files, cached on disk |
| `@thesnug/color-picker/jev` | The TypeSafe client wrapper with its answer cache |
| `bin: color-picker` | CLI |
| `bin: color-picker-mcp` | MCP server |

Consumers: this session via the CLI and rendered cards; Claude Code, Codex, and POD
agents via the MCP server; the maker-method-picker and POD by direct import.

Decisions and their reasons:

- **Single package, not a monorepo.** One author, two consumers. Subpath exports
  give a clean surface without workspace overhead. CLI and MCP dependencies are kept
  to a minimum and declared optional peers. Split into a monorepo only if that bites.
- **Git dependency pinned to a tag, not a published package.** The repo is public,
  so no registry or token is needed. Consumers pin
  `github:thesnug/color-picker#vX.Y.Z` and upgrade deliberately. `dist` is committed
  at tag time by a release script so installs need no compiler. The release
  commit is `main` plus `dist` and is reachable only from its tag, so `main`
  never tracks build output. Publish to npm only if a consumer outside our
  control appears.
- **Public repo.** Wada data is open source, garment names and hex values are public
  facts, and the R2 image URLs are already world-readable.
- **Not an agent.** Agents call the tools. A deterministic core is cheap, testable,
  and fast enough to run on every keystroke in the picker.
- **OKLab/OKLCH for all color math.** Distance, harmonies, ramps, and family
  grouping. The picker's existing HSL grouping and WCAG luminance in `palette.ts`
  move into this library and the picker consumes them, so both tools agree.
- **Fingerprinting is its own entry point, decoding through `sharp`.** It reads
  files and writes a cache, which the core does not do. `sharp` is an optional peer
  like the MCP SDK: it decodes PNG, WebP, and JPEG and applies EXIF orientation,
  which no small pure-JS decoder covers (WebP in particular). Callers without it
  pass their own decoder.
- **The MCP server wraps the CLI's commands, not the library directly.** Each tool
  returns the same JSON the CLI's `--json` prints, plus the rendered card as `svg`
  and a `resultId`. `render_card` re-renders a recent result (the last 50, held in
  memory) as SVG or HTML, so an agent never re-sends a result to see it another way.
  Design inputs are a path or base64; both key the fingerprint cache by file hash.
  Jev options (`mood`, `vet`) never fail a call: when Jev is unavailable the result
  is the deterministic one, with the reason in the reply.

## Pipelines

**Nearest match.** Hex to OKLab, distance to every Wada color, top *k* with deltas.
Pure math, no model. Names resolve through aliases and a CSS/xkcd color-name
dictionary before falling back to a model.

**Combinations for a color.** The book's combinations for the nearest matches (and
for the second and third match when within a distance threshold). When the book gives
too few, generate Wada-snapped harmonies: complementary, split-complementary,
triadic, and analogous computed in OKLCH and snapped to the nearest Wada color.
Rank by contrast against the anchor: book palettes first, grouped by which match
they came from, then harmonies, each by a score weighting contrast three to one over
hue spread. The anchor is the plain nearest match, with one exception: a gray input
(OKLab chroma at or below 0.015, the same cutoff as the neutral color family)
anchors on the nearest neutral Wada color when that neutral is no farther than 1.5
times the plain nearest distance. The chroma cutoff keeps muted hues such as Navy,
Moss, and Sage on their plain nearest match; the margin keeps a gray on its plain
nearest match when the web edition's tinted neutrals are all far from it (Grey and
Granite, until INT-2277 corrects the neutral hex values). When the rule is
considered, the anchor records the losing candidate and its distance. Callers that
already know the anchor, such as palettes for a garment built on its stored
equivalents, pass it by Wada index or slug and skip resolution, reported as
`via: "anchor"`. `nearest` itself stays pure distance.

**Design fingerprint.** Quantize a design's opaque pixels to its top five colors
with coverage percentages; measure ink luminance; note transparency; hash the file.
Quantization is median cut in OKLab refined by k-means; clusters closer than
about two and a half just-noticeable differences merge, and small clusters lying
between two larger ones (antialiased edges) fold into them. Ink luminance is the picker's
`measureInk`: alpha-weighted mean WCAG luminance over every visible pixel, not
over the five-color palette, so the two tools agree on photographic art too.
One vision pass per design writes a two-line subject-and-mood description and a list
of named elements, each tied to the palette color that paints it (the prompt lists
the palette and the schema limits each element's hex to it), cached by file hash
and exact prompt (including rounded palette shares) next to the fingerprints.
The file hash is checked even on a cache hit. The pass runs through the Codex CLI on the
machine's ChatGPT login first, then OpenRouter when `OPENROUTER_API_KEY` is set;
both use the same model by default and the same strict JSON schema, and the
description records which provider and model answered. With neither available the
feature errors and says how to enable one; a cached description needs neither.
Palette colors take their element names, which recolor plans and prompts use.
Everything downstream is keyed on the fingerprint so a design is analyzed once.

**Recommend shirts, unchanged.** For each garment color, four components from 0 to
1: contrast between the garment and each design color, as progress toward WCAG
4.5:1 and weighted by coverage; a vanish penalty for the coverage of design colors
closer to the garment than the print minimum distance (their edges would vanish);
ink fit by the dark-ink luminance cutoff; and a small bonus when the garment's and
the design's dominant Wada colors share a book combination. One exported weights
constant combines them, and the components are returned so the score can be
recomputed without re-analysis. Top ten go to Jev for mood fit. Each pick carries
plain-language reasons, and a warning per vanishing color.

**Recommend shirts, with recoloring.** For each garment: find a combination containing
a near match of the garment with enough other members; map the design's colors onto
them preserving lightness order so hierarchy survives; Jev checks each swap's
plausibility. Output per shirt: a from-to mapping table and a prompt. Flat-color art
is recolored deterministically from the table; the prompt is for painterly art only.
Candidates are the book combinations containing one of the garment's stored
equivalents, then harmonies generated from it. A combination with more members
than the design has colors tries every subset of the right size. One with fewer
merges: the lightness-sorted design colors split into contiguous runs, one per
ink, so neighbors in lightness share an ink. Within a garment, book beats harmony
and enough members beats merging (then the most members wins); a plan whose new
ink is within the print minimum distance of the garment is flagged and used only
when nothing else exists. The score is contrast and vanish as for the unchanged
recommendation, plus fidelity, 1 minus the coverage-weighted distance from each
design color to its ink over 100, so the least disruptive recolor wins ties. The
prompt is a template over the mapping, naming each design element when a vision
description supplies one. Flat art is detected from the fingerprint (its palette
covers at least 90% of the design) and then from the pixels (at most 5% farther
than the print minimum from every mapped color); recoloring snaps each visible
pixel to its nearest mapped color and keeps its alpha.

**Web outputs.** From any chosen combination, assign roles by contrast rules
(background, text, accent, through the accessibility checker's `roles`) and derive
the two a UI needs that a two-to-four-color combination does not supply: a
surface (the background shifted in OKLCH lightness to a small contrast against it,
1.08:1 light and 1.2:1 dark, stopping early where text or accent would fall below
their minimum) and muted text (the text mixed toward the background in OKLab as
far as it still meets 4.5:1 on background and surface). When no member works as
an accent, the text color stands in. Every emitted pairing meets WCAG 2.2 AA for
its use; APCA is reported, not enforced. Contrast is symmetric, so a combination
legible in light mode is legible in dark mode too; about 57% of the book's
combinations have no pair at 4.5:1 and yield an error object. Emit CSS custom
properties, a Tailwind v4 `@theme` block, and W3C design tokens (format 2025.10).
Named tint and shade ramps per color (`namedRamp`, 50 to 950) turn a single Wada
color into a UI scale: even OKLCH lightness, constant hue, chroma tapering toward
the ends, and the input color held exactly at its own step.

## Jev (TypeSafe System One)

Jev is used only for judgments code cannot make. It is text-only, so images are
reduced to fingerprints and descriptions first. Answers are cached by question
version and state hash, under `assets/cache/` or a local cache directory.

| Judgment | Primitive | Notes |
| --- | --- | --- |
| Words to color ("dusty rose", "the brick shirt") | Choice over Wada or product names, hex and family in each description | Choice allows up to 255 options; both lists fit in one question |
| Palette re-rank for a design | Score per candidate, fan-out in one request | Code produces the shortlist first |
| Recolor plausibility ("does the strawberry still read as a strawberry?") | Noul per proposed swap | The one part only a semantic model can do |

Every call goes through `ask` in the `jev` entry point, which sends a feature's
questions about one state in one request. The cache key is the SHA-256 of the
feature's question version, the question definitions, and the state, with object
keys sorted so key order does not matter. A cache hit needs neither the SDK nor a
key, so committed answers work in every install. `@typesafe-ai/sdk` is an
optional peer, like `sharp` and the MCP SDK, and the API key comes only from
`TYPESAFE_API_KEY`.

Hex-to-nearest is never sent to Jev. Thresholds are evaluated on labeled examples
before they gate anything; cookbook numbers are starting points, not rules.

## Rendering

SVG is the primary format: no dependencies, renders in an artifact, in the picker,
in a PR, and converts to PNG for Slack. A combination card is a strip of tiles with
Wada name, hex, and contrast badges. A product card shows the garment photo with the
design's colors as chips beside it. HTML wraps SVG for in-session review; the CLI
prints truecolor blocks.

## Phasing

1. **Foundation.** Package scaffold, Wada cleanup and combinations, color math,
   nearest match, combinations, SVG swatches, CLI. No AI.
2. **Products and rules.** Product schema, Printify import, gap fill, equivalents,
   review pass, accessibility asset, design fingerprint, recommend and recolor rules,
   web outputs.
3. **Jev.** Client and cache, words to color, design description, palette re-rank,
   recolor plausibility, threshold evaluation.
4. **Integration.** MCP server, Claude skill, picker consumption, POD consumption,
   tagged releases.

## Related work outside this repo

- `thesnug/maker-method-picker`: consumes this package; its `palette.ts` logic moves
  here; its `colors.json` remains the render-pipeline record.
- `thesnug/print-on-demand`: fix `resolveColorHex` precedence so provider swatches
  win over the generic map; later consume this package for recommendations.

## Sources

- Wada data: https://sanzo-wada.dmbk.io/ and https://github.com/dblodorn/sanzo-wada
- Comfort Colors 1717 retail charts used for gap fill and cross-checks:
  https://getcustom.store/blog/comfort-colors-1717-all-67-colors-2026-color-chart-guide,
  https://www.dtlaprint.com/blog/comfort-colors-color-chart/,
  https://www.transfersuperstars.com/blogs/color-swatches/comfort-colors-apparel-color-swatch-hex-pantone
- TypeSafe docs: https://docs.typesafe.ai/
