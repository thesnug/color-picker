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
export interface CliIo {
    stdout: (text: string) => void;
    stderr: (text: string) => void;
    /** Emit terminal color codes. Defaults to true on a TTY unless `NO_COLOR` is set. */
    color?: boolean;
    /** Write an output file. Defaults to `fs.writeFileSync`. */
    writeFile?: (path: string, contents: string) => void;
    /** Inline the garment photos in a written card. Defaults to `embedImages`. */
    embedImages?: (markup: string) => Promise<string>;
}
/** The package version, read from package.json at runtime. */
export declare function packageVersion(): string;
/** Default `--limit` for `combos`. */
export declare const DEFAULT_COMBOS_LIMIT = 8;
export declare const HELP = "Usage: color-picker <command> [options]\n\nPalettes from Sanzo Wada's A Dictionary of Color Combinations, and garment\ncolor recommendations for print-on-demand designs.\n\nCommands:\n  nearest <hex|name>          The closest Wada colors\n  combos <hex|name>           Ranked palettes: the book's combinations, then\n                              harmonies snapped to Wada colors\n  show <combination-id...>    Specific book combinations, 1 to 348\n  palettes <product-color>    Ranked palettes for a garment color by name,\n                              the garment first, then the ink colors\n  recommend <design>          Garment colors for a PNG, WebP, or JPEG design,\n                              printed as is\n  recolor <design>            Garment colors for a design with recoloring:\n                              a Wada combination per garment, the from-to\n                              color mapping, and a prompt for the recolor\n  theme <hex|name|id>         A web theme: background, surface, text, muted\n                              text, accent, and text on the accent, each pair\n                              checked against WCAG AA. A bare number is a\n                              combination ID; write hex with # (#123).\n\nCommand options:\n  -k <n>                      nearest: number of matches (default 3)\n  --size <n>                  combos, palettes: only palettes with n colors\n  --limit <n>                 combos, palettes: maximum palettes (default 8)\n  -n <n>                      recommend, recolor: number of picks (default 5)\n  --product <id>              recommend, recolor, palettes: garment product\n                              (default Comfort Colors 1717)\n  --apply <dir>               recolor: write each recolored design as a PNG in\n                              dir; flat-color art only\n  --mood                      recommend, palettes: re-rank the top 10 by how\n                              well each suits the design's subject and mood,\n                              with Jev (needs TYPESAFE_API_KEY and a vision\n                              provider; without them the order is unchanged\n                              and the output says why)\n  --design <file>             palettes: the design to judge with --mood\n  --vet                       recolor: describe the design and check with Jev\n                              that each swap keeps the subject recognizable;\n                              implausible plans are dropped and replaced by\n                              the next garments. Needs the Codex CLI or\n                              OPENROUTER_API_KEY, and TYPESAFE_API_KEY\n  --include-implausible       recolor, with --vet: keep implausible plans,\n                              marked, instead of dropping them\n  --format <css|tailwind|tokens>\n                              theme: print CSS custom properties, a Tailwind v4\n                              @theme block, or W3C design tokens (JSON)\n  --mode <light|dark>         theme: light (default) or dark\n\nOutput options (any command):\n  --json                      Print the result as JSON instead of text\n  --svg <path>                Write the swatches as an SVG file\n  --html <path>               Write a self-contained HTML review page; for\n                              theme, a sample UI in light and dark mode\n\nComing in the products milestone (reserved, not yet available):\n  --check                     Run accessibility checks on each palette\n\nOptions:\n  -h, --help                  Show this help and exit\n  -v, --version               Print the package version and exit\n\nNames are Wada names, CSS color names, or xkcd survey names. Quote names with\nspaces: color-picker combos \"hermosa pink\". Product colors are names, slugs, or\naliases from the product file: color-picker palettes \"Blue Spruce\"\n\nExit codes: 0 success, 1 unknown name or product color, malformed hex, unknown ID or product,\nan unreadable design file, or a theme with no legible text and background,\n2 usage error. See https://github.com/thesnug/color-picker\n";
/**
 * Run the CLI against an argument list (without the node and script entries).
 * Resolves to the process exit code instead of exiting, so it can be tested.
 */
export declare function run(argv: readonly string[], io?: CliIo): Promise<number>;
/**
 * Stack SVG documents vertically into one. Each renderer's SVG opens with its
 * `width` and `height`, which set the offsets.
 */
export declare function stackSvg(svgs: readonly string[], label: string, gap?: number): string;
//# sourceMappingURL=index.d.ts.map