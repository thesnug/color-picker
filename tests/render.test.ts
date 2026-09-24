import { describe, expect, it } from "vitest";

import { contrastRatio } from "../src/color/contrast.js";
import { loadColors, loadCombinations } from "../src/data/index.js";
import {
  pairContrast,
  readableTextColor,
  renderAnsi,
  renderCombination,
  renderHtml,
  renderProductCard,
  renderSwatchGrid,
  renderSwatchStripSvg,
} from "../src/render/index.js";

const colors = loadColors();
const byIndex = new Map(colors.map((c) => [c.index, c]));

function combination(id: number) {
  const combo = loadCombinations().find((c) => c.id === id)!;
  return { id: combo.id, colors: combo.colors.map((i) => byIndex.get(i)!) };
}

/** Every `fill` on a `<text>` element, in document order. */
function textFills(svg: string): string[] {
  return [...svg.matchAll(/<text [^>]*fill="([^"]+)"/g)].map((m) => m[1]!);
}

describe("readableTextColor", () => {
  it("picks black on light fills and white on dark fills", () => {
    expect(readableTextColor("#ffffff")).toBe("#000000");
    expect(readableTextColor("#ffb3f0")).toBe("#000000");
    expect(readableTextColor("#000000")).toBe("#ffffff");
    expect(readableTextColor("#1a237e")).toBe("#ffffff");
  });

  it("always chooses the higher-contrast option for every Wada color", () => {
    for (const c of colors) {
      const ink = readableTextColor(c.hex);
      const other = ink === "#000000" ? "#ffffff" : "#000000";
      expect(contrastRatio(ink, c.hex)).toBeGreaterThanOrEqual(contrastRatio(other, c.hex));
    }
  });
});

describe("renderCombination", () => {
  it("renders one labeled tile per color in book order", () => {
    const combo = combination(125);
    const shuffled = { ...combo, colors: [...combo.colors].reverse() };
    const svg = renderCombination(shuffled);
    const fills = [...svg.matchAll(/<rect [^>]*fill="(#[0-9a-f]{6})"/g)].map((m) => m[1]);
    expect(fills).toEqual(combo.colors.map((c) => c.hex));
    for (const c of combo.colors) expect(svg).toContain(c.hex);
    expect(svg).toContain("Combination 125");
    expect(svg).not.toContain(":1 · Lc");
  });

  it("labels each tile in the color that reads best on it", () => {
    const svg = renderCombination({ colors: [{ hex: "#000000", name: "Black" }, { hex: "#ffffff", name: "White" }] });
    expect(textFills(svg)).toEqual(["#ffffff", "#ffffff", "#000000", "#000000"]);
  });

  it("adds a WCAG and APCA badge between adjacent tiles on request", () => {
    const combo = combination(125);
    const svg = renderCombination(combo, { contrast: true });
    expect(svg.match(/:1 · Lc /g)).toHaveLength(combo.colors.length - 1);
    const { wcag, apca } = pairContrast(combo.colors[0]!.hex, combo.colors[1]!.hex);
    expect(svg).toContain(`${Number(wcag.toFixed(2))}:1 · Lc ${Math.round(apca)}`);
  });

  it("matches the snapshot", () => {
    expect(renderCombination(combination(125), { contrast: true })).toMatchSnapshot();
  });
});

describe("renderSwatchGrid", () => {
  it("wraps into rows and shows notes", () => {
    const list = colors.slice(0, 5).map((c, i) => ({ ...c, note: `distance ${i}` }));
    const svg = renderSwatchGrid(list, { columns: 2, tileWidth: 100, tileHeight: 80, gap: 10 });
    expect(svg).toContain('width="210" height="260"');
    expect(svg).toContain("distance 4");
  });

  it("renders an empty list without throwing", () => {
    expect(renderSwatchGrid([])).toContain("No colors");
  });

  it("matches the snapshot", () => {
    const list = colors.slice(0, 3).map((c, i) => ({ ...c, note: `ΔE ${i * 1.5}` }));
    expect(renderSwatchGrid(list, { title: "Nearest to #f0b0e0" })).toMatchSnapshot();
  });
});

