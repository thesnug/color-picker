# @thesnug/color-picker

Color palettes drawn from Sanzo Wada's *A Dictionary of Color Combinations*, and
garment color recommendations for print-on-demand designs. A deterministic
TypeScript library with a CLI and an MCP server. No framework, no AI in the core.

The design and its reasons are in [docs/DESIGN.md](docs/DESIGN.md). How work is
organized is in [AGENTS.md](AGENTS.md).

## Install

The package is consumed as a git dependency pinned to a release tag. Releases
commit `dist/`, so installs need no compiler.

```bash
npm install github:thesnug/color-picker#vX.Y.Z
```

Or in `package.json`:

```json
{
  "dependencies": {
    "@thesnug/color-picker": "github:thesnug/color-picker#vX.Y.Z"
  }
}
```

Requires Node 20 or later. The package is ESM only.

Upgrade deliberately by moving the tag. Releases are listed at
https://github.com/thesnug/color-picker/tags.

## Entry points

| Entry point | Contents |
| --- | --- |
| `@thesnug/color-picker` | Color math, nearest match, combinations, recommendations, recolor plans |
| `@thesnug/color-picker/data` | The JSON assets, typed |
| `@thesnug/color-picker/render` | SVG, HTML, and terminal swatch renderers |
| `bin: color-picker` | CLI |
| `bin: color-picker-mcp` | MCP server |

```ts
import { normalizeHex } from "@thesnug/color-picker";
import { loadWadaColors } from "@thesnug/color-picker/data";
import { renderSwatchStripSvg } from "@thesnug/color-picker/render";
```

### CLI

```bash
npx color-picker --help
```

### MCP server

The MCP server depends on `@modelcontextprotocol/sdk`, declared as an optional
peer dependency so consumers that import only the core never install it. Add it
next to this package to run the server:

```bash
npm install @modelcontextprotocol/sdk
npx color-picker-mcp
```

The server speaks MCP over stdio. Register it with a client as the command
`color-picker-mcp`.

## Development

```bash
npm ci
npm test          # vitest
npm run typecheck # tsc, no emit
npm run build     # tsc to dist/ with declarations
```

`dist/` is ignored in git and is committed only by the release script at tag
time. CI runs typecheck, tests, and the build on pull requests and on `main`.

## Data

`assets/colors.json` is vendored from the open-source web edition of the
dictionary by Dain Blodorn Kim (https://github.com/dblodorn/sanzo-wada) and is
never edited by hand.

`scripts/build-data.ts` derives `assets/derived/colors.json` (cleaned names,
aliases, OKLab and OKLCH values) and `assets/derived/combinations.json` (one
object per combination with a harmony label). The name corrections are listed at
the top of the script. Both files are committed; CI fails when they are stale.

```bash
npm run data:build  # regenerate assets/derived/
npm run data:check  # fail if assets/derived/ is out of date
```

## License

MIT.
