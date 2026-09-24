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
export { codexProvider, type CodexProviderOptions, CODEX_DEFAULT_MODEL, type DescribedElement, type DescriptionAnswer, DESCRIPTION_VERSION, type DesignDescription, defaultVisionProviders, describePrompt, descriptionSchema, labelPalette, OPENROUTER_DEFAULT_MODEL, openRouterProvider, type OpenRouterProviderOptions, validateAnswer, type VisionImage, type VisionProvider, type VisionProviderName, type VisionRequest, VisionUnavailableError, } from "./describe.js";
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
    /** Alpha-weighted share of visible pixels farther than `tolerance` from every `from` color. */
    unmatched: number;
} | {
    applicable: false;
    /** Why the art was not recolored; use the plan's prompt instead. */
    reason: string;
};
/**
 * Recolor flat-color art by a recolor mapping and write the result as a PNG:
 * every visible pixel takes the `to` color of its nearest `from` color in
 * OKLab, keeping its alpha, so the output holds only the mapped colors plus
 * transparency. `mapping` is a `RecolorPlan`'s `mapping`.
 *
 * Photographic or heavily gradient art cannot be recolored this way. It is
 * detected first from the fingerprint, when its palette covers less than
 * `minCoverage` of the design, then from the pixels, when more than
 * `maxUnmatched` of them are farther than `tolerance` from every `from` color.
 * Either returns `{ applicable: false, reason }` and writes nothing.
 *
 * @throws {Error} when `sharp` is missing.
 * @throws {TypeError} when the file is not PNG, WebP, or JPEG.
 */
export declare function applyRecolor(file: string | URL | Uint8Array, mapping: readonly RecolorSwap[], options: ApplyRecolorOptions & {
    /** Where to write the PNG. */
    out: string;
    /** The design's fingerprint, when already computed. */
    fingerprint?: Fingerprint;
    /** As for `fingerprint`, when it is computed here. */
    cache?: string | false;
}): Promise<AppliedRecolor>;
//# sourceMappingURL=index.d.ts.map