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
/** One thing the design depicts and the palette color that paints it. */
export interface DescribedElement {
    /** What it is, in a few words ("strawberry body", "title text"). */
    name: string;
    /** Its color in plain words ("deep red"). */
    color: string;
    /** The fingerprint palette color that paints it, lowercase hex. */
    hex: string;
}
export interface DesignDescription {
    /** What the design depicts, in one line. */
    subject: string;
    /** Its mood and style, in one line. */
    mood: string;
    /** Named elements, each tied to a palette color. */
    elements: DescribedElement[];
    /** Which provider answered. */
    provider: VisionProviderName;
    /** The model that answered. */
    model: string;
}
/** The model's answer before provenance is added. */
export type DescriptionAnswer = Pick<DesignDescription, "subject" | "mood" | "elements">;
export type VisionProviderName = "codex" | "openrouter";
/** An image to describe. */
export interface VisionImage {
    bytes: Uint8Array;
    mediaType: "image/png" | "image/jpeg" | "image/webp";
}
export interface VisionRequest {
    image: VisionImage;
    prompt: string;
    /** JSON Schema the answer must match. */
    schema: object;
    signal?: AbortSignal;
}
/** A vision-capable model behind one transport. */
export interface VisionProvider {
    name: VisionProviderName;
    /** Returns the raw answer, parsed from JSON but not yet validated. */
    describe(request: VisionRequest): Promise<{
        answer: unknown;
        model: string;
    }>;
}
/** Bump when the prompt or schema changes, to invalidate cached descriptions. */
export declare const DESCRIPTION_VERSION = 1;
/** Default model for both providers, so a description reads the same whichever answered. */
export declare const CODEX_DEFAULT_MODEL = "gpt-6-sol";
export declare const OPENROUTER_DEFAULT_MODEL = "openai/gpt-6-sol";
/** The fixed prompt, with the design's palette listed so each element names one of its colors. */
export declare function describePrompt(palette: readonly {
    hex: string;
    share: number;
}[]): string;
/** JSON Schema for the answer. Strict-mode compatible: every property required, no extras. */
export declare function descriptionSchema(palette: readonly {
    hex: string;
}[]): object;
/**
 * Check an answer against the schema. A hex that is not in the palette, which
 * a provider without strict schemas can return, is snapped to the nearest
 * palette color.
 *
 * @throws {TypeError} naming the first field that does not match.
 */
export declare function validateAnswer(answer: unknown, palette: readonly {
    hex: string;
}[]): DescriptionAnswer;
/**
 * The palette with each color's `element` set from the description: the names
 * of the elements it paints, joined with "and", in the order the model listed
 * them. Colors no element names are returned unchanged.
 */
export declare function labelPalette<P extends {
    hex: string;
}>(palette: readonly P[], description: Pick<DesignDescription, "elements">): (P & {
    element?: string;
})[];
export declare function sniffMediaType(bytes: Uint8Array): VisionImage["mediaType"];
export interface CodexProviderOptions {
    /** The executable. Default `codex` on `PATH`. */
    command?: string;
    /** Default `CODEX_DEFAULT_MODEL`. */
    model?: string;
    /** Codex reasoning effort. Default `"medium"`: enough to read an image, without the user's own setting. */
    reasoningEffort?: string;
    /** Milliseconds before the process is killed. Default 180000. */
    timeout?: number;
}
/**
 * The Codex CLI, run non-interactively on the machine's existing login (a
 * ChatGPT subscription or its own key); this package handles no credential.
 * It runs in a scratch directory with a read-only sandbox, ignores the user's
 * `config.toml` so their hooks and MCP servers do not start, and leaves no
 * session behind.
 */
export declare function codexProvider(options?: CodexProviderOptions): VisionProvider;
export interface OpenRouterProviderOptions {
    /** Default `OPENROUTER_API_KEY` from the environment. */
    apiKey?: string;
    /** Default `OPENROUTER_MODEL` from the environment, then `OPENROUTER_DEFAULT_MODEL`. */
    model?: string;
    /** Replaces the global `fetch`, as tests do. */
    fetch?: typeof fetch;
}
/** OpenRouter's OpenAI-compatible chat completions, with the image as a data URL and a strict JSON schema. */
export declare function openRouterProvider(options?: OpenRouterProviderOptions): VisionProvider;
/** Codex first, then OpenRouter when `OPENROUTER_API_KEY` is set. */
export declare function defaultVisionProviders(): VisionProvider[];
/** Every provider failed or none was available. `failures` holds each provider's error, in order tried. */
export declare class VisionUnavailableError extends Error {
    readonly failures: {
        provider: VisionProviderName;
        error: Error;
    }[];
    constructor(failures: {
        provider: VisionProviderName;
        error: Error;
    }[]);
}
/** Ask each provider in turn until one gives a valid answer. */
export declare function askVision(providers: readonly VisionProvider[], request: VisionRequest, palette: readonly {
    hex: string;
}[]): Promise<DesignDescription>;
/** Keyed on the file hash and exact prompt, including rounded palette shares. */
export declare function descriptionCachePath(dir: string, hash: string, prompt: string): string;
export declare function readDescriptionCache(path: string, prompt: string): Promise<DesignDescription | undefined>;
export declare function writeDescriptionCache(dir: string, path: string, prompt: string, description: DesignDescription): Promise<void>;
//# sourceMappingURL=describe.d.ts.map