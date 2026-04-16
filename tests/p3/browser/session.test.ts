import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";

const spawnMock = vi.fn();
vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

import { launchChromeSession, resolveWsEndpoint } from "../../../src/p3/browser/session";

describe("launchChromeSession", () => {
  beforeEach(() => {
    spawnMock.mockReset();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          webSocketDebuggerUrl: "ws://127.0.0.1:9333/devtools/browser/test",
        }),
      }),
    );
  });

  it("spawns chrome with remote debugging and an isolated profile", async () => {
    const proc = new EventEmitter() as unknown as ChildProcess;
    spawnMock.mockReturnValue(proc);

    const session = await launchChromeSession({
      chromePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      userDataDir: "/tmp/run-profile",
      debuggingPort: 9333,
    });

    expect(spawnMock).toHaveBeenCalledWith(
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      expect.arrayContaining([
        "--remote-debugging-port=9333",
        "--user-data-dir=/tmp/run-profile",
        "--no-first-run",
        "--no-default-browser-check",
        "about:blank",
      ]),
      expect.any(Object),
    );
    expect(session.wsEndpoint).toBe(
      "ws://127.0.0.1:9333/devtools/browser/test",
    );
  });

  it("resolves websocket endpoint when transient fetch failures occur", async () => {
    const proc = new EventEmitter() as unknown as ChildProcess;
    spawnMock.mockReturnValue(proc);

    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("ECONNREFUSED"))
      .mockResolvedValue({
        ok: true,
        json: async () => ({
          webSocketDebuggerUrl: "ws://127.0.0.1:9333/devtools/browser/test",
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const session = await launchChromeSession({
      chromePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      userDataDir: "/tmp/run-profile",
      debuggingPort: 9333,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(session.wsEndpoint).toBe(
      "ws://127.0.0.1:9333/devtools/browser/test",
    );
  });

  it("resolveWsEndpoint retries on fetch errors before succeeding", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("ECONNREFUSED"))
      .mockResolvedValue({
        ok: true,
        json: async () => ({
          webSocketDebuggerUrl: "ws://127.0.0.1:9444/devtools/browser/indirect-test",
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const endpoint = await resolveWsEndpoint(9444);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(endpoint).toBe("ws://127.0.0.1:9444/devtools/browser/indirect-test");
  });
});
