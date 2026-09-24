import { describe, expect, it } from "vitest";

import { normalizeHex } from "../src/index.js";

describe("core", () => {
  it("normalizes hex colors", () => {
    expect(normalizeHex("#FFB3F0")).toBe("#ffb3f0");
    expect(normalizeHex("abc")).toBe("#aabbcc");
    expect(() => normalizeHex("not a color")).toThrow(TypeError);
  });
});
