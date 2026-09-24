/**
 * Broad color families for grouping garment colors, decided in OKLCH.
 *
 * The families and their order match the maker-method-picker's color study
 * groups (`groupOf` in `app/prototype/color-study/palette.ts`), which used HSL.
 * The cutoffs below were chosen so every Comfort Colors 1717 color lands in the
 * same family as it does there; see `tests/family.test.ts`.
 */

import { type ColorInput, toOklch } from "./convert.js";

/** Family slugs, in display order. */
export const FAMILIES = [
  "neutral",
  "earth",
  "red-pink",
  "orange-yellow",
  "green",
  "blue",
  "purple",
  "neon",
] as const;

export type Family = (typeof FAMILIES)[number];

/** OKLCH cutoffs for {@link colorFamily}. Hues are in degrees. */
export const FAMILY = {
  /** Chroma below which a color is neutral at any lightness. */
  neutralChroma: 0.015,
  /** Very light colors below this chroma read as off-white, so neutral (Ivory). */
  paleChroma: 0.03,
  /** Lightness at or above which {@link FAMILY.paleChroma} applies. */
  paleLightness: 0.97,
  /** Muted warm hues (browns, khakis) below this chroma are earth. */
  earthChroma: 0.06,
  earthHueMin: 40,
  earthHueMax: 120,
  /** Red and pink run from `redHueMin` through 360 to `redHueMax`. */
  redHueMin: 335,
  redHueMax: 34,
  /** Upper hue bounds for the remaining families, checked in order. */
  orangeHueMax: 120,
  greenHueMax: 195,
  blueHueMax: 290,
} as const;

/**
 * The broad family of a color. Pass the color's name when there is one: names
 * starting with "Neon" are grouped as `neon` whatever their hue, as garment
 * catalogs do.
 */
export function colorFamily(input: ColorInput, name?: string): Family {
  if (name !== undefined && /^neon\b/i.test(name.trim())) return "neon";
  const { l, c, h } = toOklch(input);
  if (c < FAMILY.neutralChroma) return "neutral";
  if (l >= FAMILY.paleLightness && c < FAMILY.paleChroma) return "neutral";
  if (c < FAMILY.earthChroma && h >= FAMILY.earthHueMin && h < FAMILY.earthHueMax) return "earth";
  if (h >= FAMILY.redHueMin || h < FAMILY.redHueMax) return "red-pink";
  if (h < FAMILY.orangeHueMax) return "orange-yellow";
  if (h < FAMILY.greenHueMax) return "green";
  if (h < FAMILY.blueHueMax) return "blue";
  return "purple";
}
