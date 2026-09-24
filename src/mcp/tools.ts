/**
 * The MCP tools. Each wraps the CLI command of the same job, so the server and
 * the CLI return the same results: the command's JSON, plus the rendered card
 * as `svg` and a `resultId` that `render_card` can render again as SVG or HTML.
 *
 * Loaded only by `createServer`, after the MCP SDK, so its `zod` import (a peer
 * dependency of the SDK) is never reached by consumers of the core.
 */

import { z } from "zod";

import {
  combosView,
  DEFAULT_RECOLOR_N,
  DEFAULT_RECOMMEND_N,
  InputError,
  nearestView,
  palettesView,
  recolorView,
  recommendView,
  themeView,
  type View,
} from "../cli/commands.js";
import { DEFAULT_COMBOS_LIMIT, stackSvg } from "../cli/index.js";
import { check, type CheckResult, type SwatchInput } from "../accessibility.js";
import { loadCombinations, loadProduct, loadProductIndex } from "../data/index.js";
import { DEFAULT_NEAREST_K, resolveQuery } from "../nearest.js";
import { renderCombination, renderHtml, renderSwatchGrid, type Swatch } from "../render/index.js";
import { type Theme, type ThemeMode, toCssVariables, toDesignTokens, toTailwindTheme } from "../theme.js";

/** How many results `render_card` can reach back to. Older ones are dropped. */
export const RESULT_HISTORY = 50;

/** A tool's reply: one text block holding JSON, as the MCP SDK expects. */
export interface ToolReply {
  [key: string]: unknown;
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

/** Why a Jev option was asked for but not applied. */
export interface JevStatus {
  requested: true;
  applied: false;
  reason: string;
}

/** A tool as registered with `McpServer.registerTool`. */
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: z.ZodRawShape;
  handler: (args: Record<string, unknown>) => Promise<ToolReply>;
}

/** Views kept for `render_card`, by result ID, oldest first. */
export class ResultStore {
  private readonly views = new Map<string, View>();
  private next = 1;

  constructor(private readonly limit = RESULT_HISTORY) {}

  add(view: View): string {
    const id = `r${this.next++}`;
    this.views.set(id, view);
    while (this.views.size > this.limit) this.views.delete(this.views.keys().next().value!);
    return id;
  }

  get(id: string): View | undefined {
    return this.views.get(id);
  }
}

// ---------------------------------------------------------------------------
// Shared inputs

const product = z
  .string()
  .optional()
  .describe("Product ID from list_products. Defaults to Comfort Colors 1717 (comfort-colors-1717).");

const colorQuery = z
  .string()
  .describe('A hex code ("#b8b8a0" or "b8b8a0"), or a Wada, CSS, or xkcd color name ("hermosa pink").');

const designPath = z
  .string()
  .optional()
  .describe("Path to the design file (PNG, WebP, or JPEG) on the server's machine. Give this or designBase64.");

const designBase64 = z
  .string()
  .optional()
  .describe("The design file's bytes as base64, with or without a data: URL prefix. Give this or designPath.");

const count = (fallback: number, what: string) =>
  z.number().int().min(1).max(50).optional().describe(`How many ${what}. Default ${fallback}.`);

// ---------------------------------------------------------------------------
// Tools

