/**
 * `@thesnug/color-picker/render`: SVG, HTML, and terminal swatch renderers.
 *
 * SVG is the primary format. HTML wraps SVGs for in-session review; the CLI
 * prints truecolor blocks. No dependencies. See docs/DESIGN.md, "Rendering".
 */

export { type Swatch, escapeXml, readableTextColor } from "./shared.js";
export {
  type CombinationInput,
  type CombinationOptions,
  type PairContrast,
  type ProductCardColor,
  type ProductCardOptions,
  type SwatchGridOptions,
  type SwatchStripOptions,
  pairContrast,
  renderCombination,
  renderProductCard,
  renderSwatchGrid,
  renderSwatchStripSvg,
} from "./svg.js";
export { type HtmlOptions, type HtmlSection, renderHtml } from "./html.js";
export { type AnsiOptions, renderAnsi } from "./ansi.js";
