import { describe, expect, it } from "vitest";

import { HELP, packageVersion, run, stackSvg } from "../src/cli/index.js";

function capture(color = false) {
  const out: string[] = [];
  const err: string[] = [];
  const files = new Map<string, string>();
  return {
    io: {
      stdout: (t: string) => out.push(t),
      stderr: (t: string) => err.push(t),
      color,
      writeFile: (path: string, contents: string) => files.set(path, contents),
    },
    out: () => out.join(""),
    err: () => err.join(""),
    files,
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

  describe("nearest", () => {
    it("lists the closest Wada colors for a hex", () => {
      const c = capture();
      expect(run(["nearest", "#c0737a"], c.io)).toBe(0);
      const lines = c.out().trim().split("\n");
      expect(lines[0]).toBe("Nearest Wada colors to #c0737a");
      expect(lines.slice(2)).toHaveLength(3);
      expect(lines[2]).toContain("Light Brown Drab");
    });

    it("takes -k and resolves names", () => {
      const c = capture();
      expect(run(["nearest", "dusty rose", "-k", "5"], c.io)).toBe(0);
      expect(c.out()).toContain("(xkcd #c0737a)");
      expect(c.out().trim().split("\n").slice(2)).toHaveLength(5);
    });

    it("prints truecolor blocks when color is on", () => {
      const c = capture(true);
      run(["nearest", "#c0737a"], c.io);
      expect(c.out()).toContain("\u001b[48;2;");
    });

    it("prints the library result as JSON", () => {
      const c = capture();
      expect(run(["nearest", "red", "--json"], c.io)).toBe(0);
      const json = JSON.parse(c.out());
      expect(json.resolved).toMatchObject({ via: "wada", name: "Red" });
      expect(json.matches[0].color.name).toBe("Red");
    });
  });

  describe("combos", () => {
    it("lists book palettes with their detail", () => {
      const c = capture();
      expect(run(["combos", "hermosa pink", "--size", "3", "--limit", "2"], c.io)).toBe(0);
      expect(c.out()).toContain("Anchor: Hermosa Pink #ffb3f0 (distance 0)");
      expect(c.out()).toMatch(/Combination 176 · via Hermosa Pink · score/);
      expect(c.out().match(/^Combination /gm)).toHaveLength(2);
    });

    it("notes a neutral anchor", () => {
      const c = capture();
      run(["combos", "#808080", "--limit", "1"], c.io);
      expect(c.out()).toContain("(nearest neutral, distance");
    });

    it("reports when no palette matches the options", () => {
      const c = capture();
      expect(run(["combos", "#c0737a", "--size", "1"], c.io)).toBe(0);
      expect(c.out()).toContain("No palettes for Light Brown Drab");
    });
  });

  describe("show", () => {
    it("renders book combinations by ID", () => {
      const c = capture();
      expect(run(["show", "176", "227"], c.io)).toBe(0);
      expect(c.out()).toContain("Combination 176 · split-complementary");
      expect(c.out()).toContain("Combination 227");
      expect(c.out()).toContain("Cerulian Blue");
    });

    it("prints combinations with their colors as JSON", () => {
      const c = capture();
      run(["show", "176", "--json"], c.io);
      const json = JSON.parse(c.out());
      expect(json.combinations[0].combination.id).toBe(176);
      expect(json.combinations[0].colors).toHaveLength(3);
    });
  });

  describe("file output", () => {
    it("writes one stacked SVG and an HTML page", () => {
      const c = capture();
      expect(run(["combos", "#c0737a", "--limit", "3", "--svg", "a.svg", "--html", "a.html"], c.io)).toBe(0);
      const svg = c.files.get("a.svg")!;
      expect(svg.startsWith("<svg")).toBe(true);
      expect(svg.match(/<svg /g)).toHaveLength(4);
      expect(svg).toContain("<title>Combinations for #c0737a</title>");
      const html = c.files.get("a.html")!;
      expect(html).toContain("<title>Combinations for #c0737a</title>");
      expect(html).toContain("via Light Brown Drab · score");
      expect(c.err()).toContain("Wrote a.svg");
      expect(c.out()).toContain("Anchor:");
    });

    it("writes a single SVG unchanged", () => {
      const c = capture();
      run(["nearest", "red", "--svg", "n.svg"], c.io);
      expect(c.files.get("n.svg")!.match(/<svg /g)).toHaveLength(1);
    });

    it("stacks SVGs by their heights", () => {
      const a = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="40"></svg>';
      const b = '<svg xmlns="http://www.w3.org/2000/svg" width="60" height="30"></svg>';
      const out = stackSvg([a, b], "A & B", 10);
      expect(out).toContain('width="100" height="80"');
      expect(out).toContain('<svg x="0" y="50" ');
      expect(out).toContain("<title>A &amp; B</title>");
    });
  });

  describe("errors", () => {
    it.each([
      [["nearest", "#12345"], 'malformed hex "#12345"'],
      [["nearest", "c0737"], 'malformed hex "c0737"'],
      [["combos", "blorp"], 'Unknown color name "blorp"'],
      [["show", "999"], "unknown combination 999"],
      [["show", "abc"], 'combination ID must be a positive integer, got "abc"'],
    ])("exits 1 for %j", (argv, message) => {
      const c = capture();
      expect(run(argv, c.io)).toBe(1);
      expect(c.err()).toContain(message);
      expect(c.out()).toBe("");
    });

    it.each([
      [["nearest"], "nearest needs a hex code or color name"],
      [["nearest", "hermosa", "pink"], "quote names with spaces"],
      [["show"], "show needs at least one combination ID"],
      [["nearest", "red", "-k", "0"], '-k must be a positive integer, got "0"'],
      [["combos", "red", "--limit", "2.5"], "--limit must be a positive integer"],
      [["nearest", "red", "--size", "3"], "--size applies only to combos"],
      [["combos", "red", "-k", "3"], "-k applies only to nearest"],
      [["combos", "red", "--product", "comfort-colors-1717"], "--product is coming in the products milestone"],
      [["combos", "red", "--check"], "--check is coming in the products milestone"],
      [["nearest", "red", "--bogus"], "Unknown option '--bogus'"],
    ])("exits 2 for %j", (argv, message) => {
      const c = capture();
      expect(run(argv, c.io)).toBe(2);
      expect(c.err()).toContain(message);
    });
  });
});
