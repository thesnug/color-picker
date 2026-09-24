/**
 * `@thesnug/color-picker/render`: SVG, HTML, and terminal swatch renderers.
 *
 * SVG is the primary format. See docs/DESIGN.md, "Rendering".
 * This is the scaffold; the card renderers arrive in later issues.
 */

export interface SwatchStripOptions {
  /** Width of each tile in pixels. Default 96. */
  tileWidth?: number;
  /** Height of each tile in pixels. Default 64. */
  tileHeight?: number;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * Render a strip of solid color tiles as a standalone SVG document.
 * Each tile carries its hex as a `<title>` so it reads in a browser and a PR.
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
