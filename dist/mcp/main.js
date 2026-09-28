#!/usr/bin/env node
import { serveStdio } from "./index.js";
serveStdio().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
});
//# sourceMappingURL=main.js.map