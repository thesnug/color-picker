import { describe, expect, it } from "vitest";

import { colorFamily, FAMILIES } from "../src/color/index.js";

/**
 * Every Comfort Colors 1717 color in the maker-method-picker's color study
 * (`app/prototype/color-study/colors.json`, 2026-09-21) with the group the
 * picker's HSL `groupOf` gives it, as a family slug. The OKLCH cutoffs must
 * reproduce every one so the two tools group colors the same way.
 */
const PICKER_GROUPS: [name: string, hex: string, family: string][] = [
  ["Banana", "#ffecb9", "orange-yellow"],
  ["Bay", "#c3cfc1", "green"],
  ["Berry", "#875570", "red-pink"],
  ["Black", "#000000", "neutral"],
  ["Blossom", "#f8d1e2", "red-pink"],
  ["Blue Jean", "#636d82", "blue"],
  ["Blue Spruce", "#536758", "green"],
  ["Brick", "#914a4a", "red-pink"],
  ["Bright Orange", "#ffad4f", "orange-yellow"],
  ["Bright Salmon", "#ff6b50", "red-pink"],
  ["Burnt Orange", "#e27c4b", "orange-yellow"],
  ["Butter", "#f5e1a4", "orange-yellow"],
  ["Chalky Mint", "#a7dcd4", "green"],
  ["Chambray", "#e2f7ff", "blue"],
  ["Chili", "#853f44", "red-pink"],
  ["China Blue", "#43516e", "blue"],
  ["Citrus", "#ffc86e", "orange-yellow"],
  ["Crimson", "#b65858", "red-pink"],
  ["Crunchberry", "#eb7ca2", "red-pink"],
  ["Denim", "#4e5064", "blue"],
  ["Espresso", "#846b5b", "earth"],
  ["Flo Blue", "#7682c2", "blue"],
  ["Granite", "#8a8e90", "neutral"],
  ["Grape", "#645c81", "purple"],
  ["Graphite", "#373231", "neutral"],
  ["Grey", "#909090", "neutral"],
  ["Hemp", "#676a4a", "earth"],
  ["Hydrangea", "#b2daf3", "blue"],
  ["Ice Blue", "#7b8e95", "blue"],
  ["Island Green", "#54b188", "green"],
  ["Island Reef", "#a2d8c2", "green"],
  ["Ivory", "#fff7e7", "neutral"],
  ["Khaki", "#aea583", "earth"],
  ["Lagoon", "#3ba5b5", "blue"],
  ["Lagoon Blue", "#89e4ed", "blue"],
  ["Light Green", "#69826a", "green"],
  ["Melon", "#ff9a5f", "orange-yellow"],
  ["Midnight", "#414a5b", "blue"],
  ["Moss", "#747f66", "green"],
  ["Mustard", "#d0ae6e", "orange-yellow"],
  ["Mystic Blue", "#647ca3", "blue"],
  ["Navy", "#52525e", "blue"],
  ["Neon Lemon", "#c9db78", "neon"],
  ["Neon Pink", "#f57caf", "neon"],
  ["Neon Red Orange", "#ff867b", "neon"],
  ["Neon Violet", "#e8ace3", "neon"],
  ["Orchid", "#cbb3cc", "purple"],
  ["Paprika", "#ff4645", "red-pink"],
  ["Peachy", "#f7c3ae", "orange-yellow"],
  ["Pepper", "#5f605b", "neutral"],
  ["Periwinkle", "#6570af", "blue"],
  ["Red", "#a80d27", "red-pink"],
  ["Royal Caribe", "#5d8ac7", "blue"],
  ["Sage", "#6d775c", "green"],
  ["Sandstone", "#a69f88", "earth"],
  ["Sapphire", "#03b2d3", "blue"],
  ["Seafoam", "#609a95", "green"],
  ["Terracotta", "#db8c76", "orange-yellow"],
  ["Topaz Blue", "#1f6171", "blue"],
  ["True Navy", "#1c1b32", "blue"],
  ["Violet", "#a88fd7", "purple"],
  ["Washed Denim", "#8595b8", "blue"],
  ["Watermelon", "#da665f", "red-pink"],
  ["White", "#ffffff", "neutral"],
  ["Wine", "#5e5266", "purple"],
  ["Yam", "#c9814f", "orange-yellow"],
];

describe("colorFamily", () => {
  it.each(PICKER_GROUPS)("puts %s (%s) in %s, as the picker does", (name, hex, family) => {
    expect(colorFamily(hex, name)).toBe(family);
  });

  it("only returns known families", () => {
    for (const [name, hex] of PICKER_GROUPS) expect(FAMILIES).toContain(colorFamily(hex, name));
  });

  it("groups neon names as neon whatever the hue, and only by name", () => {
    expect(colorFamily("#ff5a36", "Neon Red Orange")).toBe("neon");
    expect(colorFamily("#ff5a36")).toBe("red-pink");
    expect(colorFamily("#ff5a36", "Neonate")).toBe("red-pink");
  });

  it("treats grays, black, white, and off-whites as neutral", () => {
    for (const hex of ["#000000", "#ffffff", "#808080", "#4f4b48", "#fffaeb"]) {
      expect(colorFamily(hex)).toBe("neutral");
    }
  });
});
