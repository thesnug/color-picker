/**
 * `@thesnug/color-picker/fingerprint`: reduce a design file to a small,
 * cacheable fingerprint that recommendations and Jev calls are keyed on. See
 * docs/DESIGN.md, "Pipelines".
 *
 * This entry point reads files and writes a cache, so it is kept out of the
 * core. Decoding uses `sharp`, an optional peer dependency: install it next to
 * this package, or pass your own `decoder`.
 */
import { type PaletteEntry, type PaletteOptions, type RgbaPixels } from "./quantize.js";
import { type DesignDescription, type VisionProvider } from "./describe.js";
import { type ApplyRecolorOptions, type RecolorSwap } from "./recolor.js";
import { type DesignAnalysis } from "../engine/measure.js";
import { type ContentBounds } from "../engine/sampling.js";
import { type PigmentReplacement } from "../engine/substitute.js";
export { codexProvider, type CodexProviderOptions, CODEX_DEFAULT_MODEL, type DescribedElement, type DescriptionAnswer, DESCRIPTION_VERSION, type DesignDescription, defaultVisionProviders, describePrompt, descriptionSchema, labelPalette, OPENROUTER_DEFAULT_MODEL, openRouterProvider, type OpenRouterProviderOptions, validateAnswer, type VisionImage, type VisionProvider, type VisionProviderName, type VisionRequest, VisionUnavailableError, } from "./describe.js";
export type { ContentBounds } from "../engine/sampling.js";
export { type ApplyRecolorOptions, RECOLOR_DEFAULTS, type RecoloredPixels, type RecolorPixelOptions, type RecolorSwap, recolorPixels, } from "./recolor.js";
export { extractPalette, hasTransparency, INK_ALPHA_THRESHOLD, INK_LUMINANCE_EMPTY, inkLuminance, PALETTE_DEFAULTS, type PaletteEntry, type PaletteOptions, type RgbaPixels, } from "./quantize.js";
export interface Fingerprint {
    /** SHA-256 of the file bytes, lowercase hex. */
    hash: string;
    /**
     * Top colors of the opaque pixels by coverage, largest first. After
     * `describeDesign`, each color names the elements it paints in `element`.
     */
    palette: (PaletteEntry & {
        element?: string;
    })[];
    /** Alpha-weighted mean WCAG relative luminance of the visible pixels, 0 to 1. */
    inkLuminance: number;
    /** True when any pixel is less than fully opaque. */
    hasTransparency: boolean;
    /** Pixel size of the file, after EXIF orientation. */
    width: number;
    height: number;
    /** What the design depicts, from `describeDesign`. Absent from `fingerprint` itself. */
    description?: DesignDescription;
}
/** What a decoder returns: the file's size and its pixels, possibly downscaled. */
export interface DecodedImage {
    width: number;
    height: number;
    pixels: RgbaPixels;
}
/**
 * Decode PNG, WebP, or JPEG bytes to RGBA. `maxDimension` is a hint: pixels
 * may be downscaled so neither side exceeds it.
 */
export type Decoder = (bytes: Uint8Array, options: {
    maxDimension: number;
}) => Promise<DecodedImage>;
export interface FingerprintOptions extends PaletteOptions {
    /**
     * Directory for cached fingerprints, or `false` to skip the cache. Defaults to
     * `$XDG_CACHE_HOME/color-picker/fingerprints`, or `~/.cache/...` when unset.
     */
    cache?: string | false;
    /** Longest side, in pixels, the image is sampled at. Default 512. */
    maxDimension?: number;
    /** Replaces the `sharp` decoder. */
    decoder?: Decoder;
}
/** Bump when the fingerprint's output changes for the same file and options, to invalidate caches. */
export declare const FINGERPRINT_VERSION = 1;
export declare function defaultCacheDir(): string;
/**
 * The default decoder. Downsamples with nearest-neighbor so every sampled pixel
 * is a real pixel of the file: smoothing kernels would blend colors and
 * invent palette entries.
 */
export declare const sharpDecoder: Decoder;
/**
 * Fingerprint a design file: its hash, top colors by coverage, ink luminance,
 * transparency, and size. `file` is a path, a file URL, or the file's bytes.
 *
 * Results are cached on disk by file hash and settings; a repeat call reads the
 * file to hash it but does not decode it.
 *
 * @throws {Error} when `sharp` is missing and no `decoder` is given.
 * @throws {TypeError} when the file is not PNG, WebP, or JPEG.
 */
export declare function fingerprint(file: string | URL | Uint8Array, options?: FingerprintOptions): Promise<Fingerprint>;
export interface DescribeOptions {
    /**
     * Directory for cached descriptions, or `false` to skip the cache. Defaults
     * to the fingerprint cache directory.
     */
    cache?: string | false;
    /** Providers to try, in order. Default: Codex CLI, then OpenRouter when `OPENROUTER_API_KEY` is set. */
    providers?: readonly VisionProvider[];
    signal?: AbortSignal;
}
/** Visible preview only: fingerprinting always measures the original alpha-bearing file. */
export declare function visionPreview(bytes: Uint8Array, print: Pick<Fingerprint, "hasTransparency" | "inkLuminance">): Promise<{
    bytes: Uint8Array<ArrayBufferLike>;
    mediaType: "image/png" | "image/jpeg" | "image/webp";
} | {
    bytes: Buffer<ArrayBuffer>;
    mediaType: "image/png";
}>;
/**
 * Add a vision description to a fingerprint: the design's subject and mood in
 * a line each, and its named elements, each tied to the palette color that
 * paints it. Palette colors gain `element`, which recolor plans and prompts
 * name. `file` is the file the fingerprint was made from.
 *
 * One model call per design: the answer is cached by file hash and palette in
 * the fingerprint cache directory, and a cache hit needs no provider.
 *
 * @throws {VisionUnavailableError} on a cache miss when every provider fails
 *   or none is set up; the message says how to enable one.
 * @throws {Error} when `file` does not match the fingerprint's hash.
 */
