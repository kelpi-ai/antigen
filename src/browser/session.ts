import { spawn } from "node:child_process";

const WS_ENDPOINT_TIMEOUT_MS = 5000;
const WS_ENDPOINT_POLL_INTERVAL_MS = 50;
const WS_ENDPOINT_REQUEST_TIMEOUT_MS = 500;

export interface ChromeSession {
  process: ReturnType<typeof spawn> | null;
  ownsProcess: boolean;
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
  endpointUrl: string;
  process?: ReturnType<typeof spawn>;
}): Promise<string> {
  const deadline = Date.now() + WS_ENDPOINT_TIMEOUT_MS;

  while (Date.now() < deadline) {
    if (
      input.process &&
      input.process.exitCode !== null &&
      input.process.exitCode !== undefined
    ) {
      throw new Error("chrome exited before remote debugging endpoint became available");
    }

    try {
      const requestTimeoutMs = Math.max(
        1,
        Math.min(WS_ENDPOINT_REQUEST_TIMEOUT_MS, deadline - Date.now()),
      );
      const response = await fetchJsonVersionWithTimeout({
        endpointUrl: input.endpointUrl,
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

  throw new Error(`timed out waiting for Chrome debugger endpoint at ${input.endpointUrl}`);
}

export async function launchChromeSession(input: {
  chromePath: string;
  userDataDir: string;
  debuggingPort: number;
  initialUrl?: string;
}): Promise<ChromeSession> {
  const proc = spawn(
    input.chromePath,
    [
      `--remote-debugging-port=${input.debuggingPort}`,
      `--user-data-dir=${input.userDataDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      input.initialUrl ?? "about:blank",
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
        endpointUrl: `http://127.0.0.1:${input.debuggingPort}/json/version`,
        process: proc,
      }),
      startupError,
    ]);

    return {
      process: proc,
      ownsProcess: true,
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

export async function connectChromeSession(input: {
  debuggingUrl: string;
}): Promise<ChromeSession> {
  const url = new URL(input.debuggingUrl);
  const debuggingPort = Number(url.port || (url.protocol === "https:" ? 443 : 80));
  if (!Number.isInteger(debuggingPort) || debuggingPort <= 0) {
    throw new Error(`Invalid Chrome debugging URL: ${input.debuggingUrl}`);
  }

  const versionUrl = new URL("/json/version", url).toString();
  const wsEndpoint = await resolveWebSocketEndpoint({ endpointUrl: versionUrl });

  return {
    process: null,
    ownsProcess: false,
    debuggingPort,
    wsEndpoint,
  };
}
