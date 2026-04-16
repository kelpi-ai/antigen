import { spawn } from "node:child_process";
import { createServer } from "node:net";

export interface ChromeSession {
  process: ReturnType<typeof spawn>;
  debuggingPort: number;
  wsEndpoint: string;
}

export async function getAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Could not allocate a debugging port"));
        return;
      }
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(address.port);
      });
    });
    server.on("error", reject);
  });
}

export async function resolveWsEndpoint(port: number): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) {
        const payload = (await response.json()) as {
          webSocketDebuggerUrl?: string;
        };
        if (payload.webSocketDebuggerUrl) {
          return payload.webSocketDebuggerUrl;
        }
      }
    } catch {
      // Ignore transient startup failures while waiting for Chrome to expose DevTools.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`Chrome DevTools endpoint did not appear on port ${port}`);
}

export async function launchChromeSession(input: {
  chromePath: string;
  userDataDir: string;
  debuggingPort?: number;
}): Promise<ChromeSession> {
  const debuggingPort = input.debuggingPort ?? (await getAvailablePort());
  const process = spawn(
    input.chromePath,
    [
      `--remote-debugging-port=${debuggingPort}`,
      `--user-data-dir=${input.userDataDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "about:blank",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );

  try {
    const wsEndpoint = await resolveWsEndpoint(debuggingPort);
    return {
      process,
      debuggingPort,
      wsEndpoint,
    };
  } catch (error) {
    try {
      process.kill();
    } catch {
      // Preserve the original bootstrap error.
    }
    throw error;
  }
}
