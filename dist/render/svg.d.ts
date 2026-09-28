/**
 * SVG renderers: combination strips, swatch grids, and product cards.
 * Hand-built strings, no dependencies. Every value that reaches the markup
 * passes through `escapeXml` or `normalizeHex`.
 *
 * Text outside the tiles uses `currentColor`, so an SVG inlined in a page takes
 * the page's text color and reads on both light and dark backgrounds.
 */
import { type Swatch } from "./shared.js";
export interface CombinationInput {
    /** The book's combination ID, used in the default title. */
    id?: number;
    /** Member colors, resolved. */
    colors: readonly Swatch[];
}
export interface CombinationOptions {
    /** Width of each tile in pixels. Default 128. */
    tileWidth?: number;
    /** Height of each tile in pixels. Default 112. */
    tileHeight?: number;
    /** Heading above the strip. Defaults to "Combination <id>" when the ID is known. Pass `""` for none. */
    title?: string;
    /** Show WCAG ratio and APCA Lc badges between adjacent tiles. Default false. */
    contrast?: boolean;
}
/** Contrast between two adjacent tiles, as shown on a badge. */
export interface PairContrast {
    /** WCAG 2.x contrast ratio, 1 to 21. Symmetric. */
    wcag: number;
    /** APCA Lc of the left color as text on the right color. Signed. */
    apca: number;
}
/** The numbers a combination badge shows for a pair of adjacent colors. */
export declare function pairContrast(left: string, right: string): PairContrast;
/**
 * Render a combination as a strip of tiles in book order, one per color, each
 * with its Wada name and hex. With `contrast`, a badge under each boundary shows
 * the WCAG ratio and APCA Lc of the two colors it separates.
 */
export declare function renderCombination(combo: CombinationInput, options?: CombinationOptions): string;
export interface SwatchGridOptions {
    /** Tiles per row. Default 6, or fewer when there are fewer colors. */
    columns?: number;
    /** Width of each tile in pixels. Default 128. */
    tileWidth?: number;
    /** Height of each tile in pixels. Default 96. */
    tileHeight?: number;
    /** Space between tiles in pixels. Default 8. */
    gap?: number;
    /** Heading above the grid. */
    title?: string;
}
/**
 * Render any list of colors as a grid of labeled tiles: nearest-match results,
 * a whole collection, a product's color range. Put a distance or other detail
 * in each swatch's `note`.
 */
export declare function renderSwatchGrid(colors: readonly Swatch[], options?: SwatchGridOptions): string;
export interface SwatchStripOptions {
    /** Width of each tile in pixels. Default 96. */
    tileWidth?: number;
    /** Height of each tile in pixels. Default 64. */
    tileHeight?: number;
}
/**
 * Render a strip of solid, unlabeled tiles. Each tile carries its hex as a
 * `<title>`. Prefer `renderSwatchGrid` for anything a person reads.
 */
export declare function renderSwatchStripSvg(hexes: readonly string[], options?: SwatchStripOptions): string;
/** A product color as the card needs it. `ProductColor` from the data entry point fits. */
export interface ProductCardColor extends Swatch {
    /** Public garment photo. Drawn over the tile when present. */
    image?: {
        url: string;
    };
}
export interface ProductCardOptions {
    /** The design's colors, drawn as chips beside the garment. */
    designColors?: readonly Swatch[];
    /**
     * A recolor's swaps, drawn as a before chip, an arrow, and an after chip per
     * row beside the garment. Replaces `designColors` when given.
     */
    recolor?: readonly {
        from: Swatch;
        to: Swatch;
    }[];
    /** Product display name, shown as the heading. */
    productName?: string;
    /** Side of the square garment tile in pixels. Default 200. */
    garmentSize?: number;
    /** Side of each design-color chip in pixels. Default 40. */
    chipSize?: number;
}
/**
 * Render a product color as a card: the garment tile, with the garment photo
 * over it when the color has an `image.url`, and the design's colors as chips
 * beside it, or a recolor's before and after chips. Without an image the tile
 * is plain.
 */
export declare function renderProductCard(productColor: ProductCardColor, options?: ProductCardOptions): string;
//# sourceMappingURL=svg.d.ts.map