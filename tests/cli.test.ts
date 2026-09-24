import { describe, expect, it } from "vitest";

import { HELP, packageVersion, run } from "../src/cli/index.js";

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: { stdout: (t: string) => out.push(t), stderr: (t: string) => err.push(t) },
    out: () => out.join(""),
    err: () => err.join(""),
  };
}

describe("cli", () => {
  it("prints the version", () => {
    const c = capture();
    expect(run(["--version"], c.io)).toBe(0);
    expect(c.out().trim()).toBe(packageVersion());
  });

  it("prints help by default", () => {
    const c = capture();
    expect(run([], c.io)).toBe(0);
    expect(c.out()).toBe(HELP);
  });

  it("rejects unknown commands", () => {
    const c = capture();
    expect(run(["nope"], c.io)).toBe(2);
    expect(c.err()).toContain("unknown command");
  });
});
