import { describe, expect, it } from "vitest";

import { renderSwatchStripSvg } from "../src/render/index.js";

describe("render", () => {
  it("renders a swatch strip as SVG", () => {
    const svg = renderSwatchStripSvg(["#ffb3f0", "#000000"], { tileWidth: 10, tileHeight: 5 });
    expect(svg.startsWith("<svg ")).toBe(true);
    expect(svg).toContain('width="20" height="5"');
    expect(svg).toContain('fill="#ffb3f0"');
    expect(svg).toContain('x="10"');
  });
});
