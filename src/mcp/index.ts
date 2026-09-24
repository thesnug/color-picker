/**
 * `color-picker-mcp` server: the library as MCP tools over stdio. See
 * docs/DESIGN.md, "Architecture", and ./tools.ts for the tools.
 *
 * The MCP SDK is an optional peer dependency so consumers importing only the
 * core never install it. It and the tools, which import the SDK's `zod` peer,
 * are loaded lazily here, and a clear error is raised when the SDK is missing.
 */

import { packageVersion } from "../cli/index.js";

export const SERVER_NAME = "color-picker";

type McpServerModule = typeof import("@modelcontextprotocol/sdk/server/mcp.js");
type StdioModule = typeof import("@modelcontextprotocol/sdk/server/stdio.js");
type ToolsModule = typeof import("./tools.js");

async function loadSdk(): Promise<{ mcp: McpServerModule; stdio: StdioModule; tools: ToolsModule }> {
  try {
    const [mcp, stdio, tools] = await Promise.all([
      import("@modelcontextprotocol/sdk/server/mcp.js"),
      import("@modelcontextprotocol/sdk/server/stdio.js"),
      import("./tools.js"),
    ]);
    return { mcp, stdio, tools };
  } catch (error) {
    throw new Error(
      "color-picker-mcp needs the optional peer dependency @modelcontextprotocol/sdk. " +
        "Install it next to @thesnug/color-picker to run the MCP server.",
      { cause: error },
    );
  }
}

/** Build the MCP server with its tools registered, without connecting a transport. */
export async function createServer(): Promise<InstanceType<McpServerModule["McpServer"]>> {
  const { mcp, tools } = await loadSdk();
  const server = new mcp.McpServer({ name: SERVER_NAME, version: packageVersion() });

  for (const tool of tools.toolDefinitions()) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.inputSchema },
      (args: Record<string, unknown>) => tool.handler(args),
    );
  }
  return server;
}

/** Start the server on stdio. Resolves once the transport is connected. */
export async function serveStdio(): Promise<void> {
  const { stdio } = await loadSdk();
  const server = await createServer();
  await server.connect(new stdio.StdioServerTransport());
}
