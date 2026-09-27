/**
 * The CLI commands. Each builds a `View`: the same result as JSON, terminal
 * text, and SVG sections, so every command supports every output flag.
 */
import { mkdir } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { combinations } from "../combinations.js";
import { contrastRatio } from "../color/contrast.js";
import { isHex } from "../color/convert.js";
import { hasHex, loadColors, loadCombinations, loadProduct, loadProductIndex } from "../data/index.js";
import { applyRecolor, defaultVisionProviders, describeDesign, fingerprint, VisionUnavailableError, } from "../fingerprint/index.js";
import { jevAvailability, JevUnavailableError, MOOD_TOP, rerankByMood, vettedRecolorPlans, } from "../jev/index.js";
import { nearest } from "../nearest.js";
import { palettesForProductColor } from "../palettes.js";
import { recolorPlans } from "../recolor.js";
import { recommendProductColors } from "../recommend.js";
import { renderAnsi, renderCombination, renderProductCard, renderSwatchGrid, renderThemePreview, } from "../render/index.js";
import { fmt } from "../render/shared.js";
import { describeRole, namedRamp, theme, THEME_ROLES, toCssVariables, toDesignTokens, toTailwindTheme, } from "../theme.js";
/** Input the user can fix: an unknown name, a malformed hex, an unknown ID. */
export class InputError extends Error {
}
export function nearestView({ query, k }) {
    const result = nearest(query, { k });
    const resolved = requireResolved(query, result.resolved, result.reason);
    const title = `Nearest Wada colors to ${describeQuery(query, resolved)}`;
    const swatches = result.matches.map((m) => ({ ...m.color, note: `No. ${m.color.index} · distance ${fmt(m.distance)}` }));
    return {
        title,
        json: result,
        text: (color) => `${title}\n\n${renderAnsi(swatches, { color })}`,
        sections: [{ svg: renderSwatchGrid(swatches, { title }) }],
    };
}
export function combosView({ query, size, limit }) {
    const result = combinations(query, { limit, ...(size !== undefined && { size }) });
    const resolved = requireResolved(query, result.resolved, result.reason);
    const title = `Combinations for ${describeQuery(query, resolved)}`;
    const anchor = result.anchor;
    const anchorNotes = [
        ...(anchor.via === "nearest-neutral" ? ["nearest neutral"] : []),
        `distance ${fmt(anchor.distance)}`,
        ...(anchor.rejected
            ? [`over ${anchor.rejected.name} at ${fmt(anchor.rejected.distance)}`]
            : []),
    ];
    const anchorLine = `Anchor: ${anchor.color.name} ${anchor.color.hex} (${anchorNotes.join(", ")})`;
    if (result.palettes.length === 0) {
        return {
            title,
            json: result,
            text: () => `${title}\n${anchorLine}\n\n${result.reason ?? "No palettes."}\n`,
            sections: [],
        };
    }
    const blocks = result.palettes.map((p) => ({
        heading: `${paletteTitle(p)} · ${paletteDetail(p)}`,
        palette: p,
    }));
    return {
        title,
        json: result,
        text: (color) => [
            `${title}\n${anchorLine}\n`,
            ...blocks.map(({ heading, palette }) => `${heading}\n${renderAnsi(paletteSwatches(palette), { color })}`),
        ].join("\n"),
        // The SVG title stays short so it fits over a two-color strip; the detail
        // goes in the HTML caption.
        sections: result.palettes.map((palette) => ({
            svg: renderCombination({
                ...(palette.source === "book" && { id: palette.combination.id }),
                colors: paletteSwatches(palette),
            }, { title: paletteTitle(palette), contrast: true }),
            caption: paletteDetail(palette),
        })),
    };
}
export function showView(ids) {
    const byId = new Map(loadCombinations().map((c) => [c.id, c]));
    const byIndex = new Map(loadColors().map((c) => [c.index, c]));
    const found = ids.map((id) => {
        const combination = byId.get(id);
        if (!combination) {
            throw new InputError(`unknown combination ${id}; the book's IDs run from 1 to ${byId.size}`);
        }
        return { combination, colors: combination.colors.map((i) => byIndex.get(i)) };
    });
    const title = found.length === 1 ? `Combination ${ids[0]}` : `Combinations ${ids.join(", ")}`;
    const heading = (c) => `Combination ${c.id} · ${c.harmony}`;
    return {
        title,
        json: { combinations: found },
        text: (color) => found
            .map((f) => `${heading(f.combination)}\n${renderAnsi(f.colors, { color })}`)
            .join("\n"),
        sections: found.map((f) => ({
            svg: renderCombination({ id: f.combination.id, colors: f.colors }, { contrast: true }),
            caption: f.combination.harmony,
        })),
    };
}
/** Palettes for a garment color: the garment first, then the ink colors printed on it. */
export async function palettesView({ name, limit, size, product: productId, design: designArgs, mood, }) {
    let product;
    try {
        product = loadProduct(productId ?? loadProductIndex().default);
    }
    catch (error) {
        throw new InputError(error.message);
    }
    const setup = moodSetup(mood);
    if (setup && !designArgs)
        throw new InputError("mood re-ranking of palettes needs a design file");
    const found = palettesForProductColor(name, {
        product,
        limit: setup ? Math.max(limit, MOOD_TOP) : limit,
        ...(size !== undefined && { size }),
    });
    const color = found.color;
    if (!color) {
        const names = product.colors.map((c) => c.name).join(", ");
        throw new InputError(`${found.reason} Colors: ${names}.`);
    }
    let palettes = found.palettes.slice(0, limit);
    let moodStatus;
    let design;
    if (setup && designArgs) {
        design = await fingerprintDesign(designArgs.file, designArgs.bytes);
        const ranked = await moodRerank(found.palettes, design, designArgs.bytes ?? designArgs.file, setup);
        design = ranked.design;
        palettes = ranked.rerank.candidates.slice(0, limit);
        moodStatus = statusOf(ranked.rerank);
    }
    const result = { ...found, palettes };
    const title = `Palettes for ${color.name} ${color.hex ?? "(no hex)"} · ${product.brand} ${product.model}`;
    const lines = [
        `Wada equivalents: ${result.equivalents.map((e) => `${e.name} (distance ${fmt(e.distance)})`).join(", ") || "none"}`,
        ...(color.available ? [] : [`Warning: ${color.name} is not stocked by the print provider.`]),
        ...(moodStatus && designArgs ? [moodLine(moodStatus, designArgs.file)] : []),
    ];
    const heading = (p) => `${productPaletteTitle(p)} · via ${p.equivalent.name} · contrast ${fmt(p.contrast)} (lowest ${fmt(p.minContrast)})${moodSuffix(p)}`;
    const inkSwatches = (p) => p.colors.slice(1).map((c) => ({ hex: c.hex, name: `${c.name} · ${fmt(contrastOn(p, c.hex))}:1` }));
    const json = { ...result, ...(design && { design }), ...(moodStatus && { mood: moodStatus }) };
    if (result.palettes.length === 0 || !hasHex(color)) {
        return {
            title,
            json,
            text: () => `${title}\n${lines.join("\n")}\n\n${result.reason ?? "No palettes."}\n`,
            sections: [],
        };
    }
    return {
        title,
        json,
        text: (useColor) => [
            `${title}\n${lines.join("\n")}\n`,
            ...result.palettes.map((p) => `${heading(p)}\n${renderAnsi(p.colors, { color: useColor })}`),
        ].join("\n"),
        // One card per palette: the garment, with its photo when the product has
        // one, and the ink colors beside it.
        sections: result.palettes.map((p) => ({
            title: productPaletteTitle(p),
            ...moodBadge(p),
            svg: renderProductCard(color, { designColors: inkSwatches(p) }),
            caption: `via ${p.equivalent.name} · contrast ${fmt(p.contrast)}, lowest ${fmt(p.minContrast)}`,
        })),
    };
}
function productPaletteTitle(p) {
    if (p.source === "book")
        return `Combination ${p.combination.id}`;
    return `${p.harmony[0].toUpperCase()}${p.harmony.slice(1)} harmony`;
}
function contrastOn(p, hex) {
    return contrastRatio(hex, p.colors[0].hex);
}
/** Default `-n` for `recommend`. */
export const DEFAULT_RECOMMEND_N = 5;
export async function recommendView({ file, bytes, n, product: productId, mood }) {
    let product;
    try {
        product = loadProduct(productId ?? loadProductIndex().default);
    }
    catch (error) {
        throw new InputError(error.message);
    }
    let design = await fingerprintDesign(file, bytes);
    const setup = moodSetup(mood);
    const ranked = recommendProductColors(design, { product, n: setup ? Math.max(n, MOOD_TOP) : n });
    let picks = ranked.slice(0, n);
    let moodStatus;
    if (setup) {
        const reranked = await moodRerank(ranked, design, bytes ?? file, setup);
        design = reranked.design;
        picks = reranked.rerank.candidates.slice(0, n);
        moodStatus = statusOf(reranked.rerank);
    }
    const title = `${product.brand} ${product.model} colors for ${file}`;
    const chips = design.palette.map((entry, i) => ({
        hex: entry.hex,
        name: `${Math.round(entry.share * 100)}% · near ${picks[0]?.designColors[i]?.wada.name ?? entry.hex}`,
    }));
    const heading = (i) => `${i + 1}. ${picks[i].color.name} · score ${fmt(picks[i].score, 3)}${moodSuffix(picks[i])}`;
    const designLine = `Design: ${chips.map((c) => `${c.hex} ${c.name}`).join(", ")}; ink luminance ${fmt(design.inkLuminance)}`;
    const header = [designLine, ...(moodStatus ? [moodLine(moodStatus, file)] : [])].join("\n");
    return {
        title,
        json: {
            product: { id: product.id, name: product.name },
            design,
            picks,
            ...(moodStatus && { mood: moodStatus }),
        },
        text: (color) => [
            `${title}\n${header}\n`,
            ...picks.map((pick, i) => [
                heading(i),
                renderAnsi([pick.color], { color }).trimEnd(),
                ...pick.reasons.map((r) => `  ${r}`),
                ...pick.warnings.map((w) => `  Warning: ${w}`),
            ].join("\n") + "\n"),
        ].join("\n"),
        sections: picks.map((pick, i) => ({
            title: heading(i),
            ...moodBadge(pick),
            svg: renderProductCard(pick.color, { designColors: chips }),
            caption: [...pick.reasons, ...pick.warnings.map((w) => `Warning: ${w}`)].join(" "),
        })),
    };
}
/** Default `-n` for `recolor`. */
export const DEFAULT_RECOLOR_N = 5;
export async function recolorView({ file, bytes, n, product: productId, apply, vet, includeImplausible, }) {
    let product;
    try {
        product = loadProduct(productId ?? loadProductIndex().default);
    }
    catch (error) {
        throw new InputError(error.message);
    }
    let design = await fingerprintDesign(file, bytes);
    let plans;
    let vetStatus;
    if (vet) {
        const setup = vet === true ? {} : vet;
        const vetted = await vetPlans(design, bytes ?? file, { product, n, includeImplausible: includeImplausible ?? false }, setup);
        design = vetted.design;
        plans = vetted.plans;
        vetStatus = vetted.status;
    }
    else {
        plans = recolorPlans(design, { product, n });
    }
    const applied = [];
    if (apply !== undefined) {
        await mkdir(apply, { recursive: true });
        const stem = basename(file, extname(file));
        for (const plan of plans) {
            const out = join(apply, `${stem}-${plan.color.slug}.png`);
            applied.push(await applyRecolor(bytes ?? file, plan.mapping, { out, fingerprint: design }));
        }
    }
    const title = `${product.brand} ${product.model} colors for ${file}, recolored`;
    const heading = (i) => {
        const plan = plans[i];
        const via = plan.combination.source === "book" ? `combination ${plan.combination.id}` : `${plan.combination.harmony} harmony`;
        return `${i + 1}. ${plan.color.name} · ${via} · score ${fmt(plan.score, 3)}${plan.flagged ? " · flagged" : ""}${plausibilityNote(plan)}`;
    };
    const vetLines = vetStatus
        ? [
            ...(vetStatus.reason ? [vetStatus.reason] : []),
            ...vetStatus.dropped.map((d) => `Dropped ${d.garment}: ${d.reasons.join(" ")}`),
            ...(plans.length === 0 ? ["Every plan was implausible; pass --include-implausible to see them."] : []),
        ]
        : [];
    const appliedLine = (result) => result === undefined ? [] : [result.applicable ? `Wrote ${result.out}` : `Not applied: ${result.reason}`];
    return {
        title,
        json: {
            product: { id: product.id, name: product.name },
            design,
            plans: plans.map((plan, i) => (applied[i] ? { ...plan, applied: applied[i] } : plan)),
            ...(vetStatus && { vet: vetStatus }),
        },
        text: (color) => [
            `${title}\n`,
            ...(vetLines.length ? [`${vetLines.join("\n")}\n`] : []),
            ...plans.map((plan, i) => [
                heading(i),
                renderAnsi([plan.color], { color }).trimEnd(),
                ...plan.mapping.map((m) => `  ${m.from.hex} (${Math.round(m.from.share * 100)}%) -> ${m.to.name} ${m.to.hex}` +
                    ("plausibility" in m && m.plausibility !== null ? ` · plausibility ${fmt(m.plausibility, 2)}` : "")),
                `  Prompt: ${plan.prompt}`,
                ...plan.reasons.map((r) => `  ${r}`),
                ...plan.warnings.map((w) => `  Warning: ${w}`),
                ...appliedLine(applied[i]).map((line) => `  ${line}`),
            ].join("\n") + "\n"),
        ].join("\n"),
        // Each garment card with the design's colors before and after.
        sections: plans.map((plan, i) => ({
            title: heading(i),
            svg: renderProductCard(plan.color, {
                recolor: plan.mapping.map((m) => ({
                    from: { hex: m.from.hex, name: m.from.element ?? `${Math.round(m.from.share * 100)}%` },
                    to: { hex: m.to.hex, name: m.to.name },
                })),
            }),
            caption: [
                plan.prompt,
                ...plan.reasons,
                ...plan.warnings.map((w) => `Warning: ${w}`),
                ...appliedLine(applied[i]),
            ].join(" "),
        })),
    };
}
/** How many ranked palettes `theme` tries for a color before giving up. */
export const THEME_PALETTE_SEARCH = 24;
/**
 * A web theme from a book combination by ID, or from the highest-ranked
 * palette for a color that yields a legible theme in the mode.
 */
