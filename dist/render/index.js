/**
 * `@thesnug/color-picker/render`: SVG, HTML, and terminal swatch renderers.
 *
 * SVG is the primary format. HTML wraps SVGs for in-session review, and
 * previews a web theme as a sample UI; the CLI prints truecolor blocks. No dependencies. See docs/DESIGN.md, "Rendering".
 */
export { escapeXml, readableTextColor } from "./shared.js";
export { pairContrast, renderCombination, renderProductCard, renderSwatchGrid, renderSwatchStripSvg, } from "./svg.js";
export { renderHtml } from "./html.js";
export { renderAnsi } from "./ansi.js";
export { renderThemePreview } from "./theme.js";
//# sourceMappingURL=index.js.map