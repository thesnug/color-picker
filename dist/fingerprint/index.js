/**
 * `@thesnug/color-picker/fingerprint`: reduce a design file to a small,
 * cacheable fingerprint that recommendations and Jev calls are keyed on. See
 * docs/DESIGN.md, "Pipelines".
 *
 * This entry point reads files and writes a cache, so it is kept out of the
 * core. Decoding uses `sharp`, an optional peer dependency: install it next to
 * this package, or pass your own `decoder`.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { extractPalette, hasTransparency, inkLuminance, PALETTE_DEFAULTS, } from "./quantize.js";
import { askVision, defaultVisionProviders, describePrompt, descriptionCachePath, descriptionSchema, labelPalette, readDescriptionCache, sniffMediaType, writeDescriptionCache, } from "./describe.js";
import { RECOLOR_DEFAULTS, recolorPixels } from "./recolor.js";
export { codexProvider, CODEX_DEFAULT_MODEL, DESCRIPTION_VERSION, defaultVisionProviders, describePrompt, descriptionSchema, labelPalette, OPENROUTER_DEFAULT_MODEL, openRouterProvider, validateAnswer, VisionUnavailableError, } from "./describe.js";
export { RECOLOR_DEFAULTS, recolorPixels, } from "./recolor.js";
export { extractPalette, hasTransparency, INK_ALPHA_THRESHOLD, INK_LUMINANCE_EMPTY, inkLuminance, PALETTE_DEFAULTS, } from "./quantize.js";
/** Bump when the fingerprint's output changes for the same file and options, to invalidate caches. */
export const FINGERPRINT_VERSION = 1;
const MAX_DIMENSION = 512;
export function defaultCacheDir() {
    const base = process.env.XDG_CACHE_HOME || join(homedir(), ".cache");
    return join(base, "color-picker", "fingerprints");
}
// ---------------------------------------------------------------------------
// Decoding
const FORMATS = new Set(["png", "webp", "jpeg"]);
/**
 * The default decoder. Downsamples with nearest-neighbor so every sampled pixel
 * is a real pixel of the file: smoothing kernels would blend colors and
 * invent palette entries.
 */