export function themeView({ query, mode, format }) {
    const { title, colors, chosen, result } = /^\d+$/.test(query.trim())
        ? themeForCombination(Number(query.trim()), mode)
        : themeForColor(query, mode);
    if (!result.ok)
        throw new InputError(`${title}: ${result.reasons.join(" ")}`);
    // Contrast is symmetric, so a combination legible in one mode is legible in both.
    const other = theme(colors, { mode: mode === "light" ? "dark" : "light" });
    const [light, dark] = mode === "light" ? [result, other] : [other, result];
    const roleSwatches = THEME_ROLES.map((role) => ({
        hex: result.colors[role].hex,
        name: role,
        note: result.colors[role].name ?? result.colors[role].derived ?? "",
    }));
    const ramps = result.source.map((c) => namedRamp(c));
    return {
        title,
        json: { combination: chosen, theme: result },
        text: (color) => {
            if (format === "css")
                return toCssVariables(result);
            if (format === "tailwind")
                return toTailwindTheme(result);
            if (format === "tokens")
                return `${JSON.stringify(toDesignTokens(result), null, 2)}\n`;
            const pairings = result.pairings.map((p) => `  ${p.foreground} on ${p.background}: ${p.wcag.ratio}:1 WCAG ${p.wcag.level}, APCA Lc ${p.apca.lc} (${p.apca.level})`);
            return [
                `${title} · ${result.mode} mode`,
                chosen.detail,
                "",
                renderAnsi(roleSwatches, { color }).trimEnd(),
                "",
                ...THEME_ROLES.filter((r) => result.colors[r].derived).map((r) => `  ${describeRole(r, result.colors[r])}`),
                "",
                "Pairings:",
                ...pairings,
                "",
                ...result.reasons.map((r) => `  ${r}`),
                "",
            ].join("\n");
        },
        sections: [
            { title: "Sample UI", html: renderThemePreview([light, dark]), caption: chosen.detail },
            { svg: renderSwatchGrid(roleSwatches, { title: `Roles, ${result.mode} mode` }) },
            ...ramps.map((r) => ({
                svg: renderSwatchGrid(r.steps.map((s) => ({ hex: s.hex, name: s.name, ...(s.name === r.anchor && { note: "input" }) })), { title: `${r.color.name ?? r.color.hex} ramp`, columns: 11, tileWidth: 72, tileHeight: 72 }),
            })),
        ],
    };
}
function themeForCombination(id, mode) {
    const combination = loadCombinations().find((c) => c.id === id);
    if (!combination) {
        throw new InputError(`unknown combination ${id}; the book's IDs run from 1 to ${loadCombinations().length}`);
    }
    const byIndex = new Map(loadColors().map((c) => [c.index, c]));
    const colors = combination.colors.map((i) => {
        const c = byIndex.get(i);
        return { hex: c.hex, name: c.name };
    });
    return {
        title: `Theme from combination ${id}`,
        colors,
        chosen: { id, detail: `Combination ${id} · ${colors.map((c) => c.name).join(", ")}` },
        result: theme({ colors: combination.colors }, { mode }),
    };
}
function themeForColor(query, mode) {
    const found = combinations(query, { limit: THEME_PALETTE_SEARCH });
    const resolved = requireResolved(query, found.resolved, found.reason);
    const title = `Theme for ${describeQuery(query, resolved)}`;
    for (const palette of found.palettes) {
        const colors = paletteSwatches(palette).map((c) => ({ hex: c.hex, ...(c.name && { name: c.name }) }));
        const result = theme(colors, { mode });
        if (result.ok) {
            const id = palette.source === "book" ? palette.combination.id : undefined;
            return {
                title,
                colors,
                chosen: {
                    ...(id !== undefined && { id }),
                    detail: `${paletteTitle(palette)} · ${colors.map((c) => c.name ?? c.hex).join(", ")}`,
                },
                result,
            };
        }
    }
    return {
        title,
        colors: [],
        chosen: { detail: "" },
        result: {
            ok: false,
            mode,
            reasons: [
                `None of the top ${found.palettes.length} palettes has a pair of colors with WCAG AA contrast for body text.`,
            ],
        },
    };
}
function moodSetup(mood) {
    if (mood === true)
        return {};
    return mood || undefined;
}
/**
 * Describe the design when it has no description yet, then re-rank the
 * candidates by mood. Never throws for want of Jev or a vision provider, or
 * for a failed request: the candidates keep their deterministic order and the
 * status says why. When Jev cannot be called, only a cached description is
 * read, so no vision call is spent on a re-rank that cannot happen.
 */
