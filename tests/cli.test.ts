import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { HELP, packageVersion, run, stackSvg } from "../src/cli/index.js";

const FLAT_MARK = join(import.meta.dirname, "fixtures", "designs", "flat-mark.png");
const NAVY_BADGE = join(import.meta.dirname, "fixtures", "designs", "navy-badge.png");

// `recommend` caches fingerprints; keep them out of the real cache directory.
let cacheHome: string;
let savedCacheHome: string | undefined;
beforeAll(() => {
  savedCacheHome = process.env.XDG_CACHE_HOME;
  cacheHome = mkdtempSync(join(tmpdir(), "cli-test-"));
  process.env.XDG_CACHE_HOME = cacheHome;
});
afterAll(() => {
  if (savedCacheHome === undefined) delete process.env.XDG_CACHE_HOME;
  else process.env.XDG_CACHE_HOME = savedCacheHome;
  rmSync(cacheHome, { recursive: true, force: true });
});

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
  it("prints the version", async () => {
    const c = capture();
    expect(await run(["--version"], c.io)).toBe(0);
    expect(c.out().trim()).toBe(packageVersion());
  });

  it("prints help by default", async () => {
    const c = capture();
    expect(await run([], c.io)).toBe(0);
    expect(c.out()).toBe(HELP);
  });

  it("rejects unknown commands", async () => {
    const c = capture();
    expect(await run(["nope"], c.io)).toBe(2);
    expect(c.err()).toContain("unknown command");
  });

  describe("nearest", () => {
    it("lists the closest Wada colors for a hex", async () => {
      const c = capture();
      expect(await run(["nearest", "#c0737a"], c.io)).toBe(0);
      const lines = c.out().trim().split("\n");
      expect(lines[0]).toBe("Nearest Wada colors to #c0737a");
      expect(lines.slice(2)).toHaveLength(3);
      expect(lines[2]).toContain("Light Brown Drab");
    });

    it("takes -k and resolves names", async () => {
      const c = capture();
      expect(await run(["nearest", "dusty rose", "-k", "5"], c.io)).toBe(0);
      expect(c.out()).toContain("(xkcd #c0737a)");
      expect(c.out().trim().split("\n").slice(2)).toHaveLength(5);
    });

    it("prints truecolor blocks when color is on", async () => {
      const c = capture(true);
      await run(["nearest", "#c0737a"], c.io);
      expect(c.out()).toContain("\u001b[48;2;");
    });

    it("prints the library result as JSON", async () => {
      const c = capture();
      expect(await run(["nearest", "red", "--json"], c.io)).toBe(0);
      const json = JSON.parse(c.out());
      expect(json.resolved).toMatchObject({ via: "wada", name: "Red" });
      expect(json.matches[0].color.name).toBe("Red");
    });
  });

  describe("combos", () => {
    it("lists book palettes with their detail", async () => {
      const c = capture();
      expect(await run(["combos", "hermosa pink", "--size", "3", "--limit", "2"], c.io)).toBe(0);
      expect(c.out()).toContain("Anchor: Hermosa Pink #ffb3f0 (distance 0)");
      expect(c.out()).toMatch(/Combination 176 · via Hermosa Pink · score/);
      expect(c.out().match(/^Combination /gm)).toHaveLength(2);
    });

    it("notes a neutral anchor", async () => {
      const c = capture();
      await run(["combos", "#808080", "--limit", "1"], c.io);
      expect(c.out()).toMatch(/\(nearest neutral, distance [\d.]+, over Andover Green at [\d.]+\)/);
    });

    it("reports when no palette matches the options", async () => {
      const c = capture();
      expect(await run(["combos", "#c0737a", "--size", "1"], c.io)).toBe(0);
      expect(c.out()).toContain("No palettes for Light Brown Drab");
    });
  });

  describe("show", () => {
    it("renders book combinations by ID", async () => {
      const c = capture();
      expect(await run(["show", "176", "227"], c.io)).toBe(0);
      expect(c.out()).toContain("Combination 176 · split-complementary");
      expect(c.out()).toContain("Combination 227");
      expect(c.out()).toContain("Cerulian Blue");
    });

    it("prints combinations with their colors as JSON", async () => {
      const c = capture();
      await run(["show", "176", "--json"], c.io);
      const json = JSON.parse(c.out());
      expect(json.combinations[0].combination.id).toBe(176);
      expect(json.combinations[0].colors).toHaveLength(3);
    });
  });

  describe("theme", () => {
    it("builds a theme from a book combination ID", async () => {
      const c = capture();
      expect(await run(["theme", "348"], c.io)).toBe(0);
      expect(c.out()).toContain("Theme from combination 348 · light mode");
      expect(c.out()).toMatch(/#bcd382 {2}background {2}Olive Buff/);
      expect(c.out()).toMatch(/text on background: [\d.]+:1 WCAG AA/);
    });

    it("picks the best-ranked legible palette for a color", async () => {
      const c = capture();
      expect(await run(["theme", "hermosa pink"], c.io)).toBe(0);
      expect(c.out()).toContain("Theme for Hermosa Pink (Wada #ffb3f0) · light mode");
      expect(c.out()).toContain("Combination 273 · Hermosa Pink, Pansy Purple");
    });

    it.each([
      ["css", ":root {\n  color-scheme: dark;"],
      ["tailwind", "@theme {"],
      ["tokens", '"colorSpace": "srgb"'],
    ])("prints --format %s", async (format, expected) => {
      const c = capture();
      expect(await run(["theme", "#1a1a40", "--mode", "dark", "--format", format], c.io)).toBe(0);
      expect(c.out()).toContain(expected);
      expect(c.out()).not.toContain("Pairings:");
    });

    it("prints the chosen combination and theme as JSON", async () => {
      const c = capture();
      expect(await run(["theme", "red", "--json"], c.io)).toBe(0);
      const json = JSON.parse(c.out());
      expect(json.combination.id).toBe(261);
      expect(json.theme).toMatchObject({ ok: true, mode: "light" });
    });

    it("writes a sample UI in both modes to --html and roles and ramps to --svg", async () => {
      const c = capture();
      expect(await run(["theme", "348", "--html", "t.html", "--svg", "t.svg"], c.io)).toBe(0);
      const html = c.files.get("t.html")!;
      expect(html).toContain("Light mode");
      expect(html).toContain("Dark mode");
      expect(html.match(/class="tp"/g)).toHaveLength(2);
      // Roles grid plus one ramp per member of the four-color combination.
      expect(c.files.get("t.svg")!.match(/<svg /g)).toHaveLength(6);
    });

    it("exits 1 when a combination has no legible pair", async () => {
      const c = capture();
      expect(await run(["theme", "227"], c.io)).toBe(1);
      expect(c.err()).toContain("Theme from combination 227: No pair of colors for light mode");
    });

    it("exits 1 when no palette for a color is legible", async () => {
      const c = capture();
      expect(await run(["theme", "white"], c.io)).toBe(1);
      expect(c.err()).toContain("palettes has a pair of colors with WCAG AA contrast");
    });
  });

  describe("file output", () => {
    it("writes one stacked SVG and an HTML page", async () => {
      const c = capture();
      expect(await run(["combos", "#c0737a", "--limit", "3", "--svg", "a.svg", "--html", "a.html"], c.io)).toBe(0);
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

    it("writes a single SVG unchanged", async () => {
      const c = capture();
      await run(["nearest", "red", "--svg", "n.svg"], c.io);
      expect(c.files.get("n.svg")!.match(/<svg /g)).toHaveLength(1);
    });

    it("stacks SVGs by their heights", async () => {
      const a = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="40"></svg>';
      const b = '<svg xmlns="http://www.w3.org/2000/svg" width="60" height="30"></svg>';
      const out = stackSvg([a, b], "A & B", 10);
      expect(out).toContain('width="100" height="80"');
      expect(out).toContain('<svg x="0" y="50" ');
      expect(out).toContain("<title>A &amp; B</title>");
    });
  });

  describe("recommend", () => {
    it("ranks garment colors for a design with reasons", async () => {
      const c = capture();
      expect(await run(["recommend", FLAT_MARK, "-n", "3"], c.io)).toBe(0);
      const out = c.out();
      expect(out.split("\n")[0]).toBe(`Comfort Colors 1717 colors for ${FLAT_MARK}`);
      expect(out).toContain("Design: #e8836b 51% · near ");
      expect(out.match(/^\d\. .+ · score /gm)).toHaveLength(3);
      expect(out).toContain("design colors clear 4.5:1 on");
    });

    it("prints warnings for colors that vanish", async () => {
      const c = capture();
      await run(["recommend", NAVY_BADGE, "-n", "70"], c.io);
      expect(c.out()).toMatch(/Warning: #4f5060 .* from Navy;/);
    });

    it("prints the picks as JSON", async () => {
      const c = capture();
      expect(await run(["recommend", FLAT_MARK, "--json", "--product", "comfort-colors-1717"], c.io)).toBe(0);
      const json = JSON.parse(c.out());
      expect(json.product.id).toBe("comfort-colors-1717");
      expect(json.design.palette).toHaveLength(2);
      expect(json.picks).toHaveLength(5);
      expect(Object.keys(json.picks[0].components)).toEqual(["contrast", "vanish", "inkFit", "bookPairing"]);
    });

    it("writes each pick as a product card with the design's colors as chips", async () => {
      const c = capture();
      await run(["recommend", FLAT_MARK, "-n", "2", "--html", "r.html"], c.io);
      const html = c.files.get("r.html")!;
      expect(html.match(/<h2>\d\. /g)).toHaveLength(2);
      expect(html.match(/fill="#e8836b"/g)).toHaveLength(2);
      expect(html).toContain("<image href=");
    });
  });

  describe("recolor", () => {
    it("prints a mapping and a prompt per garment", async () => {
      const c = capture();
      expect(await run(["recolor", FLAT_MARK, "-n", "2"], c.io)).toBe(0);
      const out = c.out();
      expect(out.split("\n")[0]).toBe(`Comfort Colors 1717 colors for ${FLAT_MARK}, recolored`);
      expect(out.match(/^\d\. .+ · (combination \d+|.+ harmony) · score /gm)).toHaveLength(2);
      expect(out.match(/^ {2}#e8836b \(51%\) -> .+ #[0-9a-f]{6}$/gm)).toHaveLength(2);
      expect(out.match(/^ {2}Prompt: Recolor the artwork for a .+ shirt: change /gm)).toHaveLength(2);
    });

    it("prints the plans as JSON", async () => {
      const c = capture();
      expect(await run(["recolor", FLAT_MARK, "--json", "-n", "3"], c.io)).toBe(0);
      const json = JSON.parse(c.out());
      expect(json.plans).toHaveLength(3);
      expect(Object.keys(json.plans[0])).toEqual(
        expect.arrayContaining(["color", "combination", "mapping", "prompt", "score", "reasons"]),
      );
      expect(json.plans[0].applied).toBeUndefined();
    });

    it("writes before and after chips beside each product card", async () => {
      const c = capture();
      await run(["recolor", FLAT_MARK, "-n", "2", "--html", "r.html"], c.io);
      const html = c.files.get("r.html")!;
      expect(html.match(/<h2>\d\. /g)).toHaveLength(2);
      // The design's colors as before chips on both cards.
      expect(html.match(/fill="#e8836b"/g)).toHaveLength(2);
      expect(html.match(/>→</g)).toHaveLength(4);
    });

    it("writes a recolored PNG per garment with --apply", async () => {
      const dir = mkdtempSync(join(tmpdir(), "cli-recolor-"));
      try {
        const c = capture();
        expect(await run(["recolor", FLAT_MARK, "-n", "2", "--apply", dir, "--json"], c.io)).toBe(0);
        const json = JSON.parse(c.out());
        for (const plan of json.plans) {
          expect(plan.applied).toMatchObject({ applicable: true, out: join(dir, `flat-mark-${plan.color.slug}.png`) });
        }
        expect(readdirSync(dir)).toHaveLength(2);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe("palettes", () => {
    it("lists palettes for a garment color, the garment first", async () => {
      const c = capture();
      expect(await run(["palettes", "blue spruce", "--limit", "3"], c.io)).toBe(0);
      const out = c.out();
      expect(out.split("\n")[0]).toBe("Palettes for Blue Spruce #536758 · Comfort Colors 1717");
      expect(out).toContain("Wada equivalents: Dark Medici Blue (distance 5.63)");
      const blocks = out.split("\n\n").slice(1);
      expect(blocks).toHaveLength(3);
      for (const block of blocks) expect(block.split("\n")[1]).toBe("#536758  Blue Spruce");
    });

    it("prints the library result as JSON and honors --size and --product", async () => {
      const c = capture();
      const argv = ["palettes", "Grey", "--size", "2", "--product", "comfort-colors-1717", "--json"];
      expect(await run(argv, c.io)).toBe(0);
      const json = JSON.parse(c.out());
      expect(json.color.slug).toBe("grey");
      expect(json.available).toBe(true);
      expect(json.palettes.length).toBeGreaterThan(0);
      for (const p of json.palettes) {
        expect(p.colors).toHaveLength(2);
        expect(p.colors[0]).toMatchObject({ anchor: true, name: "Grey", hex: "#909090" });
      }
    });

    it("writes each palette as a garment card with its photo and the ink colors as chips", async () => {
      const c = capture();
      await run(["palettes", "Blue Spruce", "--limit", "2", "--html", "p.html", "--svg", "p.svg"], c.io);
      const html = c.files.get("p.html")!;
      expect(html.match(/<h2>Combination \d+<\/h2>/g)).toHaveLength(2);
      expect(html.match(/<image href=/g)).toHaveLength(2);
      expect(html).toMatch(/Red Orange · [\d.]+:1/);
      expect(c.files.get("p.svg")).toContain("<image href=");
    });
  });

  describe("errors", () => {
    it.each([
      [["nearest", "#12345"], 'malformed hex "#12345"'],
      [["nearest", "c0737"], 'malformed hex "c0737"'],
      [["combos", "blorp"], 'Unknown color name "blorp"'],
      [["show", "999"], "unknown combination 999"],
      [["show", "abc"], 'combination ID must be a positive integer, got "abc"'],
      [["theme", "999"], "unknown combination 999"],
      [["recommend", "no/such/design.png"], 'no such design file "no/such/design.png"'],
      [["recommend", FLAT_MARK, "--product", "no-such-shirt"], 'Unknown product "no-such-shirt"'],
      [["recolor", "no/such/design.png"], 'no such design file "no/such/design.png"'],
      [["recolor", FLAT_MARK, "--product", "no-such-shirt"], 'Unknown product "no-such-shirt"'],
      [["palettes", "Chartreuse"], 'has no color named "Chartreuse". Colors: Banana, Bay,'],
      [["palettes", "Blue Spruce", "--product", "no-such-shirt"], 'Unknown product "no-such-shirt"'],
    ])("exits 1 for %j", async (argv, message) => {
      const c = capture();
      expect(await run(argv, c.io)).toBe(1);
      expect(c.err()).toContain(message);
      expect(c.out()).toBe("");
    });

    it.each([
      [["nearest"], "nearest needs a hex code or color name"],
      [["nearest", "hermosa", "pink"], "quote names with spaces"],
      [["show"], "show needs at least one combination ID"],
      [["nearest", "red", "-k", "0"], '-k must be a positive integer, got "0"'],
      [["combos", "red", "--limit", "2.5"], "--limit must be a positive integer"],
      [["nearest", "red", "--size", "3"], "--size applies only to combos and palettes"],
      [["combos", "red", "-k", "3"], "-k applies only to nearest"],
      [["combos", "red", "--product", "comfort-colors-1717"], "--product applies only to recommend, recolor, and palettes"],
      [["nearest", "red", "-n", "3"], "-n applies only to recommend"],
      [["recommend"], "recommend takes one design file"],
      [["recolor"], "recolor takes one design file"],
      [["recommend", FLAT_MARK, "--apply", "out"], "--apply applies only to recolor"],
      [["recommend", FLAT_MARK, "--vet"], "--vet applies only to recolor"],
      [["recolor", FLAT_MARK, "--include-implausible"], "--include-implausible applies only with --vet"],
      [["palettes"], "palettes needs a product color name"],
      [["palettes", "blue", "spruce"], "quote names with spaces"],
      [["palettes", "Blue Spruce", "-k", "3"], "-k applies only to nearest"],
      [["recommend", FLAT_MARK, "-n", "0"], '-n must be a positive integer, got "0"'],
      [["combos", "red", "--check"], "--check is coming in the products milestone"],
      [["nearest", "red", "--bogus"], "Unknown option '--bogus'"],
      [["theme"], "theme needs a hex code or color name, or a combination ID"],
      [["theme", "red", "--mode", "sepia"], '--mode must be one of light, dark, got "sepia"'],
      [["theme", "red", "--format", "scss"], '--format must be one of css, tailwind, tokens, got "scss"'],
      [["theme", "red", "--json", "--format", "css"], "--json and --format both choose the printed output"],
      [["combos", "red", "--format", "css"], "--format applies only to theme"],
    ])("exits 2 for %j", async (argv, message) => {
      const c = capture();
      expect(await run(argv, c.io)).toBe(2);
      expect(c.err()).toContain(message);
    });
  });
});
