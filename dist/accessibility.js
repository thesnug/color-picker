/**
 * Accessibility checks for a combination of colors: WCAG 2.2 and APCA contrast
 * for the web, minimum separation for print, and collapse under color-vision
 * deficiency. Thresholds come from `assets/accessibility.json`; this file only
 * applies them. See docs/DESIGN.md, "Accessibility".
 */
import { apcaContrast, contrastRatio, relativeLuminance } from "./color/contrast.js";
import { distance, toOklch, toRgb, rgbToHex } from "./color/convert.js";
import { simulateCvd } from "./color/cvd.js";
import { loadAccessibility, loadColors } from "./data/index.js";
let cachedRules;
function rulesFrom(options) {
    return options.rules ?? (cachedRules ??= loadAccessibility());
}
function isNamedSwatch(input) {
    return typeof input === "object" && !Array.isArray(input) && "hex" in input;
}
function toSwatch(input) {
    if (isNamedSwatch(input)) {
        const hex = rgbToHex(toRgb(input.hex));
        return input.name === undefined ? { hex } : { hex, name: input.name };
    }
    return { hex: rgbToHex(toRgb(input)) };
}
/**
 * Resolve a combination to swatches. Book combinations carry Wada names.
 *
 * @throws {RangeError} when a combination names a color index that does not exist.
 */
export function toSwatches(combination) {
    if ("colors" in combination && !Array.isArray(combination)) {
        const byIndex = new Map(loadColors().map((c) => [c.index, c]));
        return combination.colors.map((index) => {
            const color = byIndex.get(index);
            if (!color)
                throw new RangeError(`No Wada color with index ${index}.`);
            return { hex: color.hex, name: color.name };
        });
    }
    return combination.map(toSwatch);
}
/** `Hermosa Pink (#ffb3f0)`, or the hex alone when the color has no name. */
export function label(swatch) {
    return swatch.name ? `${swatch.name} (${swatch.hex})` : swatch.hex;
}
const round = (value, places) => Number(value.toFixed(places));
export function wcagLevel(ratio, context, options = {}) {
    const { wcag } = rulesFrom(options);
    if (context === "web-text") {
        if (wcag.body.AAA !== null && ratio >= wcag.body.AAA)
            return "AAA";
        if (ratio >= wcag.body.AA)
            return "AA";
        if (ratio >= wcag.large.AA)
            return "AA-large";
        return "fail";
    }
    return ratio >= wcag.nonText.AA ? "AA" : "fail";
}
/** APCA level for an Lc of either polarity. */
export function apcaLevel(lc, options = {}) {
    const { apca } = rulesFrom(options);
    const abs = Math.abs(lc);
    if (apca.body.preferred !== undefined && abs >= apca.body.preferred)
        return "body-preferred";
    if (abs >= apca.body.minimum)
        return "body";
    if (abs >= apca.content.minimum)
        return "content";
    if (abs >= apca.large.minimum)
        return "large";
    if (abs >= apca.nonText.minimum)
        return "non-text";
    return "fail";
}
const WCAG_WORDS = {
    AAA: "meets WCAG AAA",
    AA: "meets WCAG AA",
    "AA-large": "meets WCAG AA for large text only",
    fail: "fails WCAG AA",
};
const APCA_WORDS = {
    "body-preferred": "enough for fluent body text",
    body: "enough for body text",
    content: "enough for short content text, not body text",
    large: "enough for headlines only",
    "non-text": "enough for icons and outlines only",
    fail: "too faint for any use",
};
const CVD_WORDS = {
    protan: "protanopia",
    deutan: "deuteranopia",
    tritan: "tritanopia",
};
function checkPair(foreground, background, context, options) {
    const rules = rulesFrom(options);
    const ratio = round(contrastRatio(foreground.hex, background.hex), 2);
    const lc = round(apcaContrast(foreground.hex, background.hex), 1);
    const gap = round(distance(foreground.hex, background.hex), 1);
    const wcag = { ratio, level: wcagLevel(ratio, context, options) };
    const apca = { lc, level: apcaLevel(lc, options) };
    const on = `${label(foreground)} on ${label(background)}`;
    const reasons = [`${on}: contrast ${ratio}:1 ${WCAG_WORDS[wcag.level]}; APCA Lc ${lc} is ${APCA_WORDS[apca.level]}.`];
    if (context === "print") {
        const minimum = rules.print.minimumDistance.value;
        const tooClose = gap < minimum;
        reasons.push(tooClose
            ? `${on}: distance ${gap} is below the print minimum of ${minimum}; they will read as one color on fabric.`
            : `${on}: distance ${gap} clears the print minimum of ${minimum}.`);
        return { foreground, background, wcag, apca, distance: gap, tooClose, passes: !tooClose, reasons };
    }
    return { foreground, background, wcag, apca, distance: gap, passes: wcag.level === "AA" || wcag.level === "AAA", reasons };
}
function checkCvd(colors, deficiency, options) {
    const minimum = rulesFrom(options).print.minimumDistance.value;
    const simulated = colors.map((c) => simulateCvd(c.hex, deficiency));
    const collapsed = [];
    const reasons = [];
    for (let i = 0; i < colors.length; i++) {
        for (let j = i + 1; j < colors.length; j++) {
            const gap = round(distance(simulated[i], simulated[j]), 1);
            if (gap >= minimum)
                continue;
            const a = colors[i];
            const b = colors[j];
            const normalDistance = round(distance(a.hex, b.hex), 1);
            collapsed.push({ a, b, distance: gap, normalDistance });
            reasons.push(normalDistance >= minimum
                ? `With ${CVD_WORDS[deficiency]}, ${label(a)} and ${label(b)} collapse to distance ${gap} (${normalDistance} with typical vision).`
                : `${label(a)} and ${label(b)} are already too close with typical vision, and remain so with ${CVD_WORDS[deficiency]} (distance ${gap}).`);
        }
    }
    if (collapsed.length === 0)
        reasons.push(`Every pair stays distinct with ${CVD_WORDS[deficiency]}.`);
    return { deficiency, collapsed, reasons };
}
/**
 * Check every ordered pair of a combination against the thresholds for a
 * context, and every unordered pair for collapse under each simulated
 * color-vision deficiency.
 *
 * - `web-text`: passes at WCAG AA for body text (4.5:1).
 * - `web-ui`: passes at WCAG AA for non-text contrast (3:1).
 * - `print`: passes when the pair is at least the print minimum distance apart.
 *
 * APCA is reported alongside for every context; it is advisory, not a pass
 * criterion, because WCAG 2.2 is the normative standard.
 */