describe("renderProductCard", () => {
  const design = [byIndex.get(1)!, byIndex.get(3)!];
  const garment = {
    name: "Pepper",
    hex: "#5f605b",
    available: true,
    image: { url: "https://example.com/pepper.jpg?w=400&h=400" },
  };

  it("draws the garment photo over the tile, escaped", () => {
    const svg = renderProductCard(garment, { designColors: design });
    expect(svg).toContain('<image href="https://example.com/pepper.jpg?w=400&amp;h=400"');
    expect(svg).toContain('fill="#5f605b"');
    for (const c of design) expect(svg).toContain(c.name);
  });

  it("degrades to a plain tile without an image", () => {
    const { image: _image, ...plain } = garment;
    const svg = renderProductCard(plain);
    expect(svg).not.toContain("<image");
    expect(svg).not.toContain("clipPath");
    expect(svg).toContain('fill="#5f605b"');
  });

  it("marks unstocked colors", () => {
    expect(renderProductCard({ ...garment, available: false })).toContain("not stocked");
  });

  it("matches the snapshot", () => {
    expect(
      renderProductCard(garment, { designColors: design, productName: "Comfort Colors 1717" }),
    ).toMatchSnapshot();
  });
});

describe("renderHtml", () => {
  it("wraps SVGs in a page with a light and dark toggle", () => {
    const svg = renderSwatchStripSvg(["#ffb3f0"]);
    const html = renderHtml([{ title: "Pink & friends", svg, caption: "<caption>" }], {
      title: "Review",
    });
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain(svg);
    expect(html).toContain("Pink &amp; friends");
    expect(html).toContain("&lt;caption&gt;");
    expect(html).toContain('value="light"');
    expect(html).toContain('value="dark"');
    expect(html).not.toMatch(/<(link|script) [^>]*src=/);
  });

  it("can start on a fixed background", () => {
    expect(renderHtml([], { theme: "dark" })).toContain('<html lang="en" data-theme="dark">');
  });

  it("matches the snapshot", () => {
    expect(renderHtml([renderSwatchStripSvg(["#ffb3f0", "#000000"])])).toMatchSnapshot();
  });
});

describe("renderAnsi", () => {
  it("prints a truecolor block with the hex and name", () => {
    const out = renderAnsi([byIndex.get(1)!]);
    expect(out).toBe("\u001b[48;2;255;179;240m      \u001b[0m  #ffb3f0  Hermosa Pink\n");
  });

  it("drops escape codes when color is off", () => {
    expect(renderAnsi([{ hex: "#FFF", note: "white" }], { color: false })).toBe("#ffffff  white\n");
  });

  it("matches the snapshot", () => {
    expect(renderAnsi(combination(125).colors, { blockWidth: 4 })).toMatchSnapshot();
  });
});

describe("renderSwatchStripSvg", () => {
  it("renders a swatch strip as SVG", () => {
    const svg = renderSwatchStripSvg(["#ffb3f0", "#000000"], { tileWidth: 10, tileHeight: 5 });
    expect(svg.startsWith("<svg ")).toBe(true);
    expect(svg).toContain('width="20" height="5"');
    expect(svg).toContain('fill="#ffb3f0"');
    expect(svg).toContain('x="10"');
  });
});

describe("escaping", () => {
  it("escapes names in every SVG renderer", () => {
    const evil = { hex: "#123456", name: `<script>"&'` };
    for (const svg of [
      renderCombination({ colors: [evil] }),
      renderSwatchGrid([evil]),
      renderProductCard(evil, { designColors: [evil] }),
    ]) {
      expect(svg).not.toContain("<script>");
      expect(svg).toContain("&lt;script&gt;&quot;&amp;&#39;");
    }
  });

  it("rejects a hex that is not a color", () => {
    expect(() => renderSwatchGrid([{ hex: 'red"/><script>' }])).toThrow(TypeError);
  });
});