async function moodRerank(candidates, design, input, setup) {
    const jev = setup.client ? { available: true } : await jevAvailability();
    const deterministic = async (reason) => {
        const rerank = await rerankByMood(candidates, { palette: design.palette });
        return { ...rerank, note: `${reason} The order is the deterministic one.` };
    };
    let described = design;
    if (!design.description) {
        try {
            described = await describeDesign(design, input, {
                providers: jev.available ? (setup.providers ?? defaultVisionProviders()) : [],
            });
        }
        catch (error) {
            if (!(error instanceof VisionUnavailableError))
                throw error;
            const reason = jev.available ? error.message.replace(/\n+/g, " ") : new JevUnavailableError(jev.reason).message;
            return { design, rerank: await deterministic(reason) };
        }
    }
    try {
        const rerank = await rerankByMood(candidates, described, {
            ...(setup.client && { client: setup.client }),
            ...(setup.cache !== undefined && { cache: setup.cache }),
        });
        return { design: described, rerank };
    }
    catch (error) {
        return { design: described, rerank: await deterministic(`Mood re-ranking failed: ${error.message}.`) };
    }
}
function statusOf(rerank) {
    return {
        requested: true,
        applied: rerank.applied,
        weight: rerank.weight,
        ...(rerank.note !== undefined && { reason: rerank.note }),
        ...(rerank.model !== undefined && { model: rerank.model }),
        ...(rerank.cached !== undefined && { cached: rerank.cached }),
    };
}
function moodLine(status, file) {
    return status.applied
        ? `Mood: re-ranked by Jev for ${file}, mood weight ${status.weight}${status.cached ? " (cached)" : ""}`
        : `Mood: not applied. ${status.reason}`;
}
/**
 * The mood judgment and the combined score that ranked the candidate. The
 * deterministic score stays in the heading as `score`, so the text matches the
 * JSON field for field and the order is explained by `combined`.
 */
