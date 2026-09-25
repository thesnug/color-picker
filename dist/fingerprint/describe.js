/**
 * The vision pass: one model call per design that writes what the design
 * depicts, so Jev (which is text-only) can judge palettes and recolors against
 * it. See docs/DESIGN.md, "Pipelines".
 *
 * Two providers, tried in order: the Codex CLI on the machine's ChatGPT login,
 * then OpenRouter when `OPENROUTER_API_KEY` is set. Both get the same prompt
 * and JSON schema and their answers are validated the same way. Descriptions
 * are cached by file hash next to the fingerprints, so a design is described
 * once.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { distance } from "../color/index.js";
/** Bump when the prompt or schema changes, to invalidate cached descriptions. */
export const DESCRIPTION_VERSION = 1;
/** Default model for both providers, so a description reads the same whichever answered. */
export const CODEX_DEFAULT_MODEL = "gpt-6-sol";
export const OPENROUTER_DEFAULT_MODEL = "openai/gpt-6-sol";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
// ---------------------------------------------------------------------------
// Prompt and schema
/** The fixed prompt, with the design's palette listed so each element names one of its colors. */
export function describePrompt(palette) {
    const colors = palette.map((c) => `- ${c.hex} (${Math.round(c.share * 100)}% of the design)`).join("\n");
    return [
        "You are describing a design that will be printed on a garment. Look at the image and answer in JSON.",
        "",
        "- subject: what the design depicts, in one line.",
        "- mood: its mood and style, in one line.",
        "- elements: the distinct things drawn (for example \"strawberry body\", \"leaves\", \"title text\"), " +
            "each with its color in plain words and the hex of the listed color that paints it. " +
            "Name each thing in a few lowercase words. Leave out anything too small to notice. " +
            "Every listed color should paint at least one element, and more than one element may share a color.",
        "",
        "The design's main colors, measured from its pixels:",
        colors,
    ].join("\n");
}
/** JSON Schema for the answer. Strict-mode compatible: every property required, no extras. */
export function descriptionSchema(palette) {
    return {
        type: "object",
        properties: {
            subject: { type: "string" },
            mood: { type: "string" },
            elements: {
                type: "array",
                items: {
                    type: "object",
                    properties: {
                        name: { type: "string" },
                        color: { type: "string" },
                        hex: { type: "string", enum: palette.map((c) => c.hex.toLowerCase()) },
                    },
                    required: ["name", "color", "hex"],
                    additionalProperties: false,
                },
            },
        },
        required: ["subject", "mood", "elements"],
        additionalProperties: false,
    };
}
/**
 * Check an answer against the schema. A hex that is not in the palette, which
 * a provider without strict schemas can return, is snapped to the nearest
 * palette color.
 *
 * @throws {TypeError} naming the first field that does not match.
 */