/** Every tool the server exposes, bound to one result store. */
export function toolDefinitions(store: ResultStore = new ResultStore()): ToolDefinition[] {
  const reply = (view: View, extra: Record<string, unknown> = {}): ToolReply =>
    json({ resultId: store.add(view), ...(view.json as object), ...extra, svg: viewSvg(view) });

  const tools: ToolDefinition[] = [
    {
      name: "nearest_colors",
      description:
        "Find the Wada colors closest to a color. Use this to name a hex code, to translate a CSS or xkcd " +
        "color name into the book's vocabulary, or as the first step before asking for combinations. " +
        "Distances are OKLab scaled so black to white is 100; about 2 is a just-noticeable difference.",
      inputSchema: {
        query: colorQuery,
        k: count(DEFAULT_NEAREST_K, "matches to return"),
      },
      handler: async ({ query, k }) =>
        reply(nearestView({ query: query as string, k: (k as number | undefined) ?? DEFAULT_NEAREST_K })),
    },
    {
      name: "combinations",
      description:
        "Get color palettes for one color from Sanzo Wada's A Dictionary of Color Combinations, falling back to " +
        "generated harmonies snapped to Wada colors when the book has too few. Use this for any color that is not " +
        "a garment color; for a shirt color by name use palettes_for_product_color instead, which anchors on the " +
        "garment's stored Wada equivalents.",
      inputSchema: {
        query: colorQuery,
        size: z.number().int().min(2).max(4).optional().describe("Only palettes with this many colors, 2 to 4."),
        limit: count(DEFAULT_COMBOS_LIMIT, "palettes to return"),
      },
      handler: async ({ query, size, limit }) =>
        reply(
          combosView({
            query: query as string,
            limit: (limit as number | undefined) ?? DEFAULT_COMBOS_LIMIT,
            ...(size !== undefined && { size: size as number }),
          }),
        ),
    },
    {
      name: "palettes_for_product_color",
      description:
        "Get palettes for a garment color by its product name, such as the Comfort Colors 1717 color " +
        '"Pepper": the garment first, then ink colors that print legibly on it, each with its contrast. Use this ' +
        "when someone names a shirt color and wants design colors for it. Warns when the print provider does not " +
        "stock the color.",
      inputSchema: {
        name: z.string().describe('The product color\'s name, slug, or alias, such as "Pepper" or "blue-jean".'),
        product,
        size: z.number().int().min(2).max(4).optional().describe("Only palettes with this many colors, 2 to 4."),
        limit: count(DEFAULT_COMBOS_LIMIT, "palettes to return"),
      },
      handler: async ({ name, product: productId, size, limit }) =>
        reply(
          palettesView({
            name: name as string,
            limit: (limit as number | undefined) ?? DEFAULT_COMBOS_LIMIT,
            ...(size !== undefined && { size: size as number }),
            ...(productId !== undefined && { product: productId as string }),
          }),
        ),
    },
    {
      name: "recommend_product_colors",
      description:
        "Rank a product's garment colors for a design without changing the design. Use this when someone has " +
        "finished artwork and asks which shirt colors to offer it on. Each pick carries its score, plain-language " +
        "reasons, and a warning for each design color that would vanish into the garment. Use recolor_plans " +
        "instead when the design's colors may change.",
      inputSchema: {
        designPath,
        designBase64,
        n: count(DEFAULT_RECOMMEND_N, "garment colors to return"),
        product,
        mood: z
          .boolean()
          .optional()
          .describe("Re-rank the picks by how well each garment suits the design's mood, with Jev."),
      },
      handler: async ({ designPath: path, designBase64: base64, n, product: productId, mood }) => {
        const design = designInput(path, base64);
        const view = await recommendView({
          ...design,
          n: (n as number | undefined) ?? DEFAULT_RECOMMEND_N,
          ...(productId !== undefined && { product: productId as string }),
        });
        return reply(view, mood ? { mood: jevStatus("mood") } : {});
      },
    },
    {
      name: "recolor_plans",
      description:
        "Plan a recolor of a design for each of a product's garment colors: a from-to mapping of the design's " +
        "colors onto a Wada combination that includes the garment, keeping lightness order, plus a prompt for " +
        "redrawing painterly art. Use this when the design's colors may change to suit the shirt. Give outDir to " +
        "also write each recolored PNG; photographic art is detected and left to the prompt.",
      inputSchema: {
        designPath,
        designBase64,
        n: count(DEFAULT_RECOLOR_N, "garment colors to plan for"),
        product,
        outDir: z
          .string()
          .optional()
          .describe("Directory on the server's machine to write each recolored PNG to. Omit to only plan."),
        vet: z
          .boolean()
          .optional()
          .describe("Check with Jev that each swap keeps the subject recognizable, such as a strawberry staying red."),
      },
      handler: async ({ designPath: path, designBase64: base64, n, product: productId, outDir, vet }) => {
        const design = designInput(path, base64);
        const view = await recolorView({
          ...design,
          n: (n as number | undefined) ?? DEFAULT_RECOLOR_N,
          ...(productId !== undefined && { product: productId as string }),
          ...(outDir !== undefined && { apply: outDir as string }),
        });
        return reply(view, vet ? { vet: jevStatus("vet") } : {});
      },
    },
    {
      name: "theme",
      description:
        "Build a light or dark web theme (background, surface, text, muted text, accent, and on-accent roles, " +
        "each checked for WCAG and APCA contrast) from a color or a book combination ID. Use this when someone " +
        "wants site or app colors. The result includes CSS variables, a Tailwind theme, and design tokens; " +
        "render_card with format html shows a sample UI in both modes.",
      inputSchema: {
        query: z
          .string()
          .describe("A hex code, a Wada, CSS, or xkcd color name, or a book combination ID such as \"42\"."),
        mode: z.enum(["light", "dark"]).optional().describe("Default light."),
      },
      handler: async ({ query, mode }) => {
        const view = themeView({ query: query as string, mode: (mode as ThemeMode | undefined) ?? "light" });
        // themeView throws unless the theme is legible, so it is a full Theme here.
        const { theme } = view.json as { theme: Theme };
        return reply(view, {
          css: toCssVariables(theme),
          tailwind: toTailwindTheme(theme),
          tokens: toDesignTokens(theme),
        });
      },
    },
    {
      name: "check_accessibility",
      description:
        "Check a set of colors for contrast and color-vision safety. Use this before recommending colors for text " +
        "or interface elements (web-text, web-ui: WCAG 2.2 AA, with APCA alongside) or for a print where colors " +
        "must stay distinct on fabric (print: a minimum OKLab distance). Every context also simulates protanopia, " +
        "deuteranopia, and tritanopia and reports pairs that collapse.",
      inputSchema: {
        colors: z
          .array(z.string())
          .optional()
          .describe("Two or more hex codes or color names. Give this or combinationId."),
        combinationId: z
          .number()
          .int()
          .optional()
          .describe("A combination ID from Wada's book, 1 to 348. Give this or colors."),
        context: z.enum(["web-text", "web-ui", "print"]).optional().describe("Default web-text."),
      },
      handler: async ({ colors, combinationId, context }) =>
        reply(accessibilityView(colors as string[] | undefined, combinationId as number | undefined, (context as CheckResult["context"] | undefined) ?? "web-text")),
    },
    {
      name: "list_products",
      description:
        "List the garment products this package knows, or one product's colors with hex, family, and whether " +
        "the print provider stocks each. Use this to find a product ID or a color's exact name before calling " +
        "the other tools, or to show someone a product's color range.",
      inputSchema: {
        product: z
          .string()
          .optional()
          .describe("A product ID to list colors for. Omit to list products and the default."),
      },
      handler: async ({ product: productId }) => reply(productsView(productId as string | undefined)),
    },
    {
      name: "render_card",
      description:
        "Render swatch cards as SVG or as a self-contained HTML page. Use this to show an earlier result in " +
        "another format, such as an HTML review page or a theme's sample UI, by giving the resultId that every " +
        "other tool returns; or give colors to render a quick swatch grid of your own.",
      inputSchema: {
        resultId: z.string().optional().describe('The resultId from an earlier call, such as "r3". Give this or colors.'),
        colors: z.array(z.string()).optional().describe("Hex codes or color names to render. Give this or resultId."),
        format: z.enum(["svg", "html"]).optional().describe("Default svg."),
        title: z.string().optional().describe("Card or page title."),
      },
      handler: async ({ resultId, colors, format, title }) => {
        const view = cardView(store, resultId as string | undefined, colors as string[] | undefined, title as string | undefined);
        if ((format ?? "svg") === "html") {
          return json({ format: "html", html: renderHtml(view.sections, { title: view.title }) });
        }
        return json({ format: "svg", svg: viewSvg(view) });
      },
    },
  ];
  return tools.map((tool) => ({ ...tool, handler: guard(tool.handler) }));
}

