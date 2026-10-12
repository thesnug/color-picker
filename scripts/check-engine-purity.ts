/**
 * Check that the engine entry point stays pure: its whole import closure
 * (JavaScript and type declarations, as a vendoring consumer copies them)
 * names only relative modules inside the package, never `node:` built-ins or
 * bare packages, and no module reads files or its own URL. POD vendors this
 * closure byte for byte, so anything else would break its build.
 *
 *   npm run engine:purity          # after `npm run build`: walks dist/engine
 *   (tests/engine/purity.test.ts walks src/engine the same way)
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, posix, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Every module specifier a file names: static imports and re-exports, and dynamic or type `import(...)`. */
export function specifiers(source: string): string[] {
  const found = new Set<string>();
  for (const m of source.matchAll(/(?:^|[\s;}])(?:import|export)\s[^;]*?\sfrom\s*["']([^"']+)["']/gm)) found.add(m[1]!);
  for (const m of source.matchAll(/(?:^|[\s;])import\s*["']([^"']+)["']/gm)) found.add(m[1]!);
  for (const m of source.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)) found.add(m[1]!);
  return [...found];
}

/** Code that would reach outside the module graph at run time. */
const FORBIDDEN = [/\breadFileSync\b/, /\breadFile\b/, /\bimport\.meta\b/, /\brequire\(/, /\bprocess\.env\b/];

export interface ClosureReport {
  /** Files visited, relative to the package root. */
  files: string[];
  problems: string[];
}

/**
 * Walk the closure from an entry file. In `src`, `./x.js` specifiers resolve to
 * `./x.ts`; in `dist`, each `.js` file's `.d.ts` is walked as well.
 */
export function walkClosure(entry: string, mode: "src" | "dist"): ClosureReport {
  const files: string[] = [];
  const problems: string[] = [];
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length) {
    const file = queue.shift()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const label = relative(ROOT, file);
    if (!existsSync(file)) {
      problems.push(`${label} does not exist`);
      continue;
    }
    files.push(label);
    const source = readFileSync(file, "utf8");
    for (const pattern of FORBIDDEN) {
      // Comments may mention what the code must not do.
      const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
      if (pattern.test(code)) problems.push(`${label} uses ${pattern.source.replaceAll("\\b", "").replaceAll("\\", "")}`);
    }
    for (const specifier of specifiers(source)) {
      if (!specifier.startsWith(".")) {
        problems.push(`${label} imports ${JSON.stringify(specifier)}, outside the package`);
        continue;
      }
      const target = posix.join(dirname(file), specifier);
      if (mode === "src") queue.push(target.replace(/\.js$/, ".ts"));
      else {
        queue.push(target);
        if (target.endsWith(".js")) queue.push(target.replace(/\.js$/, ".d.ts"));
      }
    }
    if (mode === "dist" && file.endsWith(".js")) queue.push(file.replace(/\.js$/, ".d.ts"));
  }
  return { files, problems };
}

export function main(): number {
  const entry = join(ROOT, "dist", "engine", "index.js");
  if (!existsSync(entry)) {
    process.stderr.write("dist/engine/index.js is missing; run npm run build first.\n");
    return 1;
  }
  const { files, problems } = walkClosure(entry, "dist");
  if (problems.length) {
    process.stderr.write(`The engine closure is not pure:\n${problems.map((p) => `  ${p}`).join("\n")}\n`);
    return 1;
  }
  process.stdout.write(`The engine closure is pure: ${files.length} files, relative imports only.\n`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}
