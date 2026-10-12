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
export {
  type ContentBounds,
  type LegibilitySampling,
  type LegibilitySamplingInput,
  legibilitySampling,
} from "./sampling.js";
export {
  analyzeDesign,
  type DesignAnalysis,
  type InkCluster,
  type InkMeasurement,
  measureInkPixels,
  SUMMARY_MAXIMUM_COLORS,
  SUMMARY_MINIMUM_SHARE,
} from "./measure.js";
export {
  type Garment,
  type GarmentFamily,
  garmentFamily,
  type InkOnGarment,
  inkOnGarment,
  judgeLegibility,
  type LegibilityInk,
  type LegibilityVerdict,
  legibleInkNeeds,
  seenOn,
} from "./legibility.js";
export { type CatalogGarment, garmentColor, type GarmentInput, garmentSlug, garmentsFromProduct } from "./garments.js";
export {
  type ArtworkGarmentPair,
  type ArtworkSource,
  type PairArtwork,
  rankArtworkGarmentPairs,
  type RankArtworkGarmentPairsInput,
  type RankedGarment,
  rankGarments,
  type RankGarmentsOptions,
} from "./rank.js";
export {
  ARTWORK_OPTION_DEFAULTS,
  type ArtworkOption,
  planArtworkOptions,
  type PlanArtworkOptionsInput,
  judgeRecolor,
  planLegibleInkOptions,
  snapSubstitutionPlan,
  type SubstitutionPlan,
  substitutionReplacements,
  toSubstitutionPlan,
  validateSubstitutionPlan,
} from "./plans.js";
export {
  type PigmentReplacement,
  RecolorPigmentError,
  type SubstitutedPixels,
  substitutePigments,
} from "./substitute.js";

// The pure core the engine builds on, re-exported so a vendored engine needs no other entry point.
export * from "../color/index.js";
export { allowsDarkInk, check, type CheckContext, type CheckResult } from "../accessibility.js";
export { nearest, type NearestMatch, type NearestResult } from "../nearest.js";
export {
  type DesignColor,
  type DesignColorOnGarment,
  type DesignSummary,
  type GarmentColor,
  type ProductColorRecommendation,
  recommendProductColors,
  type RecommendOptions,
  RECOMMEND_WEIGHTS,
  type RecommendWeights,
  type ScoreComponents,
  scoreComponents,
  scoreGarments,
  type ScoreGarmentsOptions,
} from "../recommend.js";
export {
  mapByLightness,
  RECOLOR_PLAN_DEFAULTS,
  RECOLOR_WEIGHTS,
  type RecolorCombination,
  type RecolorComponents,
  type RecolorGarmentsOptions,
  type RecolorMapping,
  type RecolorOptions,
  type RecolorPlan,
  recolorPlans,
  recolorPlansFor,
  recolorPrompt,
  type RecolorWeights,
  scoreRecolor,
} from "../recolor.js";
export {
  extractPalette,
  hasTransparency,
  INK_ALPHA_THRESHOLD,
  INK_LUMINANCE_EMPTY,
  inkLuminance,
  PALETTE_DEFAULTS,
  type PaletteEntry,
  type PaletteOptions,
  type RgbaPixels,
} from "../fingerprint/quantize.js";
export {
  RECOLOR_DEFAULTS,
  type RecoloredPixels,
  type RecolorPixelOptions,
  type RecolorSwap,
  recolorPixels,
} from "../fingerprint/recolor.js";
export {
  type ArtworkCandidate,
  type BatchDesign,
  type BatchSelection,
  type DesiredColorGroup,
  type DiversityCounts,
  diversityCounts,
  type GarmentUse,
  REQUIRED_SIZES,
  repetitionReport,
  selectBatchColors,
  withDiversityPenalty,
} from "../batch.js";
export type {
  Accessibility,
  DerivedColor,
  Product,
  ProductColor,
  ProductColorSource,
  ProductColorWithHex,
} from "../data/types.js";