export function check(combination, { context, ...options }) {
    const rules = rulesFrom(options);
    const colors = toSwatches(combination);
    const pairs = [];
    for (const foreground of colors) {
        for (const background of colors) {
            if (foreground !== background)
                pairs.push(checkPair(foreground, background, context, options));
        }
    }
    const cvd = rules.cvd.simulations.map((d) => checkCvd(colors, d, options));
    const passing = pairs.filter((p) => p.passes).length;
    const passes = colors.length < 2 ? false : context === "print" ? passing === pairs.length : passing > 0;
    const cvdSafe = cvd.every((r) => r.collapsed.length === 0);
    const reasons = [];
    if (colors.length < 2) {
        reasons.push("A combination needs at least two colors to check contrast.");
    }
    else if (context === "print") {
        const close = pairs.length - passing;
        reasons.push(passes
            ? "Every pair of colors is far enough apart to print distinctly."
            : `${close / 2} pair${close === 2 ? "" : "s"} of colors ${close === 2 ? "is" : "are"} too close to print distinctly.`);
    }
    else {
        const need = context === "web-text" ? "text" : "interface elements";
        reasons.push(passes
            ? `${passing} of ${pairs.length} foreground and background pairings meet WCAG AA for ${need}.`
            : `No foreground and background pairing meets WCAG AA for ${need}.`);
    }
    const collapsing = cvd.filter((r) => r.collapsed.length > 0).map((r) => CVD_WORDS[r.deficiency]);
    if (colors.length >= 2) {
        reasons.push(cvdSafe
            ? "Colors stay distinct under protanopia, deuteranopia, and tritanopia."
            : `Some colors become hard to tell apart with ${collapsing.join(", ")}.`);
    }
    return { context, colors, pairs, cvd, passes, cvdSafe, reasons };
}
function roleContrast(fg, bg, context, options) {
    const ratio = round(contrastRatio(fg.hex, bg.hex), 2);
    const lc = round(apcaContrast(fg.hex, bg.hex), 1);
    return { wcag: { ratio, level: wcagLevel(ratio, context, options) }, apca: { lc, level: apcaLevel(lc, options) } };
}
/**
 * Suggest which color of a combination serves as background, text, and accent
 * for a web page.
 *
 * Text must meet WCAG AA for body text against the background; the accent must
 * meet WCAG AA non-text contrast (3:1) against it. Among legible assignments,
 * one with an accent beats one without, then higher text contrast wins, and the
 * accent is the most chromatic qualifying color. Reports, rather than throws,
 * when no legible assignment exists.
 */
