import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";

const spawnMock = vi.fn();
const fetchMock = vi.fn();
vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

import { launchChromeSession } from "../../src/browser/session";

function fakeProcess(): ChildProcess & EventEmitter {
  const proc = new EventEmitter() as ChildProcess & EventEmitter;
  proc.kill = vi.fn() as unknown as ChildProcess["kill"];
  return proc;
}

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
    const proc = fakeProcess();
    spawnMock.mockReturnValue(proc);
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/browser/test" }),
    });

    const session = await launchChromeSession({
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
    expect(session).toEqual({
      process: proc,
      debuggingPort: 9222,
      wsEndpoint: "ws://127.0.0.1:9222/devtools/browser/test",
    });
  });

  it("returns the websocket endpoint from /json/version after polling", async () => {
    vi.useFakeTimers();
    const proc = fakeProcess();
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

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:9222/json/version",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(session.wsEndpoint).toBe("ws://127.0.0.1:9222/devtools/browser/real-id");
  });

  it("rejects cleanly and kills chrome when process emits startup error", async () => {
    const proc = fakeProcess();
    spawnMock.mockReturnValue(proc);
    fetchMock.mockImplementation(() => new Promise(() => {}));

    const sessionPromise = launchChromeSession({
      chromePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      userDataDir: "/tmp/run-profile",
      debuggingPort: 9222,
    });

    expect(() => proc.emit("error", new Error("spawn failed"))).not.toThrow();
    await expect(sessionPromise).rejects.toThrow(/spawn failed/);
    expect(proc.kill).toHaveBeenCalledWith("SIGKILL");
  });

  it("kills chrome and rejects when debugger endpoint never becomes available", async () => {
    vi.useFakeTimers();
    const proc = fakeProcess();
    spawnMock.mockReturnValue(proc);
    fetchMock.mockRejectedValue(new Error("connection refused"));

    const sessionPromise = launchChromeSession({
      chromePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      userDataDir: "/tmp/run-profile",
      debuggingPort: 9222,
    });

    const rejection = expect(sessionPromise).rejects.toThrow(
      /timed out waiting for Chrome debugger endpoint/,
    );
    await vi.advanceTimersByTimeAsync(5200);
    await rejection;
    expect(proc.kill).toHaveBeenCalledWith("SIGKILL");
  });

  it("bounds each poll request with an abort signal", async () => {
    vi.useFakeTimers();
    const proc = fakeProcess();
    spawnMock.mockReturnValue(proc);
    fetchMock.mockImplementation((_url: string, init?: RequestInit) => {
      const signal = init?.signal;
      if (signal) {
        return new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        });
      }
      return new Promise(() => {});
    });

    const sessionPromise = launchChromeSession({
      chromePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      userDataDir: "/tmp/run-profile",
      debuggingPort: 9222,
    });
    const rejection = expect(sessionPromise).rejects.toThrow(
      /timed out waiting for Chrome debugger endpoint/,
    );

    await vi.advanceTimersByTimeAsync(800);
    expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    await vi.advanceTimersByTimeAsync(5200);
    await rejection;
  });
});
