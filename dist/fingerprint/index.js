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
import { RECOLOR_DEFAULTS } from "./recolor.js";
import { analyzeDesign, measureInkPixels } from "../engine/measure.js";
import { substitutionReplacements } from "../engine/plans.js";
import { legibilitySampling } from "../engine/sampling.js";
import { RecolorPigmentError, substitutePigments } from "../engine/substitute.js";
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
/** Visible preview only: fingerprinting always measures the original alpha-bearing file. */
export async function visionPreview(bytes, print) {
    if (!print.hasTransparency)
        return { bytes, mediaType: sniffMediaType(bytes) };
    const sharp = await loadSharp("Transparent-art vision preview");
    const background = print.inkLuminance > 0.5 ? "#242424" : "#ffffff";
    const preview = await sharp(bytes).autoOrient().resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
        .flatten({ background }).png().toBuffer();
    return { bytes: preview, mediaType: "image/png" };
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
        const image = await visionPreview(bytes, print);
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
export async function applyRecolor(file, mapping, options) {
    const bytes = file instanceof Uint8Array ? file : await readFile(file);
    const hash = createHash("sha256").update(bytes).digest("hex");
    const measurement = measureInkPixels(await decodeForLegibility(bytes, { contentBounds: options.contentBounds ?? null }), hash);
    if (measurement.approximate) {
        return {
            applicable: false,
            reason: `The design's ${measurement.clusters.length} measured inks cover ${Math.round(measurement.coverage * 100)}% of it ` +
                `and ${Math.round(measurement.unmatchedShare * 100)}% of its ink is far from all of them; ` +
                `it looks photographic or gradient-heavy, so use the prompt instead.`,
        };
    }
    const replacements = substitutionReplacements(mapping, measurement, { keepIdentity: true });
    if (!replacements) {
        return {
            applicable: false,
            reason: "A mapped color matches none of the design's measured inks within 5 (or two mapped colors share one ink), " +
                "so the pigments cannot be substituted exactly; use the prompt instead.",
        };
    }
    const { minCoverage, maxUnmatched } = { ...RECOLOR_DEFAULTS, ...options };
    const mapped = new Set(replacements.map((r) => r.from));
    const coverage = measurement.clusters.reduce((sum, c) => sum + (mapped.has(c.hex) ? c.share : 0), 0);
    if (coverage < minCoverage) {
        return {
            applicable: false,
            reason: `The mapped colors cover only ${Math.round(coverage * 100)}% of the design's ink, below ${Math.round(minCoverage * 100)}%; ` +
                `it looks photographic or gradient-heavy, or the mapping leaves an ink out, so use the prompt instead.`,
        };
    }
    const { width, height, pixels } = await sharpDecoder(bytes, { maxDimension: Infinity });
    let substituted;
    try {
        substituted = substitutePigments(pixels, { replacements });
    }
    catch (error) {
        if (!(error instanceof RecolorPigmentError))
            throw error;
        return { applicable: false, reason: `${error.message} Use the prompt instead.` };
    }
    // Weighted by alpha, as it prints: near-transparent residue around the art barely counts.
    const { unmatched } = substituted;
    if (unmatched > maxUnmatched) {
        return {
            applicable: false,
            reason: `${Math.round(unmatched * 100)}% of the design's visible ink, weighted by alpha, matches no mapped pigment, ` +
                `above ${Math.round(maxUnmatched * 100)}%; it is not flat enough to recolor exactly, so use the prompt instead.`,
        };
    }
    await writePng(substituted.pixels, options.out);
    return { applicable: true, out: options.out, width, height, replacements, changed: substituted.changed, unmatched };
}
// ---------------------------------------------------------------------------
// Legibility
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
export async function decodeForLegibility(bytes, options = {}) {
    const sharp = await loadSharp("Ink legibility");
    const metadata = await sharp(bytes).metadata();
    if (!FORMATS.has(metadata.format)) {
        throw new TypeError(`Unsupported image format "${metadata.format}"; expected PNG, WebP, or JPEG.`);
    }
    const sampling = legibilitySampling({
        width: metadata.width ?? 0,
        height: metadata.height ?? 0,
        oriented: (metadata.orientation ?? 1) > 1,
        contentBounds: options.contentBounds ?? null,
    });
    let pipeline = sharp(bytes).autoOrient();
    if (sampling.extract)
        pipeline = pipeline.extract(sampling.extract);
    const { data, info } = await pipeline
        .resize(sampling.resize)
        .toColorspace("srgb")
        .ensureAlpha()
        .raw({ depth: "uchar" })
        .toBuffer({ resolveWithObject: true });
    if (info.channels !== 4)
        throw new Error("Ink legibility needs an RGBA print file.");
    return { data: new Uint8Array(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height };
}
/**
 * Write RGBA pixels (straight alpha) as a PNG, as `applyRecolor` writes its
 * output. For pixels from the engine's `substitutePigments`.
 *
 * @throws {Error} when `sharp` is missing.
 */
export async function writePng(pixels, out) {
    const sharp = await loadSharp("Writing a PNG");
    await sharp(pixels.data, { raw: { width: pixels.width, height: pixels.height, channels: 4 } })
        .png({ compressionLevel: 9 })
        .toFile(out);
}
/**
 * Decode a design file with `decodeForLegibility` and measure it with the
 * engine's `analyzeDesign`. `file` is a path, a file URL, or the file's bytes.
 *
 * @throws {Error} when `sharp` is missing.
 * @throws {TypeError} when the file is not PNG, WebP, or JPEG.
 */
export async function analyzeDesignFile(file, options = {}) {
    const bytes = file instanceof Uint8Array ? file : await readFile(file);
    const hash = createHash("sha256").update(bytes).digest("hex");
    const pixels = await decodeForLegibility(bytes, options);
    return { hash, pixels, analysis: analyzeDesign(pixels, hash) };
}
/** Compare decoded print pixels, including alpha, rather than file encoding or source appearance. */
export async function comparePrintFiles(approved, provider) {
    const read = async (file) => sharpDecoder(file instanceof Uint8Array ? file : await readFile(file), { maxDimension: Infinity });
    const a = await read(approved);
    const b = await read(provider);
    if (a.width !== b.width || a.height !== b.height)
        return { matches: false, reason: "Print dimensions differ." };
    for (let i = 0; i < a.pixels.data.length; i += 4) {
        if (a.pixels.data[i + 3] !== b.pixels.data[i + 3])
            return { matches: false, reason: "Print alpha differs from the approved rendition." };
        // RGB hidden by full transparency has no printed meaning.
        if (a.pixels.data[i + 3] === 0)
            continue;
        for (let channel = 0; channel < 3; channel++) {
            if (a.pixels.data[i + channel] !== b.pixels.data[i + channel])
                return { matches: false, reason: "Visible print pixels differ from the approved rendition." };
        }
    }
    return { matches: true, reason: "Decoded dimensions, alpha and visible pixels match the approved rendition." };
}
//# sourceMappingURL=index.js.map