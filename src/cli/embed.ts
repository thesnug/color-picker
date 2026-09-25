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
 * or decode error, the photo keeps its URL, and the result says which photos
 * and why so the caller can warn that the card may show broken images.
 */

/** Longest side of an inlined photo in pixels: twice the default 200px tile, for sharp screens. */
export const EMBED_SIZE = 400;

/** Set to `0` to skip embedding and keep photo URLs, for offline runs and tests. */
export const EMBED_ENV = "COLOR_PICKER_EMBED_IMAGES";

const FETCH_TIMEOUT_MS = 15_000;

export interface EmbedOptions {
  /** Fetch implementation. Defaults to the global `fetch`. */
  fetch?: typeof fetch;
}

/** One photo's outcome: its data URI, or why it kept its URL. */
type Inlined = { uri: string } | { error: string };

/** Markup with photos inlined, and the photos that kept their URLs. */
export interface EmbedResult {
  markup: string;
  /** Photo URLs left in the markup, each with the reason. Empty when every photo was inlined. */
  notEmbedded: { url: string; reason: string }[];
}

/** Outcomes by photo URL. Failures are cached too, so one bad URL is tried once. */
const cache = new Map<string, Promise<Inlined>>();

const IMAGE_HREF = /(<image\b[^>]*?\bhref=")(https?:\/\/[^"]+)(")/g;

/**
 * Replace each remote `<image href>` in SVG or HTML markup with an inline
 * data URI. Markup without remote images comes back unchanged.
 */
export async function embedImages(markup: string, options: EmbedOptions = {}): Promise<EmbedResult> {
  const urls = [...new Set([...markup.matchAll(IMAGE_HREF)].map((m) => unescapeXml(m[2]!)))];
  if (urls.length === 0) return { markup, notEmbedded: [] };
  if (process.env[EMBED_ENV] === "0") {
    return { markup, notEmbedded: urls.map((url) => ({ url, reason: `${EMBED_ENV}=0` })) };
  }
  const outcomes = new Map(await Promise.all(urls.map(async (url) => [url, await inline(url, options)] as const)));
  const notEmbedded = [...outcomes].flatMap(([url, o]) => ("error" in o ? [{ url, reason: o.error }] : []));
  const out = markup.replace(IMAGE_HREF, (whole, open: string, href: string, close: string) => {
    const o = outcomes.get(unescapeXml(href));
    return o && "uri" in o ? `${open}${o.uri}${close}` : whole;
  });
  return { markup: out, notEmbedded };
}

/**
 * A one-line warning for photos that kept their URLs, or undefined when there
 * are none. Photos that share a reason are counted together.
 */
export function embedWarning(result: EmbedResult): string | undefined {
  if (result.notEmbedded.length === 0) return undefined;
  const reasons = [...new Set(result.notEmbedded.map((n) => n.reason))];
  const n = result.notEmbedded.length;
  return (
    `${n} garment photo${n === 1 ? "" : "s"} could not be embedded (${reasons.join("; ")}), so the card ` +
    `links ${n === 1 ? "it" : "them"} by URL. Hosts that show an SVG file as an image block those links ` +
    `and show a broken-image icon.`
  );
}

function inline(url: string, options: EmbedOptions): Promise<Inlined> {
  // A custom fetch is a test double; keep its results out of the shared cache.
  if (options.fetch) return download(url, options.fetch);
  let entry = cache.get(url);
  if (!entry) {
    entry = download(url, fetch);
    // Missing sharp is not the URL's fault; let a later call retry once it is installed.
    void entry.then((o) => {
      if ("error" in o && o.error === NO_SHARP) cache.delete(url);
    });
    cache.set(url, entry);
  }
  return entry;
}

const NO_SHARP = "sharp is not installed; install it next to @thesnug/color-picker";

async function download(url: string, fetchImpl: typeof fetch): Promise<Inlined> {
  let sharp: typeof import("sharp").default;
  try {
    sharp = (await import("sharp")).default;
  } catch {
    return { error: NO_SHARP };
  }
  try {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!response.ok) return { error: `fetching the photo returned HTTP ${response.status}` };
    const bytes = Buffer.from(await response.arrayBuffer());
    const jpeg = await sharp(bytes)
      .rotate()
      .resize(EMBED_SIZE, EMBED_SIZE, { fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer();
    return { uri: `data:image/jpeg;base64,${jpeg.toString("base64")}` };
  } catch (error) {
    return { error: `the photo could not be fetched or decoded (${(error as Error).message})` };
  }
}

function unescapeXml(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}
