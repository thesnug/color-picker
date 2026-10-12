/**
 * The engine's version and the `ink-legibility-v2` rules. Kept apart from the
 * functions so every engine module can import them without a cycle.
 */

/**
 * The engine's output version, independent of the package version. Bump it
 * whenever any engine function returns something different for the same
 * input: a measurement, a verdict, a ranking, a plan, or substituted pixels.
 * `scripts/record-engine-fixtures.ts` refuses to re-record changed outputs
 * under an unchanged version, so consumers that pin a version (POD's drift
 * test) can trust it.
 */
export const ENGINE_VERSION = "1.1.0";

/**
 * The legibility protocol. v2 judges framing on each ink's own boundary
 * (enclosed marks excluded, faint neighbors inheriting their framing) and
 * refuses a pair at a fifth of the ink lost, not half.
 */
export const LEGIBILITY_PROTOCOL = "ink-legibility-v2";

export const LEGIBILITY_RULES = {
  /** Longest side of the analyzed image. 512 drops the outlines of 4500 px print files. */
  analysisMaxDimension: 1024,
  /** Pixels at or below this alpha (0 to 1) are transparent, as in color-picker. */
  alphaThreshold: 0.5,
  paletteColors: 12,
  mergeDistance: 5,
  /** WCAG 2.2 AA for large-scale text and graphical objects (SC 1.4.3, 1.4.11). */
  minimumContrast: 3,
  /** color-picker's print.minimumDistance: closer colors read as one on fabric. */
  vanishDistance: 10,
  /** A faint ink with at least this share of its boundary drawn by legible ink is framed by it. */
  framedEdgeShare: 0.6,
  /**
   * A pair fails when this share of the ink, or more, is lost: a word of lettering or a subject
   * is rarely smaller. A small accent (an orange inlay at 14% of the ink) may still be lost.
   */
  maximumLostShare: 0.2,
  /** A pair fails when less than this share of the ink reads on its own. */
  minimumLegibleShare: 0.2,
  /** Below this palette coverage the art is a gradient: no framing exception. */
  minimumPaletteCoverage: 0.85,
  /**
   * Above this share of ink at least `vanishDistance` from every palette color, the art is a
   * gradient or photograph as well. Antialiased flat color stays well under it.
   */
  maximumUnmatchedShare: 0.2,
  /** color-picker's print.darkInkGarmentLuminance: lighter garments take dark ink. */
  darkInkGarmentLuminance: 0.3,
  /** What a synthesized recolor reaches on its garment family's median color. */
  synthesizedContrast: 4.5,
  /** Inks below this share are left alone by a synthesized recolor. */
  recolorMinimumShare: 0.02,
  /** substitutePigments' largest tolerance. */
  recolorMaximumTolerance: 35,
} as const;

/**
 * Empty canvas kept around a print file's content bounds when it is cropped
 * for measurement, as a fraction of each side. Not one of `LEGIBILITY_RULES`,
 * which consumers record verbatim as evidence.
 */
export const LEGIBILITY_CONTENT_MARGIN = 0.01;
