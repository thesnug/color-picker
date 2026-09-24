/**
 * The MCP tools. Each wraps the CLI command of the same job, so the server and
 * the CLI return the same results: the command's JSON, plus the rendered card
 * as `svg` and a `resultId` that `render_card` can render again as SVG or HTML.
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
export declare class ResultStore {
    private readonly limit;
    private readonly views;
    private next;
    constructor(limit?: number);
    add(view: View): string;
    get(id: string): View | undefined;
}
/** Every tool the server exposes, bound to one result store. */
export declare function toolDefinitions(store?: ResultStore): ToolDefinition[];
/**
 * Jev judgments arrive in later issues (INT-2268 for mood, INT-2270 for
 * vetting). Until then a tool asked for one returns its deterministic result
 * and says why the judgment was skipped. The key is checked for presence only.
 */
export declare function jevStatus(option: "mood" | "vet"): JevStatus;
//# sourceMappingURL=tools.d.ts.map