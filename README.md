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

### Products

Each garment product is one file in `assets/products/`, named for its ID. The
index, `assets/products/index.json`, lists every product and names the default:
Comfort Colors 1717. Files are checked against
`assets/schemas/product.schema.json`.

```ts
import { defaultProduct, loadProduct } from "@thesnug/color-picker/data";

defaultProduct();                  // Comfort Colors 1717
loadProduct("comfort-colors-1717");
```

To add a product:

1. Create `assets/products/<id>.json`, where `<id>` is a lowercase slug such as
   `gildan-5000`. Start with `"$schema": "../schemas/product.schema.json"` so
   editors validate as you type. Fill in `id` (matching the file name), `brand`,
   `model`, `name`, `printMethod`, and `printAreas` (position, width and height in
   inches).
2. Add `{ "id": "<id>", "name": "<display name>" }` to `products` in
   `assets/products/index.json`.
3. Add colors. Each carries `source` (`printify`, `retail-chart:<name>`, or
   `reviewed`) and a `sourceDate`. Colors the provider does not stock get
   `"available": false`. Garment images are referenced by `image.url` and
   `image.sha256`, never stored in the repo. Never overwrite a `reviewed` color
   from an import.
4. Run `npm run products:check`. It fails on schema errors, duplicate slugs, a
   `reviewed` color without a date, or a file missing from the index. CI runs it
   too.

```bash
npm run products:check  # validate assets/products/
```

## License

MIT.
