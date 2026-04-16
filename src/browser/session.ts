import { spawn } from "node:child_process";

const WS_ENDPOINT_TIMEOUT_MS = 5000;
const WS_ENDPOINT_POLL_INTERVAL_MS = 50;
const WS_ENDPOINT_REQUEST_TIMEOUT_MS = 500;

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

function killChromeProcess(proc: ReturnType<typeof spawn>): void {
  try {
    proc.kill("SIGKILL");
  } catch {
    // Ignore cleanup failures (e.g., process already exited).
  }
}

async function fetchJsonVersionWithTimeout(input: {
  endpointUrl: string;
  timeoutMs: number;
}): Promise<Response> {
  const controller = new AbortController();
  const requestTimeout = setTimeout(() => {
    controller.abort();
  }, input.timeoutMs);
  try {
    return await fetch(input.endpointUrl, { signal: controller.signal });
  } finally {
    clearTimeout(requestTimeout);
  }
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
      const requestTimeoutMs = Math.max(
        1,
        Math.min(WS_ENDPOINT_REQUEST_TIMEOUT_MS, deadline - Date.now()),
      );
      const response = await fetchJsonVersionWithTimeout({
        endpointUrl,
        timeoutMs: requestTimeoutMs,
      });
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

  let onProcessError: ((error: Error) => void) | undefined;
  const startupError = new Promise<never>((_resolve, reject) => {
    onProcessError = (error: Error) => {
      reject(error);
    };
    proc.once("error", onProcessError);
  });

  try {
    const wsEndpoint = await Promise.race([
      resolveWebSocketEndpoint({
        debuggingPort: input.debuggingPort,
        process: proc,
      }),
      startupError,
    ]);

    return {
      process: proc,
      debuggingPort: input.debuggingPort,
      wsEndpoint,
    };
  } catch (error) {
    killChromeProcess(proc);
    throw error;
  } finally {
    if (onProcessError) {
      proc.off("error", onProcessError);
    }
  }
}
