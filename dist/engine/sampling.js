/**
 * The decode contract for legibility: which part of a print file is measured,
 * and at what size. Geometry only, so every decoder (color-picker's sharp
 * pipeline, `decodeForLegibility`, or a caller's own) samples the same pixels.
 */
import { LEGIBILITY_CONTENT_MARGIN, LEGIBILITY_RULES } from "./rules.js";
/**
 * How to sample a print file for `measureInkPixels`: crop to the content bounds
 * plus a 1% margin, then fit inside 1024 px with nearest-neighbor sampling, so
 * every analyzed pixel is a real pixel and a thin outline of a large print
 * survives. A file with an EXIF orientation is not cropped, since its bounds
 * were measured on the oriented image; neither is one whose bounds cover it.
 * Decode with the orientation applied, the crop, then the resize, in sRGB with
 * an alpha channel.
 */
export function legibilitySampling(input) {
    const { width, height, contentBounds } = input;
    const resize = {
        width: LEGIBILITY_RULES.analysisMaxDimension,
        height: LEGIBILITY_RULES.analysisMaxDimension,
        fit: "inside",
        withoutEnlargement: true,
        kernel: "nearest",
    };
    if (contentBounds && !input.oriented && width && height) {
        const left = Math.max(0, Math.floor((contentBounds.x - LEGIBILITY_CONTENT_MARGIN) * width));
        const top = Math.max(0, Math.floor((contentBounds.y - LEGIBILITY_CONTENT_MARGIN) * height));
        const right = Math.min(width, Math.ceil((contentBounds.x + contentBounds.w + LEGIBILITY_CONTENT_MARGIN) * width));
        const bottom = Math.min(height, Math.ceil((contentBounds.y + contentBounds.h + LEGIBILITY_CONTENT_MARGIN) * height));
        if (right > left && bottom > top && (right - left < width || bottom - top < height)) {
            return { extract: { left, top, width: right - left, height: bottom - top }, resize };
        }
    }
    return { resize };
}
//# sourceMappingURL=sampling.js.map