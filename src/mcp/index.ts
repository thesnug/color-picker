/**
 * `color-picker-mcp` server.
 *
 * The MCP SDK is an optional peer dependency so consumers importing only the
 * core never install it. It is loaded lazily here and a clear error is raised
 * when it is missing. Tools arrive in later issues; the scaffold registers one
 * tool that reports the package version so the server can be smoke-tested.
 */

import { packageVersion } from "../cli/index.js";

export const SERVER_NAME = "color-picker";

type McpServerModule = typeof import("@modelcontextprotocol/sdk/server/mcp.js");
type StdioModule = typeof import("@modelcontextprotocol/sdk/server/stdio.js");

async function loadSdk(): Promise<{ mcp: McpServerModule; stdio: StdioModule }> {
  try {
    const [mcp, stdio] = await Promise.all([
      import("@modelcontextprotocol/sdk/server/mcp.js"),
      import("@modelcontextprotocol/sdk/server/stdio.js"),
    ]);
    return { mcp, stdio };
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
  const { mcp } = await loadSdk();
  const server = new mcp.McpServer({ name: SERVER_NAME, version: packageVersion() });

  server.registerTool(
    "color_picker_version",
    { description: "Report the installed @thesnug/color-picker version." },
    async () => ({ content: [{ type: "text", text: packageVersion() }] }),
  );

  return server;
}

/** Start the server on stdio. Resolves once the transport is connected. */
export async function serveStdio(): Promise<void> {
  const { stdio } = await loadSdk();
  const server = await createServer();
  await server.connect(new stdio.StdioServerTransport());
}
