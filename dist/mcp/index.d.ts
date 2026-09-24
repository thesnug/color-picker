/**
 * `color-picker-mcp` server: the library as MCP tools over stdio. See
 * docs/DESIGN.md, "Architecture", and ./tools.ts for the tools.
 *
 * The MCP SDK is an optional peer dependency so consumers importing only the
 * core never install it. It and the tools, which import the SDK's `zod` peer,
 * are loaded lazily here, and a clear error is raised when the SDK is missing.
 */
export declare const SERVER_NAME = "color-picker";
type McpServerModule = typeof import("@modelcontextprotocol/sdk/server/mcp.js");
/** Build the MCP server with its tools registered, without connecting a transport. */
export declare function createServer(): Promise<InstanceType<McpServerModule["McpServer"]>>;
/** Start the server on stdio. Resolves once the transport is connected. */
export declare function serveStdio(): Promise<void>;
export {};
//# sourceMappingURL=index.d.ts.map