import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

type CodexConfigInput =
  | {
      codexDir: string;
      wsEndpoint: string;
      autoConnect?: false;
    }
  | {
      codexDir: string;
      autoConnect: true;
      wsEndpoint?: undefined;
    };

export async function writeCodexConfig(input: CodexConfigInput): Promise<string> {
  await mkdir(input.codexDir, { recursive: true });
  const configPath = join(input.codexDir, "config.toml");
  const args =
    input.autoConnect === true
      ? '["chrome-devtools-mcp@latest", "--autoConnect"]'
      : `["chrome-devtools-mcp@latest", "--wsEndpoint=${input.wsEndpoint}"]`;
  const text = `[mcp_servers.chrome-devtools]
command = "npx"
args = ${args}
`;
  await writeFile(configPath, text);
  return configPath;
}
