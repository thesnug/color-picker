/**
 * SVG renderers: combination strips, swatch grids, and product cards.
 * Hand-built strings, no dependencies. Every value that reaches the markup
 * passes through `escapeXml` or `normalizeHex`.
 *
 * Text outside the tiles uses `currentColor`, so an SVG inlined in a page takes
 * the page's text color and reads on both light and dark backgrounds.
 */

import { apcaContrast, contrastRatio } from "../color/contrast.js";
import { type Swatch, escapeXml, fmt, readableTextColor, swatchHex, wrapText } from "./shared.js";

const FONT = "system-ui, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif";
const MONO = "ui-monospace, 'SF Mono', Menlo, Consolas, monospace";
/** Rough advance width of one character as a fraction of the font size. */
const CHAR_WIDTH = 0.6;
const PAD = 8;
const TITLE_HEIGHT = 28;

function svgDocument(width: number, height: number, label: string, body: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
    `viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(label)}" ` +
    `font-family="${escapeXml(FONT)}">` +
    `<title>${escapeXml(label)}</title>${body}</svg>`
  );
}

function titleText(title: string): string {
  return (
    `<text x="0" y="18" font-size="15" font-weight="600" fill="currentColor">` +
    `${escapeXml(title)}</text>`
  );
}

function describe(swatch: Swatch): string {
  const hex = swatchHex(swatch);
  return swatch.name ? `${swatch.name} ${hex}` : hex;
}

/**
 * One tile: a filled rectangle with the name, hex, and note stacked at the
 * bottom-left in black or white, whichever reads better on the fill.
 */
function tile(x: number, y: number, width: number, height: number, swatch: Swatch): string {
  const hex = swatchHex(swatch);
  const ink = readableTextColor(hex);
  const nameSize = 12;
  const maxChars = Math.floor((width - 2 * PAD) / (nameSize * CHAR_WIDTH));

  const lines: { text: string; size: number; weight?: number; mono?: boolean }[] = [];
  if (swatch.name) {
    for (const line of wrapText(swatch.name, maxChars)) {
      lines.push({ text: line, size: nameSize, weight: 600 });
    }
  }
  lines.push({ text: hex, size: 11, mono: true });
  if (swatch.note) {
    for (const line of wrapText(swatch.note, maxChars, 1)) lines.push({ text: line, size: 11 });
  }

  let baseline = y + height - PAD;
  const texts: string[] = [];
  for (const line of [...lines].reverse()) {
    const attrs = [
      `x="${x + PAD}"`,
      `y="${baseline}"`,
      `font-size="${line.size}"`,
      line.weight ? `font-weight="${line.weight}"` : "",
      line.mono ? `font-family="${escapeXml(MONO)}"` : "",
      `fill="${ink}"`,
    ]
      .filter(Boolean)
      .join(" ");
    texts.unshift(`<text ${attrs}>${escapeXml(line.text)}</text>`);
    baseline -= line.size + 3;
  }

  return (
    `<g><title>${escapeXml(describe(swatch))}</title>` +
    `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${hex}"/>` +
    `${texts.join("")}</g>`
  );
}

// ---------------------------------------------------------------------------
// Combination

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
export function pairContrast(left: string, right: string): PairContrast {
  return { wcag: contrastRatio(left, right), apca: apcaContrast(left, right) };
}

/**
 * Members in book order. The source records no in-book sequence, so book order
 * is ascending Wada index; when any member lacks an index the given order stands.
 */
function bookOrder(colors: readonly Swatch[]): Swatch[] {
  if (colors.every((c) => c.index !== undefined)) {
    return [...colors].sort((a, b) => a.index! - b.index!);
  }
  return [...colors];
}

function contrastBadge(cx: number, y: number, left: Swatch, right: Swatch): string {
  const { wcag, apca } = pairContrast(swatchHex(left), swatchHex(right));
  const label = `${fmt(wcag)}:1 · Lc ${Math.round(apca)}`;
  const width = Math.ceil(label.length * 11 * CHAR_WIDTH) + 16;
  const height = 22;
  const detail =
    `${describe(left)} and ${describe(right)}: WCAG ${fmt(wcag)}:1, ` +
    `APCA Lc ${fmt(apca, 1)} (left as text on right)`;
  return (
    `<g><title>${escapeXml(detail)}</title>` +
    `<rect x="${cx - width / 2}" y="${y}" width="${width}" height="${height}" rx="11" ` +
    `fill="#ffffff" stroke="#00000033"/>` +
    `<text x="${cx}" y="${y + 15}" font-size="11" text-anchor="middle" fill="#1a1a1a">` +
    `${escapeXml(label)}</text></g>`
  );
}

/**
 * Render a combination as a strip of tiles in book order, one per color, each
 * with its Wada name and hex. With `contrast`, a badge under each boundary shows
 * the WCAG ratio and APCA Lc of the two colors it separates.
 */