export const sharpDecoder = async (bytes, { maxDimension }) => {
    const sharp = await loadSharp("Design fingerprinting", ", or pass a `decoder`");
    const meta = await sharp(bytes).metadata();
    if (!FORMATS.has(meta.format)) {
        throw new TypeError(`Unsupported image format "${meta.format}"; expected PNG, WebP, or JPEG.`);
    }
    let pipeline = sharp(bytes).autoOrient();
    // An infinite hint means full size, as `applyRecolor` needs.
    if (Number.isFinite(maxDimension)) {
        pipeline = pipeline.resize({
            width: maxDimension,
            height: maxDimension,
            fit: "inside",
            withoutEnlargement: true,
            kernel: "nearest",
        });
    }
    const { data, info } = await pipeline
        .toColorspace("srgb")
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
    return {
        width: meta.autoOrient.width,
        height: meta.autoOrient.height,
        pixels: { data, width: info.width, height: info.height },
    };
};
async function loadSharp(what, alternative = "") {
    try {
        return (await import("sharp")).default;
    }
    catch {
        throw new Error(`${what} needs \`sharp\`, an optional peer dependency. Install it with \`npm install sharp\`${alternative}.`);
    }
}
function cachePath(dir, hash, settings) {
    const key = createHash("sha256")
        .update(JSON.stringify({ version: FINGERPRINT_VERSION, ...settings }))
        .digest("hex")
        .slice(0, 12);
    return join(dir, `${hash}.${key}.json`);
}
async function readCache(path) {
    try {
        const entry = JSON.parse(await readFile(path, "utf8"));
        return entry.version === FINGERPRINT_VERSION ? entry.fingerprint : undefined;
    }
    catch {
        // Missing or unreadable: recompute and overwrite.
        return undefined;
    }
}
async function writeCache(dir, path, entry) {
    await mkdir(dir, { recursive: true });
    // Write then rename, so a concurrent reader never sees half a file.
    const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temp, `${JSON.stringify(entry, null, 2)}\n`);
    await rename(temp, path);
}
// ---------------------------------------------------------------------------
// Fingerprint
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
export async function fingerprint(file, options = {}) {
    const bytes = file instanceof Uint8Array ? file : await readFile(file);
    const hash = createHash("sha256").update(bytes).digest("hex");
    const settings = {
        alphaThreshold: options.alphaThreshold ?? PALETTE_DEFAULTS.alphaThreshold,
        colors: options.colors ?? PALETTE_DEFAULTS.colors,
        mergeDistance: options.mergeDistance ?? PALETTE_DEFAULTS.mergeDistance,
        maxDimension: options.maxDimension ?? MAX_DIMENSION,
    };
    const dir = options.cache === undefined ? defaultCacheDir() : options.cache;
    const path = dir === false ? undefined : cachePath(dir, hash, settings);
    if (path) {
        const cached = await readCache(path);
        if (cached)
            return cached;
    }
    const decode = options.decoder ?? sharpDecoder;
    const { width, height, pixels } = await decode(bytes, { maxDimension: settings.maxDimension });
    const result = {
        hash,
        palette: extractPalette(pixels, settings),
        inkLuminance: Number(inkLuminance(pixels).toFixed(5)),
        hasTransparency: hasTransparency(pixels),
        width,
        height,
    };
    if (dir !== false && path) {
        await writeCache(dir, path, { version: FINGERPRINT_VERSION, settings, fingerprint: result });
    }
    return result;
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
export async function describeDesign(print, file, options = {}) {
    const bytes = file instanceof Uint8Array ? file : await readFile(file);
    if (createHash("sha256").update(bytes).digest("hex") !== print.hash) {
        throw new Error("The file does not match the fingerprint's hash; fingerprint this file first.");
    }
    const prompt = describePrompt(print.palette);
    const dir = options.cache === undefined ? defaultCacheDir() : options.cache;
    const path = dir === false ? undefined : descriptionCachePath(dir, print.hash, prompt);
    let description = path ? await readDescriptionCache(path, prompt) : undefined;
    if (!description) {
        const image = { bytes, mediaType: sniffMediaType(bytes) };
        const request = {
            image,
            prompt,
            schema: descriptionSchema(print.palette),
            ...(options.signal ? { signal: options.signal } : {}),
        };
        description = await askVision(options.providers ?? defaultVisionProviders(), request, print.palette);
        if (dir !== false && path)
            await writeDescriptionCache(dir, path, prompt, description);
    }
    return { ...print, palette: labelPalette(print.palette, description), description };
}
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
export async function applyRecolor(file, mapping, options) {
    const { minCoverage, maxUnmatched, tolerance } = { ...RECOLOR_DEFAULTS, ...options };
    const bytes = file instanceof Uint8Array ? file : await readFile(file);
    const print = options.fingerprint ??
        (await fingerprint(bytes, options.cache === undefined ? {} : { cache: options.cache }));
    const coverage = print.palette.reduce((sum, c) => sum + c.share, 0);
    if (coverage < minCoverage) {
        return {
            applicable: false,
            reason: `The design's ${print.palette.length} main colors cover only ${Math.round(coverage * 100)}% of it, ` +
                `below ${Math.round(minCoverage * 100)}%; it looks photographic or gradient-heavy, so use the prompt instead.`,
        };
    }
    const { width, height, pixels } = await sharpDecoder(bytes, { maxDimension: Infinity });
    const result = recolorPixels(pixels, mapping, { tolerance });
    if (result.unmatched > maxUnmatched) {
        return {
            applicable: false,
            reason: `${Math.round(result.unmatched * 100)}% of the design is farther than ${tolerance} from every mapped color, ` +
                `above ${Math.round(maxUnmatched * 100)}%; it is not flat enough to recolor exactly, so use the prompt instead.`,
        };
    }
    const sharp = await loadSharp("Recoloring");
    await sharp(result.pixels.data, { raw: { width: pixels.width, height: pixels.height, channels: 4 } })
        .png({ compressionLevel: 9 })
        .toFile(options.out);
    return { applicable: true, out: options.out, width, height, unmatched: result.unmatched };
}
//# sourceMappingURL=index.js.map