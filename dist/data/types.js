/**
 * The shapes of the vendored and derived JSON assets. Pure: no I/O, so the
 * engine entry point and the bundled data modules can import these types
 * without reaching `node:fs`. `./index.ts` re-exports everything here.
 * See docs/DESIGN.md, "Data".
 */
/** True when the color has a hex to match, render, or print against. */
export function hasHex(color) {
    return color.hex !== null;
}
//# sourceMappingURL=types.js.map