/**
 * Color-vision-deficiency simulation for full dichromacy.
 *
 * Protanopia and deuteranopia use Viénot, Brettel & Mollon (1999), "Digital
 * video colourmaps for checking the legibility of displays by dichromats",
 * Color Research & Application 24(4). A single projection plane is accurate
 * for these two.
 *
 * Tritanopia uses Brettel, Viénot & Mollon (1997), "Computerized simulation of
 * color appearance for dichromats", JOSA A 14(10). Viénot's single plane is a
 * poor fit for tritans, so Brettel's two half-planes are used, split by the
 * plane through the neutral axis.
 *
 * All matrices operate on linear RGB and are taken from libDaltonLens by
 * Nicolas Burrus (https://github.com/DaltonLens/libDaltonLens), released into
 * the public domain, which publishes them rounded to five decimals.
 */
import { type ColorInput, type Hex, type LinearRgb } from "./convert.js";
export type Deficiency = "protan" | "deutan" | "tritan";
/** Simulate a dichromat's view of a color in linear RGB. Not clipped. */
export declare function simulateLinear(linear: LinearRgb, deficiency: Deficiency): LinearRgb;
/**
 * Simulate how a color looks with protanopia, deuteranopia, or tritanopia
 * (full dichromacy), returned as `#rrggbb`. Results are clipped to sRGB.
 */
export declare function simulateCvd(input: ColorInput, deficiency: Deficiency): Hex;
//# sourceMappingURL=cvd.d.ts.map