export function renderCombination(
  combo: CombinationInput,
  options: CombinationOptions = {},
): string {
  const tileWidth = options.tileWidth ?? 128;
  const tileHeight = options.tileHeight ?? 112;
  const title = options.title ?? (combo.id !== undefined ? `Combination ${combo.id}` : "");
  const colors = bookOrder(combo.colors);

  const top = title ? TITLE_HEIGHT : 0;
  const showBadges = options.contrast === true && colors.length > 1;
  const width = Math.max(tileWidth * colors.length, 1);
  const height = top + tileHeight + (showBadges ? 34 : 0);

  const parts: string[] = [];
  if (title) parts.push(titleText(title));
  colors.forEach((c, i) => parts.push(tile(i * tileWidth, top, tileWidth, tileHeight, c)));
  if (showBadges) {
    for (let i = 1; i < colors.length; i++) {
      parts.push(contrastBadge(i * tileWidth, top + tileHeight + 6, colors[i - 1]!, colors[i]!));
    }
  }

  const names = colors.map((c) => c.name ?? swatchHex(c)).join(", ");
  const label = title ? `${title}: ${names}` : names || "Empty combination";
  return svgDocument(width, height, label, parts.join(""));
}

// ---------------------------------------------------------------------------
// Swatch grid

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
export function renderSwatchGrid(
  colors: readonly Swatch[],
  options: SwatchGridOptions = {},
): string {
  const tileWidth = options.tileWidth ?? 128;
  const tileHeight = options.tileHeight ?? 96;
  const gap = options.gap ?? 8;
  const columns = Math.max(1, Math.min(options.columns ?? 6, colors.length || 1));
  const rows = Math.ceil(colors.length / columns);
  const title = options.title ?? "";
  const top = title ? TITLE_HEIGHT : 0;

  const parts: string[] = [];
  if (title) parts.push(titleText(title));

  if (colors.length === 0) {
    const width = Math.max(tileWidth, 160);
    parts.push(
      `<text x="0" y="${top + 18}" font-size="13" fill="currentColor">No colors</text>`,
    );
    return svgDocument(width, top + 28, title || "No colors", parts.join(""));
  }

  colors.forEach((c, i) => {
    const x = (i % columns) * (tileWidth + gap);
    const y = top + Math.floor(i / columns) * (tileHeight + gap);
    parts.push(tile(x, y, tileWidth, tileHeight, c));
  });

  const width = columns * tileWidth + (columns - 1) * gap;
  const height = top + rows * tileHeight + (rows - 1) * gap;
  const label = `${title || "Color swatches"}: ${colors.map((c) => c.name ?? swatchHex(c)).join(", ")}`;
  return svgDocument(width, height, label, parts.join(""));
}

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
export function renderSwatchStripSvg(
  hexes: readonly string[],
  options: SwatchStripOptions = {},
): string {
  const tileWidth = options.tileWidth ?? 96;
  const tileHeight = options.tileHeight ?? 64;
  const width = tileWidth * hexes.length;
  const tiles = hexes
    .map((hex, i) => {
      const safe = escapeXml(hex);
      return (
        `<rect x="${i * tileWidth}" y="0" width="${tileWidth}" height="${tileHeight}" fill="${safe}">` +
        `<title>${safe}</title></rect>`
      );
    })
    .join("");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${tileHeight}" ` +
    `viewBox="0 0 ${width} ${tileHeight}" role="img" aria-label="Color swatches">` +
    `${tiles}</svg>`
  );
}

// ---------------------------------------------------------------------------
// Product card

/** A product color as the card needs it. `ProductColor` from the data entry point fits. */
export interface ProductCardColor extends Swatch {
  /** Public garment photo. Drawn over the tile when present. */
  image?: { url: string };
  /** False marks the color as unstocked on the card. */
  available?: boolean;
}

export interface ProductCardOptions {
  /** The design's colors, drawn as chips beside the garment. */
  designColors?: readonly Swatch[];
  /**
   * A recolor's swaps, drawn as a before chip, an arrow, and an after chip per
   * row beside the garment. Replaces `designColors` when given.
   */
  recolor?: readonly { from: Swatch; to: Swatch }[];
  /** Product display name, shown as the heading. */
  productName?: string;
  /** Side of the square garment tile in pixels. Default 200. */
  garmentSize?: number;
  /** Side of each design-color chip in pixels. Default 40. */
  chipSize?: number;
}

