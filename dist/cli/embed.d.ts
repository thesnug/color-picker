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
export declare const EMBED_SIZE = 400;
/** Set to `0` to skip embedding and keep photo URLs, for offline runs and tests. */
export declare const EMBED_ENV = "COLOR_PICKER_EMBED_IMAGES";
export interface EmbedOptions {
    /** Fetch implementation. Defaults to the global `fetch`. */
    fetch?: typeof fetch;
}
/** Markup with photos inlined, and the photos that kept their URLs. */
export interface EmbedResult {
    markup: string;
    /** Photo URLs left in the markup, each with the reason. Empty when every photo was inlined. */
    notEmbedded: {
        url: string;
        reason: string;
    }[];
}
/**
 * Replace each remote `<image href>` in SVG or HTML markup with an inline
 * data URI. Markup without remote images comes back unchanged.
 */
export declare function embedImages(markup: string, options?: EmbedOptions): Promise<EmbedResult>;
/**
 * A one-line warning for photos that kept their URLs, or undefined when there
 * are none. Photos that share a reason are counted together.
 */
export declare function embedWarning(result: EmbedResult): string | undefined;
//# sourceMappingURL=embed.d.ts.map