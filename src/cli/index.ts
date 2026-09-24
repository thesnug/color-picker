/**
 * `color-picker` CLI.
 *
 * Uses only Node built-ins (`node:util` parseArgs) so the binary adds no
 * dependencies to the package. See docs/DESIGN.md, "Architecture".
 *
 * Exit codes: 0 on success, 1 for input that cannot be resolved (an unknown
 * name, a malformed hex, an unknown combination ID), 2 for usage errors.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";

import { DEFAULT_NEAREST_K } from "../nearest.js";
import { escapeXml, renderHtml } from "../render/index.js";
import {
  combosView,
  InputError,
  nearestView,
  showView,
  type ThemeFormat,
  themeView,
  type View,
} from "./commands.js";

export interface CliIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  /** Emit terminal color codes. Defaults to true on a TTY unless `NO_COLOR` is set. */
  color?: boolean;
  /** Write an output file. Defaults to `fs.writeFileSync`. */
  writeFile?: (path: string, contents: string) => void;
}

const defaultIo: CliIo = {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  color: Boolean(process.stdout.isTTY) && !process.env.NO_COLOR,
  writeFile: (path, contents) => writeFileSync(path, contents),
};

/** The package version, read from package.json at runtime. */
export function packageVersion(): string {
  const url = new URL("../../package.json", import.meta.url);
  const pkg = JSON.parse(readFileSync(url, "utf8")) as { version: string };
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
  theme <hex|name|id>         A web theme: background, surface, text, muted
                              text, accent, and text on the accent, each pair
                              checked against WCAG AA. A bare number is a
                              combination ID; write hex with # (#123).

Command options:
  -k <n>                      nearest: number of matches (default ${DEFAULT_NEAREST_K})
  --size <n>                  combos: only palettes with n colors
  --limit <n>                 combos: maximum palettes (default ${DEFAULT_COMBOS_LIMIT})
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
  --product <id>              Work against a garment product's colors
  --check                     Run accessibility checks on each palette

Options:
  -h, --help                  Show this help and exit
  -v, --version               Print the package version and exit

Names are Wada names, CSS color names, or xkcd survey names. Quote names with
spaces: color-picker combos "hermosa pink"

Exit codes: 0 success, 1 unknown name, malformed hex, or unknown ID,
2 usage error. See https://github.com/thesnug/color-picker
`;

const COMMANDS = ["nearest", "combos", "show", "theme"] as const;
type Command = (typeof COMMANDS)[number];

const RESERVED = ["product", "check"] as const;

class UsageError extends Error {}

/**
 * Run the CLI against an argument list (without the node and script entries).
 * Returns the process exit code instead of exiting, so it can be tested.
 */
export function run(argv: readonly string[], io: CliIo = defaultIo): number {
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
        format: { type: "string" },
        mode: { type: "string" },
        json: { type: "boolean" },
        svg: { type: "string" },
        html: { type: "string" },
        product: { type: "string" },
        check: { type: "boolean" },
      },
      allowPositionals: true,
    });
  } catch (error) {
    return usage(io, (error as Error).message);
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

  const [command, ...args] = positionals as [string, ...string[]];
  if (!COMMANDS.includes(command as Command)) {
    return usage(io, `unknown command ${JSON.stringify(command)}`);
  }

  let view: View;
  try {
    for (const flag of RESERVED) {
      if (values[flag] !== undefined) {
        throw new UsageError(`--${flag} is coming in the products milestone and is not yet available`);
      }
    }
    if (values.json && values.format !== undefined) {
      throw new UsageError("--json and --format both choose the printed output; use one");
    }
    view = buildView(command as Command, args, values);
  } catch (error) {
    if (error instanceof UsageError) return usage(io, error.message);
    if (error instanceof InputError) {
      io.stderr(`color-picker: ${error.message}\n`);
      return 1;
    }
    throw error;
  }

  const write = io.writeFile ?? defaultIo.writeFile!;
  try {
    if (values.svg !== undefined) {
      const svgs = view.sections.flatMap((s) => (s.svg ? [s.svg] : []));
      write(values.svg, stackSvg(svgs, view.title));
      io.stderr(`Wrote ${values.svg}\n`);
    }
    if (values.html !== undefined) {
      write(values.html, renderHtml(view.sections, { title: view.title }));
      io.stderr(`Wrote ${values.html}\n`);
    }
  } catch (error) {
    io.stderr(`color-picker: ${(error as Error).message}\n`);
    return 1;
  }

  io.stdout(
    values.json ? `${JSON.stringify(view.json, null, 2)}\n` : view.text(io.color ?? false),
  );
  return 0;
}

function buildView(
  command: Command,
  args: string[],
  values: { k?: string; size?: string; limit?: string; format?: string; mode?: string },
): View {
  const only = (flag: "k" | "size" | "limit" | "format" | "mode", allowed: Command) => {
    if (values[flag] !== undefined && command !== allowed) {
      const name = flag === "k" ? "-k" : `--${flag}`;
      throw new UsageError(`${name} applies only to ${allowed}`);
    }
  };
  only("k", "nearest");
  only("size", "combos");
  only("limit", "combos");
  only("format", "theme");
  only("mode", "theme");

  if (command === "show") {
    if (args.length === 0) throw new UsageError("show needs at least one combination ID");
    return showView(args.map((a) => positiveInt(a, "combination ID")));
  }

  if (args.length !== 1) {
    throw new UsageError(
      args.length === 0
        ? `${command} needs a hex code or color name${command === "theme" ? ", or a combination ID" : ""}`
        : `${command} takes one color; quote names with spaces`,
    );
  }
  const query = args[0]!;
  if (command === "theme") {
    return themeView({
      query,
      mode: oneOf(values.mode, "--mode", ["light", "dark"] as const) ?? "light",
      ...(values.format !== undefined && {
        format: oneOf(values.format, "--format", ["css", "tailwind", "tokens"] as const) as ThemeFormat,
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

function oneOf<T extends string>(value: string | undefined, flag: string, allowed: readonly T[]): T | undefined {
  if (value === undefined) return undefined;
  if (!allowed.includes(value as T)) {
    throw new UsageError(`${flag} must be one of ${allowed.join(", ")}, got ${JSON.stringify(value)}`);
  }
  return value as T;
}

function optionalInt(value: string | undefined, flag: string): number | undefined {
  return value === undefined ? undefined : positiveInt(value, flag, UsageError);
}

function positiveInt(
  value: string,
  what: string,
  Err: new (message: string) => Error = InputError,
): number {
  const n = Number(value);
  if (!/^\d+$/.test(value) || !(n > 0)) {
    throw new Err(`${what} must be a positive integer, got ${JSON.stringify(value)}`);
  }
  return n;
}

function usage(io: CliIo, message: string): number {
  io.stderr(`color-picker: ${message}\n\nRun color-picker --help for usage.\n`);
  return 2;
}

/**
 * Stack SVG documents vertically into one. Each renderer's SVG opens with its
 * `width` and `height`, which set the offsets.
 */
export function stackSvg(svgs: readonly string[], label: string, gap = 24): string {
  if (svgs.length === 1) return svgs[0]!;
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
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
    `viewBox="0 0 ${width} ${height}" role="img" aria-label="${title}">` +
    `<title>${title}</title>${parts.join("")}</svg>`
  );
}
