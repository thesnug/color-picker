/**
 * `@thesnug/color-picker` core entry point.
 *
 * Color math, nearest match, combinations, recommendations, and recolor plans
 * live here. No AI, no framework, no I/O. See docs/DESIGN.md for the design.
 */

export type { WadaColor, WadaDataset } from "./data/index.js";

export * from "./color/index.js";
