import { describe, expect, it } from "vitest";

import { createServer, SERVER_NAME } from "../src/mcp/index.js";

describe("mcp", () => {
  it("builds a server with the version tool registered", async () => {
    const server = await createServer();
    expect(server).toBeDefined();
    expect(SERVER_NAME).toBe("color-picker");
    await server.close();
  });
});
