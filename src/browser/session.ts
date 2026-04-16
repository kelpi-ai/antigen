import { spawn } from "node:child_process";

const WS_ENDPOINT_TIMEOUT_MS = 5000;
const WS_ENDPOINT_POLL_INTERVAL_MS = 50;

export interface ChromeSession {
  process: ReturnType<typeof spawn>;
  debuggingPort: number;
  wsEndpoint: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function resolveWebSocketEndpoint(input: {
  debuggingPort: number;
  process: ReturnType<typeof spawn>;
}): Promise<string> {
  const endpointUrl = `http://127.0.0.1:${input.debuggingPort}/json/version`;
  const deadline = Date.now() + WS_ENDPOINT_TIMEOUT_MS;

  while (Date.now() < deadline) {
    if (input.process.exitCode !== null && input.process.exitCode !== undefined) {
      throw new Error("chrome exited before remote debugging endpoint became available");
    }

    try {
      const response = await fetch(endpointUrl);
      if (response.ok) {
        const body = (await response.json()) as { webSocketDebuggerUrl?: unknown };
        if (typeof body.webSocketDebuggerUrl === "string" && body.webSocketDebuggerUrl.length > 0) {
          return body.webSocketDebuggerUrl;
        }
      }
    } catch {
      // Chrome may not have started the debugger endpoint yet.
    }

    await sleep(WS_ENDPOINT_POLL_INTERVAL_MS);
  }

  throw new Error(`timed out waiting for Chrome debugger endpoint at ${endpointUrl}`);
}

export async function launchChromeSession(input: {
  chromePath: string;
  userDataDir: string;
  debuggingPort: number;
}): Promise<ChromeSession> {
  const proc = spawn(
    input.chromePath,
    [
      `--remote-debugging-port=${input.debuggingPort}`,
      `--user-data-dir=${input.userDataDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "about:blank",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );

  const wsEndpoint = await resolveWebSocketEndpoint({
    debuggingPort: input.debuggingPort,
    process: proc,
  });

  return {
    process: proc,
    debuggingPort: input.debuggingPort,
    wsEndpoint,
  };
}
