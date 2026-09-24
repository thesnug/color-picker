import { describe, expect, it } from "vitest";

import { loadWadaColors } from "../src/data/index.js";

describe("data", () => {
  it("loads the vendored Wada colors", () => {
    const colors = loadWadaColors();
    expect(colors).toHaveLength(157);
    expect(colors[0]).toMatchObject({ index: 1, name: "Hermosa Pink", hex: "#ffb3f0" });
  });
});