function moodSuffix(candidate) {
    if (!candidate.moodLevel)
        return "";
    return ` · mood ${candidate.moodLevel} (${fmt(candidate.moodScore, 2)}) · combined ${fmt(candidate.combinedScore, 3)}`;
}
function moodBadge(candidate) {
    return candidate.moodLevel ? { badge: `Mood: ${candidate.moodLevel}` } : {};
}
/**
 * Describe the design when it has no description yet, then plan and vet.
 * Never throws for want of Jev or a vision provider, or for a failed request:
 * the plans are the deterministic ones and the status says why. When Jev
 * cannot be called, only a cached description is read, so no vision call is
 * spent on vetting that cannot happen; cached Jev answers still apply.
 */
async function vetPlans(design, input, options, setup) {
    const jev = setup.client ? { available: true } : await jevAvailability();
    const deterministic = (reason) => ({
        plans: recolorPlans(design, { product: options.product, n: options.n }),
        status: { requested: true, applied: false, vetted: 0, dropped: [], reason: `Swaps were not vetted: ${reason}` },
    });
    let described = design;
    if (!design.description) {
        try {
            described = await describeDesign(design, input, {
                providers: jev.available ? (setup.providers ?? defaultVisionProviders()) : [],
            });
        }
        catch (error) {
            if (!(error instanceof VisionUnavailableError))
                throw error;
            const reason = jev.available ? error.message.replace(/\n+/g, " ") : new JevUnavailableError(jev.reason).message;
            return { design, ...deterministic(reason) };
        }
    }
    const vetOptions = {};
    if (setup.client)
        vetOptions.client = setup.client;
    if (setup.cache !== undefined)
        vetOptions.cache = setup.cache;
    if (setup.threshold !== undefined)
        vetOptions.threshold = setup.threshold;
    let result;
    try {
        result = await vettedRecolorPlans(described, { ...vetOptions, ...options });
    }
    catch (error) {
        return { design: described, ...deterministic(`the request failed: ${error.message}`) };
    }
    const status = {
        requested: true,
        applied: result.vetted > 0,
        vetted: result.vetted,
        dropped: result.dropped.map((p) => ({
            garment: p.color.name,
            plausibility: p.plausibility,
            reasons: p.reasons.filter((r) => r.startsWith("Implausible:")),
        })),
    };
    if (result.skipped)
        status.reason = result.skipped.note;
    if (result.model)
        status.model = result.model;
    return { design: described, plans: result.plans, status };
}
/** ` · plausibility 0.83` or ` · implausible (0.12)` for a vetted plan; empty otherwise. */
function plausibilityNote(plan) {
    if (!("plausibility" in plan) || plan.plausibility === null)
        return "";
    return plan.implausible
        ? ` · implausible (${fmt(plan.plausibility, 2)})`
        : ` · plausibility ${fmt(plan.plausibility, 2)}`;
}
/** Fingerprint a design from its bytes when given, else from the file at `file`. */
async function fingerprintDesign(file, bytes) {
    try {
        return await fingerprint(bytes ?? file);
    }
    catch (error) {
        const { code, message } = error;
        throw new InputError(code === "ENOENT" ? `no such design file ${JSON.stringify(file)}` : `cannot read ${file}: ${message}`);
    }
}
function requireResolved(query, resolved, reason) {
    if (resolved)
        return resolved;
    if (looksLikeHex(query)) {
        throw new InputError(`malformed hex ${JSON.stringify(query)}; use #rgb or #rrggbb`);
    }
    throw new InputError(reason ?? `unknown color ${JSON.stringify(query)}`);
}
/** A query meant as hex: a leading `#`, or only hex digits with at least one digit 0-9. */
function looksLikeHex(query) {
    const q = query.trim();
    if (isHex(q))
        return false;
    return q.startsWith("#") || (/^[0-9a-f]+$/i.test(q) && /\d/.test(q));
}
function describeQuery(query, resolved) {
    if (resolved.via === "hex" || resolved.via === "color")
        return resolved.hex;
    const source = resolved.via === "wada" ? "Wada" : resolved.via === "css" ? "CSS" : "xkcd";
    return `${resolved.name ?? query} (${source} ${resolved.hex})`;
}
function paletteTitle(p) {
    if (p.source === "book")
        return `Combination ${p.combination.id}`;
    return `${p.harmony[0].toUpperCase()}${p.harmony.slice(1)} harmony`;
}
function paletteDetail(p) {
    const origin = p.source === "book" ? `via ${p.match.color.name}` : "generated";
    return `${origin} · score ${fmt(p.score)} · contrast ${fmt(p.contrast)}`;
}
function paletteSwatches(p) {
    if (p.source === "book")
        return p.colors;
    return p.snaps.map((s) => ({ ...s.color, note: `from ${s.target}, distance ${fmt(s.distance)}` }));
}
//# sourceMappingURL=commands.js.map