import { type ProductColorRecommendation } from "./recommend.js";
export interface GarmentUse {
    product: string;
    slug: string;
    name: string;
    hex: string;
}
export interface ArtworkCandidate {
    artworkId: string;
    /** Exact prepared production rendition shown in the proof. */
    renditionId: string;
    recommendation: ProductColorRecommendation;
    /** Human/contextual review of text, outlines and subject recognition. */
    legible: boolean;
    subjectRecognizable: boolean;
}
export interface BatchDesign {
    id: string;
    product: string;
    candidates: readonly ArtworkCandidate[];
    /** A reviewed garment default remains selected even when frequently used. */
    defaultSlug: string;
}
export interface BatchSelection {
    designId: string;
    defaultSlug: string;
    picks: ArtworkCandidate[];
}
export declare function repetitionReport(current: readonly GarmentUse[], recent?: readonly GarmentUse[]): {
    current: {
        total: number;
        distinct: number;
        garments: {
            count: number | undefined;
            product: string;
            slug: string;
            name: string;
            hex: string;
        }[];
        colors: Record<string, number>;
        families: Record<string, number>;
        lightness: Record<string, number>;
        saturation: Record<string, number>;
        similar: {
            a: string;
            b: string;
            distance: number;
        }[];
    };
    recent: {
        total: number;
        distinct: number;
        garments: {
            count: number | undefined;
            product: string;
            slug: string;
            name: string;
            hex: string;
        }[];
        colors: Record<string, number>;
        families: Record<string, number>;
        lightness: Record<string, number>;
        saturation: Record<string, number>;
        similar: {
            a: string;
            b: string;
            distance: number;
        }[];
    };
    combined: {
        total: number;
        distinct: number;
        garments: {
            count: number | undefined;
            product: string;
            slug: string;
            name: string;
            hex: string;
        }[];
        colors: Record<string, number>;
        families: Record<string, number>;
        lightness: Record<string, number>;
        saturation: Record<string, number>;
        similar: {
            a: string;
            b: string;
            distance: number;
        }[];
    };
    note: string;
};
/** Evaluate original and approved alternates together; always return eight or fail explicitly. */
export declare function selectBatchColors(designs: readonly BatchDesign[], recent?: readonly GarmentUse[]): {
    selections: BatchSelection[];
    repetition: {
        current: {
            total: number;
            distinct: number;
            garments: {
                count: number | undefined;
                product: string;
                slug: string;
                name: string;
                hex: string;
            }[];
            colors: Record<string, number>;
            families: Record<string, number>;
            lightness: Record<string, number>;
            saturation: Record<string, number>;
            similar: {
                a: string;
                b: string;
                distance: number;
            }[];
        };
        recent: {
            total: number;
            distinct: number;
            garments: {
                count: number | undefined;
                product: string;
                slug: string;
                name: string;
                hex: string;
            }[];
            colors: Record<string, number>;
            families: Record<string, number>;
            lightness: Record<string, number>;
            saturation: Record<string, number>;
            similar: {
                a: string;
                b: string;
                distance: number;
            }[];
        };
        combined: {
            total: number;
            distinct: number;
            garments: {
                count: number | undefined;
                product: string;
                slug: string;
                name: string;
                hex: string;
            }[];
            colors: Record<string, number>;
            families: Record<string, number>;
            lightness: Record<string, number>;
            saturation: Record<string, number>;
            similar: {
                a: string;
                b: string;
                distance: number;
            }[];
        };
        note: string;
    };
    note: string;
};
//# sourceMappingURL=batch.d.ts.map