/** Short stable hash for element IDs, so cards on one page never share a clip path. */
function hashId(value: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/**
 * Render a product color as a card: the garment tile, with the garment photo
 * over it when the color has an `image.url`, and the design's colors as chips
 * beside it, or a recolor's before and after chips. Without an image the tile
 * is plain.
 */
export function renderProductCard(
  productColor: ProductCardColor,
  options: ProductCardOptions = {},
): string {
  const size = options.garmentSize ?? 200;
  const chipSize = options.chipSize ?? 40;
  const swaps = options.recolor;
  // Each row: the chip that is labeled, and for a recolor the chip it replaces.
  const rows: { chip: Swatch; before?: Swatch }[] = swaps
    ? swaps.map((s) => ({ chip: s.to, before: s.from }))
    : (options.designColors ?? []).map((chip) => ({ chip }));
  const chips = rows.map((r) => r.chip);
  const hex = swatchHex(productColor);
  const name = productColor.name ?? hex;
  const title = options.productName ?? "";
  const top = title ? TITLE_HEIGHT : 0;

  const parts: string[] = [];
  if (title) parts.push(titleText(title));

  // Garment tile, with the photo clipped to the same rounded square.
  parts.push(
    `<rect x="0" y="${top}" width="${size}" height="${size}" rx="8" fill="${hex}" stroke="#00000022"/>`,
  );
  const url = productColor.image?.url;
  if (url) {
    const clipId = `garment-${hashId(`${url}|${hex}`)}`;
    parts.push(
      `<clipPath id="${clipId}"><rect x="0" y="${top}" width="${size}" height="${size}" rx="8"/></clipPath>` +
        `<image href="${escapeXml(url)}" x="0" y="${top}" width="${size}" height="${size}" ` +
        `preserveAspectRatio="xMidYMid slice" clip-path="url(#${clipId})"/>`,
    );
  }

  // Caption under the garment.
  const status = productColor.available === false ? " · not stocked" : "";
  parts.push(
    `<text x="0" y="${top + size + 20}" font-size="13" font-weight="600" fill="currentColor">` +
      `${escapeXml(name)}</text>` +
      `<text x="0" y="${top + size + 36}" font-size="11" font-family="${escapeXml(MONO)}" ` +
      `fill="currentColor">${hex}${escapeXml(status)}</text>`,
  );

  // Design chips in a column to the right; for a recolor, the before chip and
  // an arrow come first.
  const beforeWidth = swaps ? chipSize + 24 : 0;
  const chipX = size + 24 + beforeWidth;
  const rowHeight = chipSize + 8;
  rows.forEach(({ chip, before }, i) => {
    const chipHex = swatchHex(chip);
    const y = top + i * rowHeight;
    const textX = chipX + chipSize + 10;
    const mid = y + chipSize / 2;
    const beforeHex = before && swatchHex(before);
    const tooltip = before ? `${describe(before)} becomes ${describe(chip)}` : describe(chip);
    parts.push(
      `<g><title>${escapeXml(tooltip)}</title>` +
        (before
          ? `<rect x="${size + 24}" y="${y}" width="${chipSize}" height="${chipSize}" rx="6" ` +
            `fill="${beforeHex}" stroke="#00000022"/>` +
            `<text x="${chipX - 12}" y="${mid + 5}" font-size="14" text-anchor="middle" ` +
            `fill="currentColor">→</text>`
          : "") +
        `<rect x="${chipX}" y="${y}" width="${chipSize}" height="${chipSize}" rx="6" ` +
        `fill="${chipHex}" stroke="#00000022"/>` +
        (chip.name
          ? `<text x="${textX}" y="${mid - 2}" font-size="12" font-weight="600" fill="currentColor">` +
            `${escapeXml(chip.name)}</text>` +
            `<text x="${textX}" y="${mid + 12}" font-size="11" font-family="${escapeXml(MONO)}" ` +
            `fill="currentColor">${chipHex}</text>`
          : `<text x="${textX}" y="${mid + 4}" font-size="11" font-family="${escapeXml(MONO)}" ` +
            `fill="currentColor">${chipHex}</text>`) +
        `</g>`,
    );
  });

  const longest = Math.max(0, ...chips.map((c) => (c.name ?? "").length), 7);
  const chipsWidth = chips.length ? 24 + beforeWidth + chipSize + 10 + Math.ceil(longest * 12 * CHAR_WIDTH) : 0;
  const titleWidth = Math.ceil(title.length * 15 * CHAR_WIDTH);
  const width = Math.max(size + chipsWidth, titleWidth);
  const height = top + Math.max(size + 44, chips.length * rowHeight);

  const onColors = swaps?.length
    ? `, recolored: ${swaps.map((s) => `${describe(s.from)} to ${describe(s.to)}`).join(", ")}`
    : chips.length
      ? ` with ${chips.map((c) => c.name ?? swatchHex(c)).join(", ")}`
      : "";
  const label = `${title ? `${title}, ` : ""}${name} ${hex}${status}${onColors}`;
  return svgDocument(width, height, label, parts.join(""));
}
