/**
 * Ink legibility (`ink-legibility-v2`): can the ink of a print file be read on
 * a garment color? A deterministic measurement, not a model's opinion.
 *
 * On a garment, an ink is legible when, laid over the garment at its median
 * alpha, it reaches WCAG 2.2's 3:1 for large-scale text and graphics and sits
 * at least 10 apart in OKLab (the print minimum distance).
 *
 * Faint ink is not lost when legible ink draws its boundary: the fill inside an
 * outline, or a cream highlight inside dark linework, keeps its shape. Only the
 * ink's own boundary counts. Legible marks the faint ink fully encloses (texture
 * speckles, lettering on a panel, a face's eyes) sit inside its shape and draw
 * none of it. Boundary shared with another faint ink is as framed as that ink
 * is, so a faint fill inside a faint outline is lost with its outline. The pair
 * passes when less than a fifth of the ink is lost and at least a fifth of it
 * reads on its own.
 *
 * Ported unchanged from POD's `lib/ink-legibility.ts`, which now re-exports it.
 */
import { type Rgb } from "../color/convert.js";
import type { InkMeasurement } from "./measure.js";
import { LEGIBILITY_PROTOCOL } from "./rules.js";
export interface LegibilityInk {
    hex: string;
    share: number;
    /** WCAG contrast of the ink, laid on the garment at its median alpha. */
    ratio: number;
    /** OKLab distance (×100) of the same. */
    distance: number;
    vanishes: boolean;
    legible: boolean;
    /**
     * Share of a faint ink's own boundary drawn by legible ink, where boundary shared with
     * another faint ink counts at that ink's framing; null for legible ink.
     */
    framing: number | null;
    lost: boolean;
}
export interface LegibilityVerdict {
    protocol: typeof LEGIBILITY_PROTOCOL;
    colorName: string;
    garmentHex: string;
    bytesChecksum: string;
    pass: boolean;
    legibleShare: number;
    framedShare: number;
    lostShare: number;
    inks: LegibilityInk[];
    reason: string;
}
export type GarmentFamily = "light" | "dark";
/** A garment color a print is judged on. */
export type Garment = {
    colorName: string;
    hex: string;
};
/** How one ink reads on a garment. */
export interface InkOnGarment {
    /** WCAG contrast ratio, rounded to two places. */
    ratio: number;
    /** OKLab distance (×100), rounded to one place. */
    distance: number;
    /** Closer than the print minimum distance. */
    vanishes: boolean;
    /** At least 3:1 and at least the print minimum distance apart. */
    legible: boolean;
}
/** The ink as it reads on the garment: laid over it at `alpha`, in linear light. */
export declare function seenOn(inkHex: string, alpha: number, garmentHex: string): Rgb;
/**
 * How an ink reads on a garment, laid over it at `alpha` (1 for opaque ink):
 * legible at 3:1 or better and at least the print minimum distance apart.
 */
export declare function inkOnGarment(inkHex: string, alpha: number, garmentHex: string): InkOnGarment;
/** Judge one measured print file on one garment color. */
export declare function judgeLegibility(measurement: InkMeasurement, garment: Garment): LegibilityVerdict;
/** Light garments take dark ink and dark garments light ink, at the print rules' luminance 0.3. */
export declare function garmentFamily(hex: string): GarmentFamily;
/**
 * The garment families that need another ink: those where the existing inks read on fewer
 * than half of the family's colors, and, while fewer colors read than the caller asks for,
 * every family with a color no existing ink reads on.
 */
export declare function legibleInkNeeds(input: {
    garments: readonly Garment[];
    legibleColors: ReadonlySet<string>;
    colorCount: number;
}): GarmentFamily[];
//# sourceMappingURL=legibility.d.ts.map