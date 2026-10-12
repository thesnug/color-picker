/**
 * `@thesnug/color-picker` core entry point.
 *
 * Color math, nearest match, combinations, recommendations, and recolor plans
 * live here. No AI, no framework, no I/O: the package's assets are bundled
 * (`src/data/generated/`). The print legibility engine built on this is the
 * `@thesnug/color-picker/engine` entry point. See docs/DESIGN.md for the design.
 */

export type { DerivedColor, WadaColor, WadaDataset } from "./data/types.js";

export type { Accessibility } from "./data/types.js";

export * from "./accessibility.js";
export * from "./color/index.js";
export * from "./nearest.js";
export * from "./combinations.js";
export * from "./equivalents.js";
export * from "./palettes.js";
export * from "./recommend.js";
export * from "./recolor.js";
export * from "./theme.js";

export * from "./batch.js";
