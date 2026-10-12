import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { specifiers, walkClosure } from "../../scripts/check-engine-purity.js";

const ROOT = join(import.meta.dirname, "..", "..");

describe("the engine entry point", () => {
  it("imports only relative modules, never node: built-ins or packages, and reads no files", () => {
    const { files, problems } = walkClosure(join(ROOT, "src", "engine", "index.ts"), "src");
    expect(problems).toEqual([]);
    expect(files).toEqual(expect.arrayContaining(["src/engine/index.ts", "src/data/store.ts", "src/data/generated/products.ts"]));
    // The file-reading loaders and the decoders stay outside it.
    for (const outside of ["src/data/index.ts", "src/fingerprint/index.ts", "src/jev/index.ts", "src/mcp/tools.ts"]) {
      expect(files).not.toContain(outside);
    }
  });

  it("finds every kind of import a vendoring consumer would follow", () => {
    expect(
      specifiers(
        [
          'import { a } from "./a.js";',
          'import type { B } from "./b.js";',
          'export * from "./c.js";',
          'export { d } from "./d.js";',
          'import "./e.js";',
          'type F = import("./f.js").F;',
          "import {\n  g,\n  h,\n} from \"node:fs\";",
        ].join("\n"),
      ).sort(),
    ).toEqual(["./a.js", "./b.js", "./c.js", "./d.js", "./e.js", "./f.js", "node:fs"]);
  });

  it("would reject a module that reaches outside", () => {
    const report = walkClosure(join(ROOT, "src", "data", "index.ts"), "src");
    expect(report.problems).toEqual(
      expect.arrayContaining([
        'src/data/index.ts imports "node:fs", outside the package',
        "src/data/index.ts uses readFileSync",
        "src/data/index.ts uses import.meta",
      ]),
    );
  });
});