// ---------------------------------------------------------------------------
// Views the CLI has no command for

function accessibilityView(
  colors: string[] | undefined,
  combinationId: number | undefined,
  context: CheckResult["context"],
): View {
  if ((colors === undefined) === (combinationId === undefined)) {
    throw new InputError("give either colors or combinationId");
  }
  let input: SwatchInput[] | { colors: readonly number[] };
  let title: string;
  if (combinationId !== undefined) {
    const combination = loadCombinations().find((c) => c.id === combinationId);
    if (!combination) {
      throw new InputError(`unknown combination ${combinationId}; the book's IDs run from 1 to ${loadCombinations().length}`);
    }
    input = { colors: combination.colors };
    title = `Accessibility of combination ${combinationId}, ${context}`;
  } else {
    input = colors!.map(resolveSwatch);
    title = `Accessibility, ${context}`;
  }
  const result = check(input, { context });
  return {
    title,
    json: result,
    text: () => result.reasons.join("\n"),
    sections: [
      {
        svg: renderCombination(
          { ...(combinationId !== undefined && { id: combinationId }), colors: result.colors },
          { contrast: true },
        ),
        caption: result.reasons.join(" "),
      },
    ],
  };
}

function productsView(productId: string | undefined): View {
  const index = loadProductIndex();
  if (productId === undefined) {
    const title = "Products";
    return { title, json: index, text: () => index.products.map((p) => p.id).join("\n"), sections: [] };
  }
  let found;
  try {
    found = loadProduct(productId);
  } catch (error) {
    throw new InputError((error as Error).message);
  }
  const title = `${found.brand} ${found.model} colors`;
  const colors = found.colors.map(({ name, slug, hex, family, available, aliases }) => ({
    name,
    slug,
    hex,
    family,
    available,
    aliases,
  }));
  return {
    title,
    json: { id: found.id, name: found.name, printMethod: found.printMethod, colors },
    text: () => colors.map((c) => `${c.name} ${c.hex}`).join("\n"),
    sections: [
      {
        svg: renderSwatchGrid(
          colors.map((c): Swatch => ({ hex: c.hex, name: c.name, ...(!c.available && { note: "not stocked" }) })),
          { title, columns: 8 },
        ),
      },
    ],
  };
}