export function validateAnswer(answer, palette) {
    const fail = (what) => {
        throw new TypeError(`Vision answer does not match the schema: ${what}.`);
    };
    if (!isRecord(answer))
        return fail("expected an object");
    const line = (key) => {
        const value = answer[key];
        if (typeof value !== "string" || !value.trim())
            return fail(`\`${key}\` must be a non-empty string`);
        return value.trim().replace(/\s+/g, " ");
    };
    const subject = line("subject");
    const mood = line("mood");
    if (!Array.isArray(answer.elements))
        return fail("`elements` must be an array");
    const hexes = palette.map((c) => c.hex.toLowerCase());
    const elements = answer.elements.map((e, i) => {
        if (!isRecord(e))
            return fail(`elements[${i}] must be an object`);
        const { name, color, hex } = e;
        if (typeof name !== "string" || !name.trim())
            return fail(`elements[${i}].name must be a non-empty string`);
        if (typeof color !== "string" || !color.trim())
            return fail(`elements[${i}].color must be a non-empty string`);
        if (typeof hex !== "string" || !/^#[0-9a-f]{6}$/i.test(hex))
            return fail(`elements[${i}].hex must be a hex color`);
        return { name: name.trim(), color: color.trim(), hex: snap(hex.toLowerCase(), hexes) };
    });
    return { subject, mood, elements };
}
function snap(hex, palette) {
    if (palette.length === 0 || palette.includes(hex))
        return hex;
    let best = palette[0];
    for (const p of palette)
        if (distance(hex, p) < distance(hex, best))
            best = p;
    return best;
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
/**
 * The palette with each color's `element` set from the description: the names
 * of the elements it paints, joined with "and", in the order the model listed
 * them. Colors no element names are returned unchanged.
 */
export function labelPalette(palette, description) {
    return palette.map((c) => {
        const names = description.elements.filter((e) => e.hex === c.hex.toLowerCase()).map((e) => e.name);
        const unique = [...new Set(names)];
        return unique.length ? { ...c, element: unique.join(" and ") } : { ...c };
    });
}
// ---------------------------------------------------------------------------
// Media type
export function sniffMediaType(bytes) {
    const ascii = (start, end) => String.fromCharCode(...bytes.subarray(start, end));
    if (bytes[0] === 0x89 && ascii(1, 4) === "PNG")
        return "image/png";
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
        return "image/jpeg";
    if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP")
        return "image/webp";
    throw new TypeError("Unsupported image format; expected PNG, WebP, or JPEG.");
}
const EXTENSIONS = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
};
/**
 * The Codex CLI, run non-interactively on the machine's existing login (a
 * ChatGPT subscription or its own key); this package handles no credential.
 * It runs in a scratch directory with a read-only sandbox, ignores the user's
 * `config.toml` so their hooks and MCP servers do not start, and leaves no
 * session behind.
 */
export function codexProvider(options = {}) {
    const command = options.command ?? "codex";
    const model = options.model ?? CODEX_DEFAULT_MODEL;
    return {
        name: "codex",
        async describe({ image, prompt, schema, signal }) {
            const dir = await mkdtemp(join(tmpdir(), "color-picker-describe-"));
            try {
                const imagePath = join(dir, `design.${EXTENSIONS[image.mediaType]}`);
                const schemaPath = join(dir, "schema.json");
                const outPath = join(dir, "answer.json");
                await writeFile(imagePath, image.bytes);
                await writeFile(schemaPath, JSON.stringify(schema));
                const args = [
                    "exec",
                    "--ephemeral",
                    "--ignore-user-config",
                    "--sandbox",
                    "read-only",
                    "--skip-git-repo-check",
                    "--color",
                    "never",
                    "--cd",
                    dir,
                    "--model",
                    model,
                    "--config",
                    `model_reasoning_effort="${options.reasoningEffort ?? "medium"}"`,
                    "--image",
                    imagePath,
                    "--output-schema",
                    schemaPath,
                    "--output-last-message",
                    outPath,
                    "--",
                    prompt,
                ];
                await run(command, args, { cwd: dir, timeout: options.timeout ?? 180_000, signal });
                let text;
                try {
                    text = await readFile(outPath, "utf8");
                }
                catch {
                    throw new Error("Codex finished without writing an answer.");
                }
                return { answer: parseJson(text, "Codex"), model };
            }
            finally {
                await rm(dir, { recursive: true, force: true });
            }
        },
    };
}
function run(command, args, options) {
    return new Promise((resolve, reject) => {
        const child = execFile(command, args, {
            cwd: options.cwd,
            timeout: options.timeout,
            maxBuffer: 16 * 1024 * 1024,
            ...(options.signal ? { signal: options.signal } : {}),
        }, (error, _stdout, stderr) => {
            if (!error)
                return resolve();
            const code = error.code;
            if (code === "ENOENT")
                return reject(new Error(`\`${command}\` is not installed or not on PATH.`));
            const tail = String(stderr).trim().split("\n").slice(-3).join(" ");
            reject(new Error(`\`${command} exec\` failed${tail ? `: ${tail}` : ` (${error.message})`}`, { cause: error }));
        });
        // Codex reads a prompt from stdin when it is piped; give it none.
        child.stdin?.end();
    });
}
/** OpenRouter's OpenAI-compatible chat completions, with the image as a data URL and a strict JSON schema. */
export function openRouterProvider(options = {}) {
    return {
        name: "openrouter",
        async describe({ image, prompt, schema, signal }) {
            const apiKey = options.apiKey ?? process.env.OPENROUTER_API_KEY;
            if (!apiKey)
                throw new Error("`OPENROUTER_API_KEY` is not set.");
            const model = options.model ?? (process.env.OPENROUTER_MODEL || OPENROUTER_DEFAULT_MODEL);
            const dataUrl = `data:${image.mediaType};base64,${Buffer.from(image.bytes).toString("base64")}`;
            const response = await (options.fetch ?? fetch)(OPENROUTER_URL, {
                method: "POST",
                headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
                body: JSON.stringify({
                    model,
                    messages: [
                        {
                            role: "user",
                            content: [
                                { type: "text", text: prompt },
                                { type: "image_url", image_url: { url: dataUrl } },
                            ],
                        },
                    ],
                    response_format: {
                        type: "json_schema",
                        json_schema: { name: "design_description", strict: true, schema },
                    },
                }),
                ...(signal ? { signal } : {}),
            });
            if (!response.ok) {
                const body = (await response.text()).slice(0, 300);
                throw new Error(`OpenRouter returned ${response.status}${body ? `: ${body}` : ""}`);
            }
            const json = (await response.json());
            const content = json.choices?.[0]?.message?.content;
            if (typeof content !== "string")
                throw new Error("OpenRouter returned no message content.");
            return { answer: parseJson(content, "OpenRouter"), model: json.model ?? model };
        },
    };
}
function parseJson(text, from) {
    // Tolerate a fenced block, which some models add despite the schema.
    const body = text.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/, "$1");
    try {
        return JSON.parse(body);
    }
    catch {
        throw new TypeError(`${from} answer is not JSON: ${body.slice(0, 120)}`);
    }
}
/** Codex first, then OpenRouter when `OPENROUTER_API_KEY` is set. */
export function defaultVisionProviders() {
    return process.env.OPENROUTER_API_KEY ? [codexProvider(), openRouterProvider()] : [codexProvider()];
}
// ---------------------------------------------------------------------------
// Errors
/** Every provider failed or none was available. `failures` holds each provider's error, in order tried. */
export class VisionUnavailableError extends Error {
    failures;
    constructor(failures) {
        const tried = failures.map((f) => `- ${f.provider}: ${f.error.message}`).join("\n");
        super("No vision provider could describe the design.\n" +
            (tried ? `${tried}\n` : "") +
            "Enable one: sign in to the Codex CLI with `codex login`, or set `OPENROUTER_API_KEY` " +
            "(and optionally `OPENROUTER_MODEL`).");
        this.name = "VisionUnavailableError";
        this.failures = failures;
    }
}
/** Ask each provider in turn until one gives a valid answer. */
export async function askVision(providers, request, palette) {
    const failures = [];
    for (const provider of providers) {
        request.signal?.throwIfAborted();
        try {
            const { answer, model } = await provider.describe(request);
            return { ...validateAnswer(answer, palette), provider: provider.name, model };
        }
        catch (error) {
            if (request.signal?.aborted)
                throw error;
            failures.push({ provider: provider.name, error: error instanceof Error ? error : new Error(String(error)) });
        }
    }
    throw new VisionUnavailableError(failures);
}
/** Keyed on the file hash and exact prompt, including rounded palette shares. */
export function descriptionCachePath(dir, hash, prompt) {
    const key = createHash("sha256")
        .update(JSON.stringify({ version: DESCRIPTION_VERSION, prompt }))
        .digest("hex")
        .slice(0, 12);
    return join(dir, `${hash}.description.${key}.json`);
}
export async function readDescriptionCache(path, prompt) {
    try {
        const entry = JSON.parse(await readFile(path, "utf8"));
        return entry.version === DESCRIPTION_VERSION && entry.prompt === prompt ? entry.description : undefined;
    }
    catch {
        return undefined;
    }
}
export async function writeDescriptionCache(dir, path, prompt, description) {
    await mkdir(dir, { recursive: true });
    const entry = {
        version: DESCRIPTION_VERSION,
        prompt,
        description,
    };
    const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temp, `${JSON.stringify(entry, null, 2)}\n`);
    await rename(temp, path);
}
//# sourceMappingURL=describe.js.map