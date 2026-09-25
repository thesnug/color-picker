/**
 * Garment photos inlined into rendered cards, so a card file shows its photo
 * wherever it is opened.
 *
 * Product cards reference each garment photo by public URL. A browser blocks
 * every external fetch from an SVG shown as an image (a file preview, an
 * `<img>`, an artifact), and sandboxed HTML viewers block it by CSP, so a card
 * written to a file needs its photos inside it. Each photo is fetched once per
 * process, downscaled with `sharp`, and inlined as a JPEG data URI.
 *
 * Embedding never fails a render: without `sharp`, offline, or on any fetch
 * or decode error, the photo keeps its URL.
 */
/** Longest side of an inlined photo in pixels: twice the default 200px tile, for sharp screens. */
export const EMBED_SIZE = 400;
/** Set to `0` to skip embedding and keep photo URLs, for offline runs and tests. */
export const EMBED_ENV = "COLOR_PICKER_EMBED_IMAGES";
const FETCH_TIMEOUT_MS = 15_000;
/** Inline data URIs by photo URL. Failures are cached as undefined, so one bad URL is tried once. */
const cache = new Map();
const IMAGE_HREF = /(<image\b[^>]*?\bhref=")(https?:\/\/[^"]+)(")/g;
/**
 * Replace each remote `<image href>` in SVG or HTML markup with an inline
 * data URI. Markup without remote images comes back unchanged.
 */
export async function embedImages(markup, options = {}) {
    if (process.env[EMBED_ENV] === "0")
        return markup;
    const urls = [...new Set([...markup.matchAll(IMAGE_HREF)].map((m) => unescapeXml(m[2])))];
    if (urls.length === 0)
        return markup;
    const inlined = new Map(await Promise.all(urls.map(async (url) => [url, await dataUri(url, options)])));
    return markup.replace(IMAGE_HREF, (whole, open, href, close) => {
        const uri = inlined.get(unescapeXml(href));
        return uri ? `${open}${uri}${close}` : whole;
    });
}
function dataUri(url, options) {
    // A custom fetch is a test double; keep its results out of the shared cache.
    if (options.fetch)
        return download(url, options.fetch);
    let entry = cache.get(url);
    if (!entry) {
        entry = download(url, fetch);
        cache.set(url, entry);
    }
    return entry;
}
async function download(url, fetchImpl) {
    try {
        const sharp = (await import("sharp")).default;
        const response = await fetchImpl(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
        if (!response.ok)
            return undefined;
        const bytes = Buffer.from(await response.arrayBuffer());
        const jpeg = await sharp(bytes)
            .rotate()
            .resize(EMBED_SIZE, EMBED_SIZE, { fit: "inside", withoutEnlargement: true })
            .flatten({ background: "#ffffff" })
            .jpeg({ quality: 82, mozjpeg: true })
            .toBuffer();
        return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
    }
    catch {
        return undefined;
    }
}
function unescapeXml(value) {
    return value
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&");
}
//# sourceMappingURL=embed.js.map