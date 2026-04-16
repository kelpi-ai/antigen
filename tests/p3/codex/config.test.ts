import { describe, it, expect } from "vitest";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { writeCodexConfig } from "../../../src/p3/codex/config";

describe("writeCodexConfig", () => {
  it("writes a run-scoped config with chrome-devtools wsEndpoint", async () => {
    const root = await mkdtemp(join(tmpdir(), "p3-codex-config-"));
    const configPath = await writeCodexConfig({
      codexDir: join(root, ".codex"),
      wsEndpoint: "ws://127.0.0.1:9222/devtools/browser/test",
    });

    const text = await readFile(configPath, "utf8");
    expect(text).toContain("[mcp_servers.chrome-devtools]");
    expect(text).toContain("--wsEndpoint=ws://127.0.0.1:9222/devtools/browser/test");
  });
});
