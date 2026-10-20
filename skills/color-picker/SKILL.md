---
name: color-picker
description: Use for Sanzo Wada palettes, named Comfort Colors garment colors, shirt-color recommendations for artwork, artwork recolor planning, and color contrast checks. Shows swatch cards and product-specific evidence. Skip unrelated one-off CSS hex requests.
---

# Color picker

The `color-picker` MCP server answers color questions from Sanzo Wada's book and
the garment colors of print products. Color results include rendered swatch
cards. The tool names below are the server's own; your host may prefix
them with the server name (`mcp__color-picker__combinations`).

Reach for it when the user wants colors that go together, colors for a shirt,
or a verdict on colors they already have. A plain request for one hex code with
no palette behind it (a CSS tweak, a syntax theme) needs none of this.

## Setup

When no `color-picker` tools are available, use an installed package CLI if
available. Otherwise register the server once for your host using the matching
setup below. If that host loads new servers only at startup, explain the restart
needed to use its MCP tools. Do not present generic web swatches as this
package's reviewed garment data.

Claude Code:

```bash
claude mcp add --scope user color-picker -e TYPESAFE_API_KEY="$TYPESAFE_API_KEY" -- npx -y -p github:thesnug/color-picker#v0.6.0 -p "sharp@^0.35.4" -p "@typesafe-ai/sdk@^0.6.0" -p @modelcontextprotocol/sdk -p zod color-picker-mcp
```

Codex, in `~/.codex/config.toml`:

```toml
[mcp_servers.color-picker]
command = "npx"
args = ["-y", "-p", "github:thesnug/color-picker#v0.6.0", "-p", "sharp@^0.35.4", "-p", "@typesafe-ai/sdk@^0.6.0", "-p", "@modelcontextprotocol/sdk", "-p", "zod", "color-picker-mcp"]
startup_timeout_sec = 120
env_vars = ["TYPESAFE_API_KEY", "OPENROUTER_API_KEY"]
```

When `mood` or `vet` invokes a configured vision provider, the design image may
leave this machine. A request to analyze the supplied design authorizes reading
it; ask only if the intended provider use is outside the user's request. For
`recolor_plans` and `artwork_options`, omit `outDir` when planning only. If applying recolors, choose
an output directory where writing PNGs is appropriate; existing files there may
be overwritten.

The first start downloads the package, so it can take a minute; later starts
use npm's cache.

Keep every `-p` in the command. `sharp` reads designs and embeds the garment
photos in card files, and `@typesafe-ai/sdk` runs Jev. Both are optional
dependencies of the package, so `npx` installs them only when named here.

The Jev judgments (mood re-rank, recolor vetting) run when the server's
environment has `TYPESAFE_API_KEY` and a vision provider (a Codex CLI login, or
`OPENROUTER_API_KEY`). The server reads no `.env` file. For Claude Code, the
`-e` above copies the key from the shell you register from into the server's
config, so run it where `TYPESAFE_API_KEY` is set; if it is not, `-e` stores an
empty key. Codex passes only the variables listed in `env_vars`, and only when
they are set in Codex's own environment. Without a key the tools still answer,
deterministically, and the reply's `mood` or `vet` field says why.

## Choose the tool

| The user wants | Call |
| --- | --- |
| Palettes for a color, hex, or name | `combinations` |
| Palettes for a shirt color by name ("what goes with Pepper") | `palettes_for_product_color` |
| Which shirt colors suit an existing design, including a draft | `recommend_product_colors` |
| Whether a design's ink reads on given shirts, before proposing, approving, or publishing | `check_print_legibility` |
| The design's colors changed to suit each shirt | `recolor_plans` |
| Alternate inks so a design reads on the shirts it fails | `artwork_options` |
| Which colors and inks POD's Creative color study tries first, for a design and its Artwork Options | `rank_artwork_pairs` |
| The Wada name for a hex, or the closest book colors | `nearest_colors` |
| Site or app colors | `theme` |
| A verdict on colors they already have | `check_accessibility` (`print` for fabric, `web-text` or `web-ui` for screens) |
| A product's color range, or a color's exact name | `list_products` |
| An earlier result as an HTML review page | `render_card` with its `resultId` and `format: "html"` |

The package owns reviewed garment hex values and Wada pairings. On a tool error, inspect its cause and fix the input or setup when
possible. If the package remains unavailable, distinguish any general color
advice from product-verified recommendations and say what could not be checked.

## Stock

