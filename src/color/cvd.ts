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

import { type ColorInput, type Hex, type LinearRgb, linearToRgb, rgbToHex, rgbToLinear, toRgb } from "./convert.js";

export type Deficiency = "protan" | "deutan" | "tritan";

type Matrix = readonly [number, number, number, number, number, number, number, number, number];

function apply(m: Matrix, [r, g, b]: LinearRgb): LinearRgb {
  return [
    m[0] * r + m[1] * g + m[2] * b,
    m[3] * r + m[4] * g + m[5] * b,
    m[6] * r + m[7] * g + m[8] * b,
  ];
}

/** Viénot 1999, linear RGB to simulated linear RGB. */
const VIENOT: Record<"protan" | "deutan", Matrix> = {
  protan: [0.11238, 0.88762, 0.0, 0.11238, 0.88762, -0.0, 0.00401, -0.00401, 1.0],
  deutan: [0.29275, 0.70725, 0.0, 0.29275, 0.70725, -0.0, -0.02234, 0.02234, 1.0],
};

/** Brettel 1997 tritan parameters: one matrix per half-plane and the separating plane's normal. */
const BRETTEL_TRITAN = {
  first: [1.01277, 0.13548, -0.14826, -0.01243, 0.86812, 0.14431, 0.07589, 0.805, 0.11911] as Matrix,
  second: [0.93678, 0.18979, -0.12657, 0.06154, 0.81526, 0.1232, -0.37562, 1.12767, 0.24796] as Matrix,
  normal: [0.03901, -0.02788, -0.01113] as const,
};

/** Simulate a dichromat's view of a color in linear RGB. Not clipped. */
export function simulateLinear(linear: LinearRgb, deficiency: Deficiency): LinearRgb {
  if (deficiency === "tritan") {
    const n = BRETTEL_TRITAN.normal;
    const side = linear[0] * n[0] + linear[1] * n[1] + linear[2] * n[2];
    return apply(side >= 0 ? BRETTEL_TRITAN.first : BRETTEL_TRITAN.second, linear);
  }
  return apply(VIENOT[deficiency], linear);
}

/**
 * Simulate how a color looks with protanopia, deuteranopia, or tritanopia
 * (full dichromacy), returned as `#rrggbb`. Results are clipped to sRGB.
 */
export function simulateCvd(input: ColorInput, deficiency: Deficiency): Hex {
  const simulated = simulateLinear(rgbToLinear(toRgb(input)), deficiency);
  return rgbToHex(linearToRgb(simulated));
}