function cardView(store: ResultStore, resultId: string | undefined, colors: string[] | undefined, title: string | undefined): View {
  if ((resultId === undefined) === (colors === undefined)) {
    throw new InputError("give either resultId or colors");
  }
  if (resultId !== undefined) {
    const view = store.get(resultId);
    if (!view) {
      throw new InputError(`no result ${JSON.stringify(resultId)}; the server keeps the last ${RESULT_HISTORY} results`);
    }
    return title === undefined ? view : { ...view, title };
  }
  const swatches = colors!.map(resolveSwatch);
  const heading = title ?? "Colors";
  return { title: heading, json: swatches, text: () => "", sections: [{ svg: renderSwatchGrid(swatches, { title: heading }) }] };
}

// ---------------------------------------------------------------------------
// Helpers

function json(value: unknown): ToolReply {
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}

/** Turn input errors into tool errors the agent can read and correct. */
function guard(handler: ToolDefinition["handler"]): ToolDefinition["handler"] {
  return async (args) => {
    try {
      return await handler(args);
    } catch (error) {
      if (error instanceof InputError) {
        return { content: [{ type: "text", text: error.message }], isError: true };
      }
      throw error;
    }
  };
}

/** A view's SVG sections stacked into one document, or undefined when it has none. */
function viewSvg(view: View): string | undefined {
  const svgs = view.sections.flatMap((s) => (s.svg ? [s.svg] : []));
  return svgs.length === 0 ? undefined : stackSvg(svgs, view.title);
}

function resolveSwatch(query: string): Swatch & { hex: string } {
  const resolved = resolveQuery(query);
  if (!resolved) throw new InputError(`unknown color ${JSON.stringify(query)}`);
  return { hex: resolved.hex, ...(resolved.name !== undefined && { name: resolved.name }) };
}

/** Read a design from a path or base64, exactly one of them. */
function designInput(path: unknown, base64: unknown): { file: string; bytes?: Uint8Array } {
  if ((path === undefined) === (base64 === undefined)) {
    throw new InputError("give either designPath or designBase64");
  }
  if (path !== undefined) return { file: path as string };
  const data = (base64 as string).replace(/^data:[^,]*;base64,/, "").replace(/\s+/g, "");
  if (data.length === 0 || !/^[A-Za-z0-9+/_-]+=*$/.test(data)) {
    throw new InputError("designBase64 is not valid base64");
  }
  return { file: "design", bytes: Buffer.from(data, "base64") };
}

/**
 * Jev judgments arrive in later issues (INT-2268 for mood, INT-2270 for
 * vetting). Until then a tool asked for one returns its deterministic result
 * and says why the judgment was skipped. The key is checked for presence only.
 */
export function jevStatus(option: "mood" | "vet"): JevStatus {
  const what = option === "mood" ? "Mood re-ranking" : "Swap vetting";
  const reason = process.env.TYPESAFE_API_KEY
    ? `${what} with Jev is not available in this version, so the result uses the deterministic ranking only.`
    : `${what} needs Jev and TYPESAFE_API_KEY is not set, so the result uses the deterministic ranking only.`;
  return { requested: true, applied: false, reason };
}
