import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../", import.meta.url));

describe("Jev report output", () => {
  it("refuses a rerun over a report with hand-written decisions before calling Jev", () => {
    const dir = mkdtempSync(join(tmpdir(), "jev-report-"));
    const out = join(dir, "2026-09-24.md");
    try {
      copyFileSync(join(root, "docs/evaluations/2026-09-24.md"), out);
      const original = readFileSync(out, "utf8");
      expect(original).toContain("## Findings and decisions");
      const env = { ...process.env };
      delete env.TYPESAFE_API_KEY;
      // Use the normal command with all features. It must fail on the output
      // preflight rather than attempting an uncached API request.
      const run = spawnSync("npm", ["run", "jev:evaluate", "--", "--out", out], {
        cwd: root,
        env,
        encoding: "utf8",
      });
      expect(run.status).not.toBe(0);
      expect(run.stderr).toContain("Report already exists:");
      expect(readFileSync(out, "utf8")).toBe(original);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
