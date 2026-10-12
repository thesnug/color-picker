/**
 * Measure a print file's ink: its palette, each ink's share, median alpha and
 * spread, and the 4-neighbor edges between inks and transparency. Pure: the
 * caller decodes the exact file (see `legibilitySampling`) and passes RGBA.
 *
 * Ported unchanged from POD's `ink-legibility-v2` (`lib/ink-legibility.ts`):
 * every float operation keeps its order, so both produce the same bytes.
 */
import { type RgbaPixels } from "../fingerprint/quantize.js";
import type { DesignSummary } from "../recommend.js";
import { LEGIBILITY_PROTOCOL } from "./rules.js";
export interface InkCluster {
    hex: string;
    /** Alpha-weighted share of the visible ink, 0 to 1. */
    share: number;
    /**
     * Median alpha of the ink's pixels, 0 to 1: a semi-transparent ink's alpha, while the
     * antialiased edges of an opaque stroke don't dilute it.
     */
    alpha: number;
    /** 90th-percentile largest channel difference between the ink's pixels and its hex. */
    spread: number;
}
export interface InkMeasurement {
    protocol: typeof LEGIBILITY_PROTOCOL;
    /** SHA-256 of the exact measured file. */
    bytesChecksum: string;
    sampledWidth: number;
    sampledHeight: number;
    /** Share of the ink the quantizer's palette covered before every pixel was assigned. */
    coverage: number;
    /** Share of the ink at least `vanishDistance` from its nearest palette color. */
    unmatchedShare: number;
    /** Gradient art the palette can't cover: shares are approximate and nothing is framed. */
    approximate: boolean;
    /** Most ink first. */
    clusters: InkCluster[];
    /** Symmetric 4-neighbor edge counts between inks; the last index is transparency. */
    edges: number[][];
    /**
     * `enclosedEdges[a][b]`: the part of `edges[a][b]` between ink `a` and connected marks of
     * ink `b` that `a` alone surrounds (they touch no other ink, no transparency and no canvas
     * edge). Such marks sit inside `a`'s shape and never draw its boundary. Not symmetric.
     */
    enclosedEdges: number[][];
}
/** A measured design: the measurement the verdicts read, and the summary rankings read. */
export interface DesignAnalysis {
    measurement: InkMeasurement;
    /**
     * The inks with at least 2% of the ink (at most eight), and the ink luminance of
     * every visible pixel. Recommendation scores and Wada recolor plans read this.
     */
    summary: DesignSummary;
}
/** Smallest share of the ink a cluster needs to join a `DesignAnalysis` summary. */
export declare const SUMMARY_MINIMUM_SHARE = 0.02;
/** Most colors in a `DesignAnalysis` summary. */
export declare const SUMMARY_MAXIMUM_COLORS = 8;
/**
 * Measure decoded RGBA pixels: the ink palette, each ink's share, median alpha and spread, and
 * the edges between inks and transparency. The quantizer keeps only its largest colors, so
 * every visible pixel is reassigned to its nearest palette color and the shares sum to one.
 */
export declare function measureInkPixels(pixels: RgbaPixels, bytesChecksum: string): InkMeasurement;
/**
 * Measure a design and summarize it for ranking and recolor planning: the
 * measurement, plus the inks with at least 2% of the ink (at most eight) with
 * their shares, and the alpha-weighted ink luminance of every visible pixel
 * rounded as a fingerprint's is.
 */
export declare function analyzeDesign(pixels: RgbaPixels, bytesChecksum: string): DesignAnalysis;
//# sourceMappingURL=measure.d.ts.map