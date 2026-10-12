/**
 * `color-picker` CLI.
 *
 * Uses only Node built-ins (`node:util` parseArgs) so the binary adds no
 * dependencies to the package. See docs/DESIGN.md, "Architecture".
 *
 * Exit codes: 0 on success, 1 for input that cannot be resolved (an unknown
 * name, a malformed hex, an unknown combination ID, a theme with no legible
 * text and background), 2 for usage errors.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { basename, extname } from "node:path";
import { parseArgs } from "node:util";
import { MOOD_TOP } from "../jev/mood.js";
import { DEFAULT_NEAREST_K } from "../nearest.js";
import { escapeXml, renderHtml } from "../render/index.js";
import { artworkOptionsView, combosView, DEFAULT_COLOR_COUNT, DEFAULT_RECOLOR_N, DEFAULT_RECOMMEND_N, InputError, legibilityView, nearestView, pairsView, palettesView, recolorView, recommendView, showView, themeView, } from "./commands.js";
import { embedImages, embedWarning } from "./embed.js";
const defaultIo = {
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
    color: Boolean(process.stdout.isTTY) && !process.env.NO_COLOR,
    writeFile: (path, contents) => writeFileSync(path, contents),
    embedImages: (markup) => embedImages(markup),
};
/** The package version, read from package.json at runtime. */
export function packageVersion() {
    const url = new URL("../../package.json", import.meta.url);
    const pkg = JSON.parse(readFileSync(url, "utf8"));
    return pkg.version;
}
/** Default `--limit` for `combos`. */
export const DEFAULT_COMBOS_LIMIT = 8;
export const HELP = `Usage: color-picker <command> [options]

Palettes from Sanzo Wada's A Dictionary of Color Combinations, and garment
color recommendations for print-on-demand designs.

Commands:
  nearest <hex|name>          The closest Wada colors
  combos <hex|name>           Ranked palettes: the book's combinations, then
                              harmonies snapped to Wada colors
  show <combination-id...>    Specific book combinations, 1 to 348
  palettes <product-color>    Ranked palettes for a garment color by name,
                              the garment first, then the ink colors
  recommend <design>          Garment colors for a PNG, WebP, or JPEG design,
                              printed as is: those its ink reads on first
  legibility <design>         Whether the design's ink reads on each garment
                              color (the ink-legibility-v2 verdict)
  recolor <design>            Garment colors for a design with recoloring:
                              a Wada combination per garment, the from-to
                              color mapping, and a prompt for the recolor
  options <design>            Artwork options: pigment substitutions that make
                              the design read on garments it fails
  pairs <design>              The order POD's Creative color study inspects
                              artwork and garment pairs in, for the design
                              (artwork "original") and any --option files
  theme <hex|name|id>         A web theme: background, surface, text, muted
                              text, accent, and text on the accent, each pair
                              checked against WCAG AA. A bare number is a
                              combination ID; write hex with # (#123).

Command options:
  -k <n>                      nearest: number of matches (default ${DEFAULT_NEAREST_K})
  --size <n>                  combos, palettes: only palettes with n colors
  --limit <n>                 combos, palettes: maximum palettes (default ${DEFAULT_COMBOS_LIMIT})
  -n <n>                      recommend, recolor: number of picks (default ${DEFAULT_RECOMMEND_N})
  --product <id>              recommend, recolor, palettes, legibility, options,
                              pairs: garment product (default Comfort Colors 1717)
  --colors <a,b,...>          recommend, legibility, options, pairs: only these
                              product colors, by name, slug, or alias
  --bounds <x,y,w,h>          recommend, recolor, legibility, options, pairs:
                              the print's visible content as fractions of the
                              canvas, to measure it as POD does
  --count <n>                 options, pairs: garment colors the assortment
                              wants (default ${DEFAULT_COLOR_COUNT})
  --option <source>:<file>    pairs: an Artwork Option's print file, named by
                              its file name without the extension; source is
                              legible-ink or wada. Repeat for each option
  --preferred <color>         pairs: a product color to place first when any
                              artwork reads on it
  --apply <dir>               recolor, options: write each recolored design as
                              a PNG in dir; flat-color art only
  --mood                      recommend, palettes: re-rank the top ${MOOD_TOP} by how
                              well each suits the design's subject and mood,
                              with Jev (needs TYPESAFE_API_KEY and a vision
                              provider; without them the order is unchanged
                              and the output says why)
  --design <file>             palettes: the design to judge with --mood
  --vet                       recolor: describe the design and check with Jev
                              that each swap keeps the subject recognizable;
                              implausible plans are dropped and replaced by
                              the next garments. Needs the Codex CLI or
                              OPENROUTER_API_KEY, and TYPESAFE_API_KEY
  --include-implausible       recolor, with --vet: keep implausible plans,
                              marked, instead of dropping them
  --format <css|tailwind|tokens>
                              theme: print CSS custom properties, a Tailwind v4
                              @theme block, or W3C design tokens (JSON)
  --mode <light|dark>         theme: light (default) or dark

Output options (any command):
  --json                      Print the result as JSON instead of text
  --svg <path>                Write the swatches as an SVG file
  --html <path>               Write a self-contained HTML review page; for
                              theme, a sample UI in light and dark mode

Coming in the products milestone (reserved, not yet available):
  --check                     Run accessibility checks on each palette

Options:
  -h, --help                  Show this help and exit
  -v, --version               Print the package version and exit

Names are Wada names, CSS color names, or xkcd survey names. Quote names with
spaces: color-picker combos "hermosa pink". Product colors are names, slugs, or
aliases from the product file: color-picker palettes "Blue Spruce"

Exit codes: 0 success, 1 unknown name or product color, malformed hex, unknown ID or product,
an unreadable design file, or a theme with no legible text and background,
2 usage error. See https://github.com/thesnug/color-picker
`;
const COMMANDS = ["nearest", "combos", "show", "palettes", "recommend", "legibility", "recolor", "options", "pairs", "theme"];
const RESERVED = ["check"];
class UsageError extends Error {
}
/**
 * Run the CLI against an argument list (without the node and script entries).
 * Resolves to the process exit code instead of exiting, so it can be tested.
 */
