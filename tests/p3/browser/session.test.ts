import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";

const spawnMock = vi.fn();
vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

import { launchChromeSession } from "../../../src/p3/browser/session";

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
});
