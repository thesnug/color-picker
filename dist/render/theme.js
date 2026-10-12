/**
 * Theme preview: a small sample UI (heading, body text, muted text, a card on
 * the surface, and an accent button) drawn with a theme's colors, so a theme
 * can be judged by eye rather than only read as hex codes.
 */
import { escapeXml } from "./shared.js";
/**
 * An HTML fragment with one sample per theme, side by side, for
 * `renderHtml`'s `html` section field. A theme that could not be built shows
 * its reasons in place of a sample.
 */
export function renderThemePreview(themes, options = {}) {
    const heading = escapeXml(options.heading ?? "A palette from Wada's dictionary");
    const panels = themes.map((t) => {
        const mode = modeLabel(t.mode);
        if (!t.ok) {
            const reasons = t.reasons.map((r) => `<p>${escapeXml(r)}</p>`).join("");
            return `<div class="tp-none"><p class="mode"><strong>${mode}</strong></p>${reasons}</div>`;
        }
        const c = t.colors;
        const style = [
            `--tp-background:${c.background.hex}`,
            `--tp-surface:${c.surface.hex}`,
            `--tp-text:${c.text.hex}`,
            `--tp-muted:${c.mutedText.hex}`,
            `--tp-accent:${c.accent.hex}`,
            `--tp-on-accent:${c.onAccent.hex}`,
            `color-scheme:${t.mode}`,
        ].join(";");
        const names = t.source.map((s) => escapeXml(s.name ?? s.hex)).join(", ");
        return (`<div class="tp" style="${style}">` +
            `<p class="mode">${mode}</p>` +
            `<h3>${heading}</h3>` +
            `<p>Body text in the text color on the background. Built from ${names}.</p>` +
            `<p class="muted">Muted text for captions and secondary detail.</p>` +
            `<div class="card"><p>A card on the surface color, edged with the accent.</p>` +
            `<button type="button">Accent button</button></div>` +
            `</div>`);
    });
    return `<div class="themes">${panels.join("")}</div>`;
}
function modeLabel(mode) {
    return mode === "dark" ? "Dark mode" : mode === "light" ? "Light mode" : "Theme";
}
//# sourceMappingURL=theme.js.map