export function roles(combination, options = {}) {
    const rules = rulesFrom(options);
    const colors = toSwatches(combination);
    const lum = new Map(colors.map((c) => [c, relativeLuminance(c.hex)]));
    let best;
    for (const background of colors) {
        for (const text of colors) {
            if (text === background)
                continue;
            const light = lum.get(background) > lum.get(text);
            if (options.mode === "light" && !light)
                continue;
            if (options.mode === "dark" && light)
                continue;
            const ratio = contrastRatio(text.hex, background.hex);
            if (ratio < rules.wcag.body.AA)
                continue;
            const accent = colors
                .filter((c) => c !== background && c !== text)
                .filter((c) => contrastRatio(c.hex, background.hex) >= rules.wcag.nonText.AA)
                .sort((x, y) => toOklch(y.hex).c - toOklch(x.hex).c)[0];
            const candidate = accent ? { background, text, ratio, accent } : { background, text, ratio };
            if (!best ||
                (candidate.accent !== undefined && best.accent === undefined) ||
                ((candidate.accent !== undefined) === (best.accent !== undefined) && ratio > best.ratio)) {
                best = candidate;
            }
        }
    }
    const modeWords = options.mode ? ` for ${options.mode} mode` : "";
    if (!best) {
        return {
            ok: false,
            reasons: [
                colors.length < 2
                    ? "A combination needs at least two colors to assign a background and text."
                    : `No pair of colors${modeWords} reaches WCAG AA contrast for body text (${rules.wcag.body.AA}:1), so no legible text and background assignment exists.`,
            ],
        };
    }
    const { background, text, accent } = best;
    const mode = lum.get(background) > lum.get(text) ? "light" : "dark";
    const textContrast = roleContrast(text, background, "web-text", options);
    const reasons = [
        `${label(text)} text on a ${label(background)} background: ${textContrast.wcag.ratio}:1 ${WCAG_WORDS[textContrast.wcag.level]}; APCA Lc ${textContrast.apca.lc} is ${APCA_WORDS[textContrast.apca.level]}.`,
    ];
    if (!accent) {
        const others = colors.length > 2;
        reasons.push(others
            ? `No other color reaches ${rules.wcag.nonText.AA}:1 against the background, so there is no accent.`
            : "Only two colors, so there is no accent.");
        return { ok: true, mode, background, text, contrast: { text: textContrast }, reasons };
    }
    const accentContrast = roleContrast(accent, background, "web-ui", options);
    reasons.push(`${label(accent)} as the accent: ${accentContrast.wcag.ratio}:1 against the background ${WCAG_WORDS[accentContrast.wcag.level]} for interface elements.`);
    if (accentContrast.wcag.ratio < rules.wcag.body.AA) {
        reasons.push(`Use the accent for buttons, borders, and icons, not for body text.`);
    }
    return {
        ok: true,
        mode,
        background,
        text,
        accent,
        contrast: { text: textContrast, accent: accentContrast },
        reasons,
    };
}
// ---------------------------------------------------------------------------
// Garments
/**
 * True when a garment is light enough for dark ink, by the print rules'
 * luminance cutoff. Light ink on a dark garment needs an underbase.
 */
export function allowsDarkInk(garment, options = {}) {
    return relativeLuminance(garment) > rulesFrom(options).print.darkInkGarmentLuminance.value;
}
//# sourceMappingURL=accessibility.js.map