export async function run(argv, io = defaultIo) {
    let parsed;
    try {
        parsed = parseArgs({
            args: [...argv],
            options: {
                help: { type: "boolean", short: "h" },
                version: { type: "boolean", short: "v" },
                k: { type: "string", short: "k" },
                size: { type: "string" },
                limit: { type: "string" },
                n: { type: "string", short: "n" },
                format: { type: "string" },
                mode: { type: "string" },
                json: { type: "boolean" },
                svg: { type: "string" },
                html: { type: "string" },
                product: { type: "string" },
                colors: { type: "string" },
                bounds: { type: "string" },
                count: { type: "string" },
                option: { type: "string", multiple: true },
                preferred: { type: "string" },
                apply: { type: "string" },
                mood: { type: "boolean" },
                design: { type: "string" },
                vet: { type: "boolean" },
                "include-implausible": { type: "boolean" },
                check: { type: "boolean" },
            },
            allowPositionals: true,
        });
    }
    catch (error) {
        return usage(io, error.message);
    }
    const { values, positionals } = parsed;
    if (values.version) {
        io.stdout(`${packageVersion()}\n`);
        return 0;
    }
    if (values.help || positionals.length === 0) {
        io.stdout(HELP);
        return 0;
    }
    const [command, ...args] = positionals;
    if (!COMMANDS.includes(command)) {
        return usage(io, `unknown command ${JSON.stringify(command)}`);
    }
    let view;
    try {
        for (const flag of RESERVED) {
            if (values[flag] !== undefined) {
                throw new UsageError(`--${flag} is coming in the products milestone and is not yet available`);
            }
        }
        if (values.json && values.format !== undefined) {
            throw new UsageError("--json and --format both choose the printed output; use one");
        }
        view = await buildView(command, args, values);
    }
    catch (error) {
        if (error instanceof UsageError)
            return usage(io, error.message);
        if (error instanceof InputError) {
            io.stderr(`color-picker: ${error.message}\n`);
            return 1;
        }
        throw error;
    }
    const write = io.writeFile ?? defaultIo.writeFile;
    const embedImagesIn = io.embedImages ?? defaultIo.embedImages;
    /** Inline a card's photos, warning on stderr about any that keep their URLs. */
    const embed = async (markup) => {
        const result = await embedImagesIn(markup);
        const warning = embedWarning(result);
        if (warning)
            io.stderr(`color-picker: ${warning}\n`);
        return result.markup;
    };
    try {
        if (values.svg !== undefined) {
            const svgs = view.sections.flatMap((s) => (s.svg ? [s.svg] : []));
            write(values.svg, await embed(stackSvg(svgs, view.title)));
            io.stderr(`Wrote ${values.svg}\n`);
        }
        if (values.html !== undefined) {
            write(values.html, await embed(renderHtml(view.sections, { title: view.title })));
            io.stderr(`Wrote ${values.html}\n`);
        }
    }
    catch (error) {
        io.stderr(`color-picker: ${error.message}\n`);
        return 1;
    }
    io.stdout(values.json ? `${JSON.stringify(view.json, null, 2)}\n` : view.text(io.color ?? false));
    return 0;
}
async function buildView(command, args, values) {
    const only = (flag, ...allowed) => {
        if (values[flag] !== undefined && !allowed.includes(command)) {
            const name = flag.length === 1 ? `-${flag}` : `--${flag}`;
            const list = allowed.length <= 2 ? allowed.join(" and ") : `${allowed.slice(0, -1).join(", ")}, and ${allowed.at(-1)}`;
            throw new UsageError(`${name} applies only to ${list}`);
        }
    };
    only("k", "nearest");
    only("size", "combos", "palettes");
    only("limit", "combos", "palettes");
    only("n", "recommend", "recolor");
    only("product", "recommend", "recolor", "palettes", "legibility", "options", "pairs");
    only("colors", "recommend", "legibility", "options", "pairs");
    only("bounds", "recommend", "recolor", "legibility", "options", "pairs");
    only("count", "options", "pairs");
    only("option", "pairs");
    only("preferred", "pairs");
    only("apply", "recolor", "options");
    only("mood", "recommend", "palettes");
    only("design", "palettes");
    only("vet", "recolor");
    only("include-implausible", "recolor");
    if (values["include-implausible"] && !values.vet) {
        throw new UsageError("--include-implausible applies only with --vet");
    }
    only("format", "theme");
    only("mode", "theme");
    if (command === "show") {
        if (args.length === 0)
            throw new UsageError("show needs at least one combination ID");
        return showView(args.map((a) => positiveInt(a, "combination ID")));
    }
    const designOptions = () => ({
        ...(values.product !== undefined && { product: values.product }),
        ...(values.colors !== undefined && { colors: colorList(values.colors) }),
        ...(values.bounds !== undefined && { contentBounds: bounds(values.bounds) }),
    });
    if (command === "recommend") {
        if (args.length !== 1)
            throw new UsageError("recommend takes one design file");
        return recommendView({
            file: args[0],
            n: optionalInt(values.n, "-n") ?? DEFAULT_RECOMMEND_N,
            ...designOptions(),
            ...(values.mood && { mood: true }),
        });
    }
    if (command === "legibility") {
        if (args.length !== 1)
            throw new UsageError("legibility takes one design file");
        return legibilityView({ file: args[0], ...designOptions() });
    }
    if (command === "options") {
        if (args.length !== 1)
            throw new UsageError("options takes one design file");
        const count = optionalInt(values.count, "--count");
        return artworkOptionsView({
            file: args[0],
            ...designOptions(),
            ...(count !== undefined && { colorCount: count }),
            ...(values.apply !== undefined && { apply: values.apply }),
        });
    }
    if (command === "pairs") {
        if (args.length !== 1)
            throw new UsageError("pairs takes one design file; give Artwork Options with --option");
        const count = optionalInt(values.count, "--count");
        const contentBounds = values.bounds !== undefined ? bounds(values.bounds) : null;
        return pairsView({
            artworks: [
                { artworkId: "original", file: args[0], source: "original", contentBounds },
                ...(values.option ?? []).map((value) => ({ ...artworkOption(value), contentBounds })),
            ],
            ...(values.product !== undefined && { product: values.product }),
            ...(values.colors !== undefined && { colors: colorList(values.colors) }),
            ...(count !== undefined && { colorCount: count }),
            ...(values.preferred !== undefined && { preferred: values.preferred }),
        });
    }
    if (command === "recolor") {
        if (args.length !== 1)
            throw new UsageError("recolor takes one design file");
        return recolorView({
            file: args[0],
            n: optionalInt(values.n, "-n") ?? DEFAULT_RECOLOR_N,
            ...(values.product !== undefined && { product: values.product }),
            ...(values.bounds !== undefined && { contentBounds: bounds(values.bounds) }),
            ...(values.apply !== undefined && { apply: values.apply }),
            ...(values.vet && { vet: true }),
            ...(values["include-implausible"] && { includeImplausible: true }),
        });
    }
    if (command === "palettes") {
        if (args.length !== 1) {
            throw new UsageError(args.length === 0 ? "palettes needs a product color name" : "palettes takes one color; quote names with spaces");
        }
        if (values.mood && values.design === undefined)
            throw new UsageError("palettes --mood needs --design <file>");
        if (values.design !== undefined && !values.mood)
            throw new UsageError("--design applies only with --mood");
        const size = optionalInt(values.size, "--size");
        return palettesView({
            name: args[0],
            limit: optionalInt(values.limit, "--limit") ?? DEFAULT_COMBOS_LIMIT,
            ...(size !== undefined && { size }),
            ...(values.product !== undefined && { product: values.product }),
            ...(values.mood && values.design !== undefined && { mood: true, design: { file: values.design } }),
        });
    }
    if (args.length !== 1) {
        throw new UsageError(args.length === 0
            ? `${command} needs a hex code or color name${command === "theme" ? ", or a combination ID" : ""}`
            : `${command} takes one color; quote names with spaces`);
    }
    const query = args[0];
    if (command === "theme") {
        return themeView({
            query,
            mode: oneOf(values.mode, "--mode", ["light", "dark"]) ?? "light",
            ...(values.format !== undefined && {
                format: oneOf(values.format, "--format", ["css", "tailwind", "tokens"]),
            }),
        });
    }
    if (command === "nearest") {
        return nearestView({ query, k: optionalInt(values.k, "-k") ?? DEFAULT_NEAREST_K });
    }
    const size = optionalInt(values.size, "--size");
    return combosView({
        query,
        limit: optionalInt(values.limit, "--limit") ?? DEFAULT_COMBOS_LIMIT,
        ...(size !== undefined && { size }),
    });
}
function oneOf(value, flag, allowed) {
    if (value === undefined)
        return undefined;
    if (!allowed.includes(value)) {
        throw new UsageError(`${flag} must be one of ${allowed.join(", ")}, got ${JSON.stringify(value)}`);
    }
    return value;
}
/** `--option wada:out/wada-b246-e12-i3-v1.png`: an Artwork Option's source and print file. */
function artworkOption(value) {
    const colon = value.indexOf(":");
    const source = value.slice(0, colon);
    const file = value.slice(colon + 1);
    if (colon < 1 || !file || (source !== "legible-ink" && source !== "wada")) {
        throw new UsageError(`--option must be legible-ink:<file> or wada:<file>, got ${JSON.stringify(value)}`);
    }
    return { artworkId: basename(file, extname(file)), file, source };
}
/** `--colors "Black,Blue Jean"`: names separated by commas. */
function colorList(value) {
    const names = value
        .split(",")
        .map((name) => name.trim())
        .filter(Boolean);
    if (names.length === 0)
        throw new UsageError("--colors needs at least one color name");
    return names;
}
/** `--bounds 0.25,0.3,0.5,0.2`: left, top, width, and height as fractions of the canvas. */
function bounds(value) {
    const parts = value.split(",").map((part) => Number(part.trim()));
    const [x, y, w, h] = parts;
    if (parts.length !== 4 || parts.some((p) => !Number.isFinite(p) || p < 0 || p > 1) || w <= 0 || h <= 0) {
        throw new UsageError(`--bounds must be x,y,w,h fractions from 0 to 1 with a positive width and height, got ${JSON.stringify(value)}`);
    }
    return { x, y, w, h };
}
function optionalInt(value, flag) {
    return value === undefined ? undefined : positiveInt(value, flag, UsageError);
}
function positiveInt(value, what, Err = InputError) {
    const n = Number(value);
    if (!/^\d+$/.test(value) || !(n > 0)) {
        throw new Err(`${what} must be a positive integer, got ${JSON.stringify(value)}`);
    }
    return n;
}
function usage(io, message) {
    io.stderr(`color-picker: ${message}\n\nRun color-picker --help for usage.\n`);
    return 2;
}
/**
 * Stack SVG documents vertically into one. Each renderer's SVG opens with its
 * `width` and `height`, which set the offsets.
 */
export function stackSvg(svgs, label, gap = 24) {
    if (svgs.length === 1)
        return svgs[0];
    let y = 0;
    let width = 0;
    const parts = svgs.map((svg) => {
        const w = Number(/\bwidth="([\d.]+)"/.exec(svg)?.[1] ?? 0);
        const h = Number(/\bheight="([\d.]+)"/.exec(svg)?.[1] ?? 0);
        const placed = svg.replace("<svg ", `<svg x="0" y="${y}" `);
        y += h + gap;
        width = Math.max(width, w);
        return placed;
    });
    const height = Math.max(y - gap, 0);
    const title = escapeXml(label);
    return (`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
        `viewBox="0 0 ${width} ${height}" role="img" aria-label="${title}">` +
        `<title>${title}</title>${parts.join("")}</svg>`);
}
//# sourceMappingURL=index.js.map