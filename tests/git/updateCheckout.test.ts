import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";

const spawnMock = vi.fn();
vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

import { refreshPersistentCheckout } from "../../src/git/updateCheckout";

function fakeProc(opts: { stdout?: string; stderr?: string; exitCode: number | null }) {
  const proc = new EventEmitter() as unknown as ChildProcess & {
    stdout: EventEmitter;
    stderr: EventEmitter;
  };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();

  setImmediate(() => {
    if (opts.stdout) proc.stdout.emit("data", Buffer.from(opts.stdout));
    if (opts.stderr) proc.stderr.emit("data", Buffer.from(opts.stderr));
    proc.emit("close", opts.exitCode);
  });

  return proc;
}

describe("updateCheckout", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    spawnMock.mockReset();

    process.env.INNGEST_EVENT_KEY = "event-key";
    process.env.INNGEST_SIGNING_KEY = "signing-key";
    process.env.OPENAI_API_KEY = "sk-openai";
    process.env.TARGET_APP_URL = "https://app.internal";
    process.env.SENTRY_WEBHOOK_SECRET = "sentry-webhook-secret";
    process.env.LINEAR_API_KEY = "linear-api-key";
    process.env.LINEAR_WEBHOOK_SECRET = "linear-webhook-secret";
    process.env.TARGET_REPO_PATH = "/tmp/target-repo";
    process.env.TARGET_REPO_WORKTREE_ROOT = "/tmp/worktrees";
    process.env.TARGET_REPO_REMOTE = "origin";
    process.env.TARGET_REPO_BASE_BRANCH = "main";
    process.env.ARTIFACTS_DIR = "/tmp/artifacts";
    process.env.CHROME_PATH = "/usr/bin/chrome";
    process.env.FFMPEG_BIN = "/usr/bin/ffmpeg";
    process.env.PORT = "3001";
  });

  it("refreshes checkout with expected git commands", async () => {
    spawnMock
      .mockReturnValueOnce(fakeProc({ exitCode: 0 }))
      .mockReturnValueOnce(fakeProc({ exitCode: 0 }))
      .mockReturnValueOnce(fakeProc({ exitCode: 0 }));

    await refreshPersistentCheckout();

    expect(spawnMock).toHaveBeenCalledTimes(3);
    expect(spawnMock).toHaveBeenNthCalledWith(
      1,
      "git",
      ["rev-parse", "--is-inside-work-tree"],
      expect.objectContaining({ cwd: "/tmp/target-repo" }),
    );
    expect(spawnMock).toHaveBeenNthCalledWith(
      2,
      "git",
      ["fetch", "origin"],
      expect.objectContaining({ cwd: "/tmp/target-repo" }),
    );
    expect(spawnMock).toHaveBeenNthCalledWith(
      3,
      "git",
      ["pull", "--ff-only", "origin", "main"],
      expect.objectContaining({ cwd: "/tmp/target-repo" }),
    );
  });

  it("throws when checkout is not a git repository", async () => {
    spawnMock.mockReturnValueOnce(
      fakeProc({ exitCode: 1, stderr: "fatal: not a git repository (or any of the parent directories): .git" }),
    );

    await expect(refreshPersistentCheckout()).rejects.toThrow(
      /git rev-parse --is-inside-work-tree.*not a git repository/,
    );
    expect(spawnMock).toHaveBeenCalledTimes(1);
  });

  it("throws when fetch fails", async () => {
    spawnMock
      .mockReturnValueOnce(fakeProc({ exitCode: 0 }))
      .mockReturnValueOnce(
        fakeProc({ exitCode: 1, stderr: "fatal: no remote 'origin' specified" }),
      );

    await expect(refreshPersistentCheckout()).rejects.toThrow(
      /git fetch origin.*no remote/,
    );
    expect(spawnMock).toHaveBeenCalledTimes(2);
  });
});
