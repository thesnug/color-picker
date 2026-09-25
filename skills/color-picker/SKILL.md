---
name: color-picker
description: Color choices from Sanzo Wada's A Dictionary of Color Combinations, with swatch cards. Use for palettes or color combinations, choosing shirt or garment colors for a design, recoloring a design to suit a shirt, checking a palette's contrast or accessibility, and any Comfort Colors color named ("Pepper", "Blue Spruce").
---

# Color picker

The `color-picker` MCP server answers color questions from Sanzo Wada's book and
the garment colors of print products, and returns every answer with a rendered
swatch card. The tool names below are the server's own; your host may prefix
them with the server name (`mcp__color-picker__combinations`).

Reach for it when the user wants colors that go together, colors for a shirt,
or a verdict on colors they already have. A plain request for one hex code with
no palette behind it (a CSS tweak, a syntax theme) needs none of this.

## Setup

When no `color-picker` tools are available, register the server once for every
project with the command for your host, then ask the user to start a new
session, since servers load at startup.

Claude Code:

```bash
claude mcp add --scope user color-picker -- npx -y -p github:thesnug/color-picker#v0.2.0 -p @modelcontextprotocol/sdk -p zod color-picker-mcp
```

Codex, in `~/.codex/config.toml`:

```toml
[mcp_servers.color-picker]
command = "npx"
args = ["-y", "-p", "github:thesnug/color-picker#v0.2.0", "-p", "@modelcontextprotocol/sdk", "-p", "zod", "color-picker-mcp"]
startup_timeout_sec = 120
env_vars = ["TYPESAFE_API_KEY", "OPENROUTER_API_KEY"]
```

Keep the host's tool approval prompts enabled. Before a design-processing call,
confirm the user wants that local design read; with a vision provider configured,
its image may leave this machine for the provider before Jev judges it. For
`recolor_plans`, choose an `outDir` the user controls: it can create directories
and overwrite output PNGs there. Do not approve these calls by default.

The first start downloads the package, so it can take a minute; later starts
use npm's cache.

The Jev judgments (mood re-rank, recolor vetting) run when the server's
environment has `TYPESAFE_API_KEY` and a vision provider (a Codex CLI login, or
`OPENROUTER_API_KEY`). Claude Code passes its own environment to the server;
Codex passes the variables listed in `env_vars`. Without them the tools still
answer, deterministically, and say why.

## Choose the tool

| The user wants | Call |
| --- | --- |
| Palettes for a color, hex, or name | `combinations` |
| Palettes for a shirt color by name ("what goes with Pepper") | `palettes_for_product_color` |
| Which shirt colors suit a finished design | `recommend_product_colors` |
| The design's colors changed to suit each shirt | `recolor_plans` |
| The Wada name for a hex, or the closest book colors | `nearest_colors` |
| Site or app colors | `theme` |
| A verdict on colors they already have | `check_accessibility` (`print` for fabric, `web-text` or `web-ui` for screens) |
| A product's color range, or a color's exact name | `list_products` |
| An earlier result as an HTML review page | `render_card` with its `resultId` and `format: "html"` |

The garment hex values, stock, and Wada pairings live only in the server. When
a call fails, tell the user the error and the setup step that fixes it, and
stop there: colors from a web search or your own contrast math disagree with
the reviewed product data.

Defaults:

- **Product:** Comfort Colors 1717. Omit `product` unless the user names
  another garment; `list_products` gives the IDs.
- **Jev:** pass `mood: true` to `recommend_product_colors`, and to
  `palettes_for_product_color` whenever there is a design; pass `vet: true` to
  `recolor_plans`. They never fail a call: without keys the reply's `mood` or
  `vet` field says the order is the deterministic one, and why.
- **Designs:** `designPath` as an absolute path on this machine. Use
  `designBase64` only when the file exists nowhere on disk.

## Present the result

Every reply is JSON with a `resultId` and, for tools that return colors, a
swatch card: `svg` as markup and `cardFile`, the absolute path of the same card
written to disk with its garment photos inlined. The card is the answer; the
JSON is its evidence.

1. **Show the card.** Copy the file at `cardFile` to one named for the
   question (`pepper-palettes.svg`) and show it: as an artifact or a sent file
   where the host offers one, otherwise as a Markdown link to the file. Never
   write `svg` into a file yourself: it links garment photos by URL, and hosts
   that show an SVG file as an image block those links, so the shirt shows as
   a broken-image icon. For side-by-side review, call `render_card` with
   `format: "html"` and show its `cardFile` the same way. Size the card with
   the call's `n` or `limit`, set to the number of picks you will show, and
   show the card as returned.
2. **Name the colors.** Under the card, say what it shows in Wada's names,
   with the hex after the name: "Hermosa Pink (#ffb3f0) with Seashell Pink and
   Calamine Blue, combination 176." Name garments by their product name
   ("Graphite"), and a design's own colors by the Wada names the reply gives
   them (`wada.name`): "an Apricot Orange ring on a Sulphur Yellow center."
3. **Carry the warnings.** Repeat what the reply flags: design colors that
   would vanish into a shirt, garment colors the provider does not stock,
   failed contrast pairs, and the `mood` or `vet` reason when Jev did not run.

Hex codes appear only beside a name. A list of bare hex codes is never the
answer.
