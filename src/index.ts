/**
 * `@thesnug/color-picker` core entry point.
 *
 * Color math, nearest match, combinations, recommendations, and recolor plans
 * live here. No AI, no framework, no I/O beyond reading the package's own
 * assets. See docs/DESIGN.md for the design.
 */

export type { DerivedColor, WadaColor, WadaDataset } from "./data/index.js";

export * from "./color/index.js";
export * from "./nearest.js";
export * from "./combinations.js";
