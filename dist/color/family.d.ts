/**
 * Broad color families for grouping garment colors, decided in OKLCH.
 *
 * The families and their order match the maker-method-picker's color study
 * groups (`groupOf` in `app/prototype/color-study/palette.ts`), which used HSL.
 * The cutoffs below were chosen so every Comfort Colors 1717 color lands in the
 * same family as it does there; see `tests/family.test.ts`.
 */
import { type ColorInput } from "./convert.js";
/** Family slugs, in display order. */
export declare const FAMILIES: readonly ["neutral", "earth", "red-pink", "orange-yellow", "green", "blue", "purple", "neon"];
export type Family = (typeof FAMILIES)[number];
/** OKLCH cutoffs for {@link colorFamily}. Hues are in degrees. */
export declare const FAMILY: {
    /** Chroma below which a color is neutral at any lightness. */
    readonly neutralChroma: 0.015;
    /** Very light colors below this chroma read as off-white, so neutral (Ivory). */
    readonly paleChroma: 0.03;
    /** Lightness at or above which {@link FAMILY.paleChroma} applies. */
    readonly paleLightness: 0.97;
    /** Muted warm hues (browns, khakis) below this chroma are earth. */
    readonly earthChroma: 0.06;
    readonly earthHueMin: 40;
    readonly earthHueMax: 120;
    /** Red and pink run from `redHueMin` through 360 to `redHueMax`. */
    readonly redHueMin: 335;
    readonly redHueMax: 34;
    /** Upper hue bounds for the remaining families, checked in order. */
    readonly orangeHueMax: 120;
    readonly greenHueMax: 195;
    readonly blueHueMax: 290;
};
/**
 * The broad family of a color. Pass the color's name when there is one: names
 * starting with "Neon" are grouped as `neon` whatever their hue, as garment
 * catalogs do.
 */
export declare function colorFamily(input: ColorInput, name?: string): Family;
//# sourceMappingURL=family.d.ts.map