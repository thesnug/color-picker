/**
 * HTML wrapper: a self-contained page of SVG sections for in-session review,
 * with a light and dark background toggle so a palette can be judged on both.
 */
import { escapeXml } from "./shared.js";
const STYLE = `
:root { color-scheme: light dark; --bg: #ffffff; --fg: #1a1a1a; --muted: #5c5c5c; --rule: #e2e2e2; }
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) { --bg: #141414; --fg: #f0f0f0; --muted: #a8a8a8; --rule: #2e2e2e; }
}
:root[data-theme="dark"] { --bg: #141414; --fg: #f0f0f0; --muted: #a8a8a8; --rule: #2e2e2e; }
* { box-sizing: border-box; }
body { margin: 0; padding: 24px 16px 48px; background: var(--bg); color: var(--fg);
  font: 15px/1.5 system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; }
header { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; justify-content: space-between;
  max-width: 1100px; margin: 0 auto 24px; }
h1 { font-size: 20px; margin: 0; }
h2 { font-size: 15px; margin: 0 0 8px; }
main { max-width: 1100px; margin: 0 auto; display: grid; gap: 32px; }
section { border-top: 1px solid var(--rule); padding-top: 16px; }
.svg { overflow-x: auto; }
.svg svg { display: block; max-width: none; }
p { margin: 8px 0 0; color: var(--muted); font-size: 13px; }
.toggle { display: inline-flex; border: 1px solid var(--rule); border-radius: 8px; overflow: hidden; }
.toggle button { font: inherit; font-size: 13px; padding: 6px 12px; border: 0; background: transparent;
  color: var(--fg); cursor: pointer; }
.toggle button[aria-pressed="true"] { background: var(--fg); color: var(--bg); }
.themes { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; }
.tp { background: var(--tp-background); color: var(--tp-text); border: 1px solid var(--rule);
  border-radius: 12px; padding: 20px; min-width: 0; }
.tp .mode { margin: 0 0 12px; font-size: 12px; letter-spacing: 0.06em; text-transform: uppercase;
  color: var(--tp-muted); }
.tp h3 { margin: 0 0 8px; font-size: 22px; line-height: 1.25; }
.tp p { margin: 0 0 12px; font-size: 15px; color: var(--tp-text); }
.tp .muted { font-size: 13px; color: var(--tp-muted); }
.tp .card { background: var(--tp-surface); border-left: 4px solid var(--tp-accent); border-radius: 8px;
  padding: 16px; margin-top: 16px; }
.tp .card p:last-child { margin-bottom: 0; }
.tp button { font: inherit; font-weight: 600; background: var(--tp-accent); color: var(--tp-on-accent);
  border: 0; border-radius: 6px; padding: 8px 16px; cursor: pointer; }
.tp-none { border: 1px dashed var(--rule); border-radius: 12px; padding: 20px; }
.tp-none p { color: var(--fg); font-size: 14px; }
`;
const SCRIPT = `
(function () {
  var root = document.documentElement;
  var buttons = document.querySelectorAll(".toggle button");
  function current() {
    var set = root.getAttribute("data-theme");
    if (set) return set;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  function sync() {
    var theme = current();
    buttons.forEach(function (b) { b.setAttribute("aria-pressed", String(b.value === theme)); });
  }
  buttons.forEach(function (b) {
    b.addEventListener("click", function () { root.setAttribute("data-theme", b.value); sync(); });
  });
  sync();
})();
`;
/**
 * Wrap SVG sections in one self-contained HTML page: no external requests
 * beyond any garment images the SVGs themselves reference.
 */
export function renderHtml(sections, options = {}) {
    const title = escapeXml(options.title ?? "Color review");
    const themeAttr = options.theme ? ` data-theme="${options.theme}"` : "";
    const body = sections
        .map((entry) => {
        const s = typeof entry === "string" ? { svg: entry } : entry;
        const heading = s.title ? `<h2>${escapeXml(s.title)}</h2>` : "";
        const caption = s.caption ? `<p>${escapeXml(s.caption)}</p>` : "";
        const svg = s.svg ? `<div class="svg">${s.svg}</div>` : "";
        return `<section>${heading}${svg}${s.html ?? ""}${caption}</section>`;
    })
        .join("\n");
    return `<!doctype html>
<html lang="en"${themeAttr}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>${STYLE}</style>
</head>
<body>
<header>
<h1>${title}</h1>
<div class="toggle" role="group" aria-label="Background">
<button type="button" value="light">Light</button><button type="button" value="dark">Dark</button>
</div>
</header>
<main>
${body}
</main>
<script>${SCRIPT}</script>
</body>
</html>
`;
}
//# sourceMappingURL=html.js.map