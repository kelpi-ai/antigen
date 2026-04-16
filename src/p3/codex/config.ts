import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function writeCodexConfig(input: {
  codexDir: string;
  wsEndpoint: string;
}): Promise<string> {
  await mkdir(input.codexDir, { recursive: true });
  const configPath = join(input.codexDir, "config.toml");
  const text = `[mcp_servers.chrome-devtools]
command = "npx"
args = ["chrome-devtools-mcp@latest", "--wsEndpoint=${input.wsEndpoint}"]
`;
  await writeFile(configPath, text);
  return configPath;
}
