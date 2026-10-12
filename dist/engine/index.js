/**
 * `@thesnug/color-picker/engine`: the color engine as a library. The MCP
 * tools, the CLI, and POD's Creative color study all call these functions, so
 * the chat skill and POD give the same answers for the same inputs.
 *
 * Pure: no `node:` modules, no file reads, no decoder, no model. The
 * catalog and Wada data are bundled. The caller decodes the exact print file
 * (`legibilitySampling` says how; `decodeForLegibility` in the fingerprint
 * entry point does it with `sharp`) and encodes any pixels it writes.
 *
 * - Measure: `measureInkPixels`, `analyzeDesign`.
 * - Judge (`ink-legibility-v2`): `inkOnGarment`, `judgeLegibility`,
 *   `garmentFamily`, `legibleInkNeeds`.
 * - Rank: `rankGarments`, `rankArtworkGarmentPairs`.
 * - Recolor: `planLegibleInkOptions`, `toSubstitutionPlan`,
 *   `snapSubstitutionPlan`, `planArtworkOptions`, applied by
 *   `substitutePigments`.
 *
 * Every verdict records `LEGIBILITY_PROTOCOL`; `ENGINE_VERSION` changes
 * whenever any output does. See docs/DESIGN.md, "Print legibility".
 */
export { ENGINE_VERSION, LEGIBILITY_CONTENT_MARGIN, LEGIBILITY_PROTOCOL, LEGIBILITY_RULES } from "./rules.js";
export { legibilitySampling, } from "./sampling.js";
export { analyzeDesign, measureInkPixels, SUMMARY_MAXIMUM_COLORS, SUMMARY_MINIMUM_SHARE, } from "./measure.js";
export { garmentFamily, inkOnGarment, judgeLegibility, legibleInkNeeds, seenOn, } from "./legibility.js";
export { garmentColor, garmentSlug, garmentsFromProduct } from "./garments.js";
export { rankArtworkGarmentPairs, rankGarments, } from "./rank.js";
export { ARTWORK_OPTION_DEFAULTS, planArtworkOptions, judgeRecolor, planLegibleInkOptions, snapSubstitutionPlan, substitutionReplacements, toSubstitutionPlan, validateSubstitutionPlan, } from "./plans.js";
export { RecolorPigmentError, substitutePigments, } from "./substitute.js";
// The pure core the engine builds on, re-exported so a vendored engine needs no other entry point.
export * from "../color/index.js";
export { allowsDarkInk, check } from "../accessibility.js";
export { nearest } from "../nearest.js";
export { recommendProductColors, RECOMMEND_WEIGHTS, scoreComponents, scoreGarments, } from "../recommend.js";
export { mapByLightness, RECOLOR_PLAN_DEFAULTS, RECOLOR_WEIGHTS, recolorPlans, recolorPlansFor, recolorPrompt, scoreRecolor, } from "../recolor.js";
export { extractPalette, hasTransparency, INK_ALPHA_THRESHOLD, INK_LUMINANCE_EMPTY, inkLuminance, PALETTE_DEFAULTS, } from "../fingerprint/quantize.js";
export { RECOLOR_DEFAULTS, recolorPixels, } from "../fingerprint/recolor.js";
export { diversityCounts, REQUIRED_SIZES, repetitionReport, selectBatchColors, withDiversityPenalty, } from "../batch.js";
//# sourceMappingURL=index.js.map