This package holds no provider stock and checks none: its catalog lists every
color the garment comes in, including colors the print provider has sold out or
dropped. **For POD Products, use POD's tools, which check live stock.** Outside
POD, when you have a live stock check, pass only the colors it found sellable as
`colors`. Whenever a reply's `stock.checked` is false, say plainly with the
suggestions that provider stock was not checked; never present a suggested
color as available to order.

Defaults:

- **Product:** Comfort Colors 1717. Omit `product` unless the user names
  another garment; `list_products` gives the IDs.
- **Jev:** use `mood: true` when subjective fit to a design matters, and
  `vet: true` for proposed recolors where subject recognition matters. Jev
  supplements visual review; it does not establish legibility or stock. When
  Jev is unavailable, inspect the reply's `mood` or `vet` reason and use the
  deterministic result with that limitation stated.
- **Designs:** `designPath` as an absolute path on this machine. Use
  `designBase64` when bytes are supplied without a usable path. Pass
  `contentBounds` when the project has measured the print's visible content
  (POD does), so the measurement matches POD's.

## Legibility

The shared numerical ink-contrast check is the ink-legibility-v2
verdict, in every tool that judges it and in POD's Creative color study, which
runs the same engine: each ink laid on the garment must reach 3:1 and sit 10
apart in OKLab, unless legible ink frames it (a pale fill inside a dark
outline); a garment fails when a fifth of the ink is lost or less than a fifth
reads. `recommend_product_colors` ranks the garments a design passes first,
and each pick's `legibility` gives the verdict and its reason.
`check_print_legibility` judges chosen garments, `artwork_options` plans
pigment substitutions that add legible garments, and `recolor_plans` reports
each plan's verdict on its garment. `rank_artwork_pairs` gives the order POD's
study explores the approved art and its Artwork Options in: each color keeps
the original where it reads, then a hue-keeping legible-ink option, and a Wada
repaint leads only where neither reads; the original's colors come first.
Give it the exact prepared production files; generated recolor options still need
production preparation before final approval. Replies carry `engine` (version and protocol): cite it when comparing
with POD's study evidence.
`check_accessibility` with `print` checks only that a palette's colors stay
distinct from each other; it is not a legibility verdict.

For POD final approval, read [POD production-file approval](references/pod-production-approval.md).
POD retains this numerical verdict and adds a separate production decision:
pass, a narrow borderline warning requiring garment-proof review, or blocker.
The MCP's raw `pass: false` alone cannot distinguish the warning from the blocker.
Use the native production review export's decision on the same file and content
bounds; preserve the measurements and disclose every warning.

## Batch apparel and publication

For exploratory garment ideas, including a provisional set of eight, use
`recommend_product_colors` with a broad candidate range and review the artwork
on varied shirts. Use `recolor_plans` to explore viable ink variations when
needed. Label these suggestions provisional, and say that provider stock was not
checked: these tools check none, let alone S–3XL.

For a final eight-color assortment or publication work, read
[Batch selection and production approval](references/batch-approval.md). That
workflow requires reviewed art/color combinations, provider size evidence,
composition proofs, and exact production-rendition checks at the appropriate
stages.

## Present the result

Color-bearing replies include JSON evidence and usually an SVG swatch card at
`cardFile`, with embedded garment photos when available. Report-only tools may
return JSON without a card. `render_card` can show an earlier color result in
another format.

1. **Show visual color results.** Display or link `cardFile` directly where the
   host supports it. For side-by-side review, call `render_card` with
   `format: "html"`. Avoid writing the reply's `svg` markup into a new file:
   its external garment photos may not render in an image viewer. If
   `cardWarnings` reports missing photos, explain the limitation.
2. **Name the colors.** For visual results, say what the card shows in Wada's names,
   with the hex after the name: "Hermosa Pink (#ffb3f0) with Seashell Pink and
   Calamine Blue, combination 176." Name garments by their product name
   ("Graphite"), and a design's own colors by the Wada names the reply gives
   them (`wada.name`): "an Apricot Orange ring on a Seashell Pink center."
3. **Carry relevant warnings.** Explain what the reply flags: ink the
   legibility verdict calls lost on a shirt, that provider stock was not checked
   (the reply's `stock.note`), failed contrast pairs, and the `mood` or `vet` reason when Jev
   did not run. Never present an illegible pick as a recommendation.

For palette and garment recommendations, pair hex codes with color names. If
the user asks for machine-readable codes, provide them in the requested format.
