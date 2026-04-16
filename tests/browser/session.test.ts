import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";

const spawnMock = vi.fn();
const fetchMock = vi.fn();
vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

import { launchChromeSession } from "../../src/browser/session";

describe("launchChromeSession", () => {
  beforeEach(() => {
    spawnMock.mockReset();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("spawns chrome with remote debugging and isolated profile args", async () => {
    const proc = new EventEmitter() as unknown as ChildProcess;
    spawnMock.mockReturnValue(proc);
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/browser/test" }),
    });

    await launchChromeSession({
      chromePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      userDataDir: "/tmp/run-profile",
      debuggingPort: 9222,
    });

    expect(spawnMock).toHaveBeenCalledWith(
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      expect.arrayContaining([
        "--remote-debugging-port=9222",
        "--user-data-dir=/tmp/run-profile",
        "--no-first-run",
        "--no-default-browser-check",
        "about:blank",
      ]),
      expect.any(Object),
    );
  });

  it("returns the websocket endpoint from /json/version after polling", async () => {
    vi.useFakeTimers();
    const proc = new EventEmitter() as unknown as ChildProcess;
    spawnMock.mockReturnValue(proc);
    fetchMock
      .mockRejectedValueOnce(new Error("connection refused"))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/browser/real-id" }),
      });

    const sessionPromise = launchChromeSession({
      chromePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      userDataDir: "/tmp/run-profile",
      debuggingPort: 9222,
    });

    await vi.advanceTimersByTimeAsync(100);
    const session = await sessionPromise;

    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:9222/json/version");
    expect(session.wsEndpoint).toBe("ws://127.0.0.1:9222/devtools/browser/real-id");
  });
});
