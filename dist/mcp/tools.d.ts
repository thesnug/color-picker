/**
 * The MCP tools. Each wraps the CLI command of the same job, so the server and
 * the CLI return the same results: the command's JSON, plus the rendered card
 * as `svg` and a `resultId` that `render_card` can render again as SVG or HTML.
 * The card is also written to `cardFile` with its garment photos inlined, since
 * a host that shows an SVG file as an image cannot fetch the photo URLs.
 *
 * Loaded only by `createServer`, after the MCP SDK, so its `zod` import (a peer
 * dependency of the SDK) is never reached by consumers of the core.
 */
import { z } from "zod";
import { type View } from "../cli/commands.js";
/** How many results `render_card` can reach back to. Older ones are dropped. */
export declare const RESULT_HISTORY = 50;
/** A tool's reply: one text block holding JSON, as the MCP SDK expects. */
export interface ToolReply {
    [key: string]: unknown;
    content: {
        type: "text";
        text: string;
    }[];
    isError?: boolean;
}
/** A tool as registered with `McpServer.registerTool`. */
export interface ToolDefinition {
    name: string;
    description: string;
    inputSchema: z.ZodRawShape;
    handler: (args: Record<string, unknown>) => Promise<ToolReply>;
}
/** Views kept for `render_card`, by result ID, oldest first. */
export declare class ResultStore {
    private readonly limit;
    private readonly views;
    private next;
    constructor(limit?: number);
    add(view: View): string;
    get(id: string): View | undefined;
}
/** Environment variable naming the directory card files are written to. */
export declare const CARD_DIR_ENV = "COLOR_PICKER_CARD_DIR";
export interface ToolOptions {
    /** Directory for card files. Defaults to `$COLOR_PICKER_CARD_DIR`, else a new temporary directory. */
    cardDir?: string;
    /** Inline the garment photos in a card. Defaults to `embedImages`. */
    embedImages?: (markup: string) => Promise<string>;
}
/** Every tool the server exposes, bound to one result store. */
export declare function toolDefinitions(store?: ResultStore, options?: ToolOptions): ToolDefinition[];
//# sourceMappingURL=tools.d.ts.map