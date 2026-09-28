/**
 * Helpers shared by the SVG, HTML, and terminal renderers.
 */
import { contrastRatio } from "../color/contrast.js";
import { normalizeHex } from "../color/convert.js";
/** The label every renderer shows on a color with `available: false`. */
export const NOT_STOCKED = "not stocked";
/** Escape text for use in XML or HTML content and attribute values. */
export function escapeXml(value) {
    return value
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}
const BLACK = "#000000";
const WHITE = "#ffffff";
/** Black or white, whichever has the higher WCAG contrast ratio on `background`. */
export function readableTextColor(background) {
    return contrastRatio(BLACK, background) >= contrastRatio(WHITE, background) ? BLACK : WHITE;
}
/** Normalize a swatch hex, so every renderer emits lowercase `#rrggbb`. */
export function swatchHex(swatch) {
    return normalizeHex(swatch.hex);
}
/**
 * Break `text` into at most `maxLines` lines of at most `maxChars` characters,
 * on word boundaries where possible. Overflow ends in an ellipsis.
 */
export function wrapText(text, maxChars, maxLines = 2) {
    const limit = Math.max(1, maxChars);
    const lines = [];
    let current = "";
    for (const word of text.split(/\s+/).filter(Boolean)) {
        const candidate = current ? `${current} ${word}` : word;
        if (candidate.length <= limit) {
            current = candidate;
            continue;
        }
        if (current)
            lines.push(current);
        current = word;
    }
    if (current)
        lines.push(current);
    const fitted = lines.map((line) => (line.length > limit ? `${line.slice(0, limit - 1)}…` : line));
    if (fitted.length <= maxLines)
        return fitted;
    const kept = fitted.slice(0, maxLines);
    const last = kept[maxLines - 1];
    kept[maxLines - 1] = last.length >= limit ? `${last.slice(0, limit - 1)}…` : `${last}…`;
    return kept;
}
/** Format a number with at most `digits` decimals and no trailing zeros. */
export function fmt(value, digits = 2) {
    return String(Number(value.toFixed(digits)));
}
//# sourceMappingURL=shared.js.map