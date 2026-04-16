import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import type { Readable } from "node:stream";

const { spawnMock, accessMock, symlinkMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
  accessMock: vi.fn(),
  symlinkMock: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

vi.mock("node:fs/promises", () => ({
  access: (...args: unknown[]) => accessMock(...args),
  symlink: (...args: unknown[]) => symlinkMock(...args),
}));

import { createWorktree, removeWorktree } from "../../src/git/worktree";

type FakeProc = ChildProcess & {
  stdout: Readable;
  stderr: Readable;
};

function fakeProc(opts: { stdout?: string; stderr?: string; exitCode: number | null }) {
  const proc = new EventEmitter() as FakeProc;
  proc.stdout = new EventEmitter() as Readable;
  proc.stderr = new EventEmitter() as Readable;

  setImmediate(() => {
    if (opts.stdout) {
      proc.stdout.emit("data", Buffer.from(opts.stdout));
    }
    if (opts.stderr) {
      proc.stderr.emit("data", Buffer.from(opts.stderr));
    }
    proc.emit("close", opts.exitCode);
  });

  return proc;
}

describe("worktree helpers", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    spawnMock.mockReset();
    accessMock.mockReset();
    symlinkMock.mockReset();

    process.env.INNGEST_EVENT_KEY = "event-key";
    process.env.INNGEST_SIGNING_KEY = "signing-key";
    process.env.OPENAI_API_KEY = "sk-openai";
    process.env.TARGET_APP_URL = "https://app.internal";
    process.env.SENTRY_WEBHOOK_SECRET = "sentry-webhook-secret";
    process.env.LINEAR_API_KEY = "linear-api-key";
    process.env.LINEAR_WEBHOOK_SECRET = "linear-webhook-secret";
    process.env.TARGET_REPO_PATH = "/tmp/repo";
    process.env.TARGET_REPO_WORKTREE_ROOT = "/tmp/worktrees";
    process.env.TARGET_REPO_REMOTE = "origin";
    process.env.TARGET_REPO_BASE_BRANCH = "main";
    process.env.ARTIFACTS_DIR = "/tmp/artifacts";
    process.env.CHROME_PATH = "/usr/local/bin/chrome";
    process.env.FFMPEG_BIN = "/usr/local/bin/ffmpeg";
    process.env.PORT = "3000";

    accessMock.mockRejectedValue(Object.assign(new Error("missing"), { code: "ENOENT" }));
    symlinkMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("creates a worktree from refreshed base branch", async () => {
    spawnMock.mockReturnValueOnce(fakeProc({ exitCode: 0 }));

    const result = await createWorktree("BUG-42");

    expect(result.path).toMatch(/^\/tmp\/worktrees\/BUG-42-[0-9a-f]{8}$/);
    const suffix = result.path.split("-").pop();
    expect(result.branch).toBe(`fix/BUG-42-${suffix}`);
    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(spawnMock).toHaveBeenCalledWith(
      "git",
      ["worktree", "add", "-b", result.branch, result.path, "main"],
      expect.objectContaining({ cwd: "/tmp/repo" }),
    );
  });

  it("symlinks node_modules into the new worktree when the parent checkout has dependencies", async () => {
    spawnMock.mockReturnValueOnce(fakeProc({ exitCode: 0 }));
    accessMock
      .mockImplementationOnce(async () => undefined)
      .mockImplementationOnce(async () => {
        throw Object.assign(new Error("missing"), { code: "ENOENT" });
      });

    const result = await createWorktree("BUG-42");

    expect(symlinkMock).toHaveBeenCalledWith(
      "/tmp/repo/node_modules",
      `${result.path}/node_modules`,
      "dir",
    );
  });

  it("removes a worktree with git worktree remove --force", async () => {
    const path = "/tmp/worktrees/BUG-42-1f6e6f00";
    spawnMock.mockReturnValueOnce(fakeProc({ exitCode: 0 }));

    await removeWorktree(path);

    expect(spawnMock).toHaveBeenCalledWith(
      "git",
      ["worktree", "remove", "--force", path],
      expect.objectContaining({ cwd: "/tmp/repo" }),
    );
  });

  it("surfaces git add errors", async () => {
    spawnMock.mockReturnValueOnce(
      fakeProc({ exitCode: 1, stderr: "fatal: invalid reference: refs/heads/missing" }),
    );

    await expect(createWorktree("BUG-42")).rejects.toThrow(/git worktree add.*invalid reference/);
  });

  it("wraps spawn failures with command context", async () => {
    const spawnError = new Error("spawn failed");
    spawnMock.mockImplementationOnce(() => {
      throw spawnError;
    });

    await expect(createWorktree("BUG-42")).rejects.toThrow(/git worktree add -b fix\/BUG-42-[0-9a-f]{8} .*spawn failed/);
  });
});
