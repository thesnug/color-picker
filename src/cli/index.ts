/**
 * `color-picker` CLI.
 *
 * Uses only Node built-ins so the binary adds no dependencies to the package.
 * Commands arrive in later issues; the scaffold answers `--help` and `--version`.
 */

import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

export interface CliIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

const defaultIo: CliIo = {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
};

/** The package version, read from package.json at runtime. */
export function packageVersion(): string {
  const url = new URL("../../package.json", import.meta.url);
  const pkg = JSON.parse(readFileSync(url, "utf8")) as { version: string };
  return pkg.version;
}

export const HELP = `Usage: color-picker [options]

Palettes from Sanzo Wada's A Dictionary of Color Combinations, and garment
color recommendations for print-on-demand designs.

Options:
  -h, --help     Show this help and exit
  -v, --version  Print the package version and exit

Commands arrive in later releases. See https://github.com/thesnug/color-picker
`;

/**
 * Run the CLI against an argument list (without the node and script entries).
 * Returns the process exit code instead of exiting, so it can be tested.
 */
export function run(argv: readonly string[], io: CliIo = defaultIo): number {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args: [...argv],
      options: {
        help: { type: "boolean", short: "h" },
        version: { type: "boolean", short: "v" },
      },
      allowPositionals: true,
    });
  } catch (error) {
    io.stderr(`color-picker: ${(error as Error).message}\n\n${HELP}`);
    return 2;
  }

  if (parsed.values.version) {
    io.stdout(`${packageVersion()}\n`);
    return 0;
  }
  if (parsed.values.help || parsed.positionals.length === 0) {
    io.stdout(HELP);
    return 0;
  }

  io.stderr(`color-picker: unknown command ${JSON.stringify(parsed.positionals[0])}\n\n${HELP}`);
  return 2;
}