export declare function describeDesign(print: Fingerprint, file: string | URL | Uint8Array, options?: DescribeOptions): Promise<Fingerprint>;
export type AppliedRecolor = {
    applicable: true;
    /** The PNG written. */
    out: string;
    width: number;
    height: number;
    /**
     * The pigment substitutions applied, bound to the design's measured inks,
     * including any ink the mapping keeps as it is.
     */
    replacements: PigmentReplacement[];
    /** Visible pixels a pigment matched, kept inks included. */
    changed: number;
    /**
     * Share of the visible pixels no pigment's tolerance or tint reached,
     * left as they were, weighted by alpha (`substitutePigments`).
     */
    unmatched: number;
} | {
    applicable: false;
    /** Why the art was not recolored; use the plan's prompt instead. */
    reason: string;
};
/**
 * Recolor flat-color art by a recolor mapping and write the result as a PNG,
 * by pigment substitution: the design's inks are measured as the legibility
 * engine measures them, each `from` color binds to the measured ink within 5
 * of it, and `substitutePigments` swaps exactly those pigments, keeping each
 * pixel's offset from its pigment (antialiasing, shading) and its alpha.
 * Every other pixel is unchanged. `mapping` is a `RecolorPlan`'s `mapping`.
 *
 * Returns `{ applicable: false, reason }` and writes nothing for art the
 * measurement marks approximate (photographic or gradient-heavy), for a
 * mapping color that matches no measured ink, when the mapped inks cover
 * less than `minCoverage` of the ink (default 0.9: a photograph's few main
 * colors, or a mapping that leaves an ink out), when more than
 * `maxUnmatched` of the visible pixels, weighted by alpha, match no pigment
 * (default 0.05; near-transparent residue around a print barely counts), and
 * for pigments whose tolerances overlap.
 *
 * `tolerance`, `fingerprint`, and `cache` are accepted for compatibility and
 * no longer read: tolerances come from the measured inks.
 *
 * @throws {Error} when `sharp` is missing.
 * @throws {TypeError} when the file is not PNG, WebP, or JPEG.
 */
export declare function applyRecolor(file: string | URL | Uint8Array, mapping: readonly RecolorSwap[], options: ApplyRecolorOptions & {
    /** Where to write the PNG. */
    out: string;
    /** No longer read. */
    fingerprint?: Fingerprint;
    /** No longer read. */
    cache?: string | false;
    /** The print's visible content, for the measurement (`legibilitySampling`). */
    contentBounds?: ContentBounds | null;
}): Promise<AppliedRecolor>;
/**
 * Decode a print file exactly as the legibility engine samples it
 * (`legibilitySampling` in the engine entry point): EXIF orientation applied,
 * cropped to `contentBounds` plus a 1% margin when given (not for a file with
 * an EXIF orientation), fit inside 1024 px with nearest-neighbor sampling, in
 * sRGB with alpha. POD's Creative ink legibility gate decodes the same way,
 * so its measurements match the MCP tools' for the same file and bounds.
 *
 * @throws {Error} when `sharp` is missing.
 * @throws {TypeError} when the file is not PNG, WebP, or JPEG.
 */
export declare function decodeForLegibility(bytes: Uint8Array, options?: {
    contentBounds?: ContentBounds | null;
}): Promise<RgbaPixels>;
/**
 * Write RGBA pixels (straight alpha) as a PNG, as `applyRecolor` writes its
 * output. For pixels from the engine's `substitutePigments`.
 *
 * @throws {Error} when `sharp` is missing.
 */
export declare function writePng(pixels: RgbaPixels, out: string): Promise<void>;
/** A design file decoded and measured for the engine. */
export interface AnalyzedDesignFile {
    /** SHA-256 of the file bytes, lowercase hex: the measurement's `bytesChecksum`. */
    hash: string;
    /** The sampled pixels the analysis measured, for `planArtworkOptions`. */
    pixels: RgbaPixels;
    analysis: DesignAnalysis;
}
/**
 * Decode a design file with `decodeForLegibility` and measure it with the
 * engine's `analyzeDesign`. `file` is a path, a file URL, or the file's bytes.
 *
 * @throws {Error} when `sharp` is missing.
 * @throws {TypeError} when the file is not PNG, WebP, or JPEG.
 */
export declare function analyzeDesignFile(file: string | URL | Uint8Array, options?: {
    contentBounds?: ContentBounds | null;
}): Promise<AnalyzedDesignFile>;
/** Compare decoded print pixels, including alpha, rather than file encoding or source appearance. */
export declare function comparePrintFiles(approved: string | Uint8Array, provider: string | Uint8Array): Promise<{
    matches: boolean;
    reason: string;
}>;
//# sourceMappingURL=index.d.ts.map