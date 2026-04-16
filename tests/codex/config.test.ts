import { describe, it, expect } from "vitest";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { writeCodexConfig } from "../../src/codex/config";

describe("writeCodexConfig", () => {
  it("writes a project-scoped config with chrome-devtools wsEndpoint", async () => {
    const root = await mkdtemp(join(tmpdir(), "codex-config-"));
    const codexDir = join(root, ".codex");
    const configPath = await writeCodexConfig({
      codexDir: join(root, ".codex"),
      wsEndpoint: "ws://127.0.0.1:9222/devtools/browser/test",
    });

    const text = await readFile(configPath, "utf8");
    expect(configPath).toBe(join(codexDir, "config.toml"));
    expect(text).toBe(
      `[mcp_servers.chrome-devtools]
command = "npx"
args = ["chrome-devtools-mcp@latest", "--wsEndpoint=ws://127.0.0.1:9222/devtools/browser/test"]
`,
    );
  });

  it("writes a project-scoped config with chrome-devtools autoConnect", async () => {
    const root = await mkdtemp(join(tmpdir(), "codex-config-"));
    const codexDir = join(root, ".codex");
    const configPath = await writeCodexConfig({
      codexDir,
      autoConnect: true,
    });

    const text = await readFile(configPath, "utf8");
    expect(configPath).toBe(join(codexDir, "config.toml"));
    expect(text).toBe(
      `[mcp_servers.chrome-devtools]
command = "npx"
args = ["chrome-devtools-mcp@latest", "--autoConnect"]
`,
    );
  });
});
