import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import type { Readable } from "node:stream";

const spawnMock = vi.fn();
vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

import { publishWorktreeFix } from "../../src/git/publish";

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

describe("publishWorktreeFix", () => {
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
    process.env.TARGET_REPO_PATH = "/tmp/repo";
    process.env.TARGET_REPO_WORKTREE_ROOT = "/tmp/worktrees";
    process.env.TARGET_REPO_REMOTE = "origin";
    process.env.TARGET_REPO_BASE_BRANCH = "main";
    process.env.ARTIFACTS_DIR = "/tmp/artifacts";
    process.env.CHROME_PATH = "/usr/local/bin/chrome";
    process.env.FFMPEG_BIN = "/usr/local/bin/ffmpeg";
    process.env.PORT = "3000";
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("stages, commits, pushes, and returns a compare URL", async () => {
    spawnMock
      .mockReturnValueOnce(fakeProc({ exitCode: 0, stdout: " M src/file.ts\n?? tests/file.test.ts\n" }))
      .mockReturnValueOnce(fakeProc({ exitCode: 0 }))
      .mockReturnValueOnce(fakeProc({ exitCode: 0 }))
      .mockReturnValueOnce(fakeProc({ exitCode: 0 }))
      .mockReturnValueOnce(fakeProc({ exitCode: 0, stdout: "git@github.com:barun1997/antigen.git\n" }));

    const result = await publishWorktreeFix({
      worktreePath: "/tmp/worktrees/BUG-42-1234abcd",
      branch: "fix/BUG-42-1234abcd",
      ticketIdentifier: "BUG-42",
      ticketTitle: "Checkout spacing regression",
    });

    expect(spawnMock).toHaveBeenNthCalledWith(
      1,
      "git",
      ["status", "--short"],
      expect.objectContaining({ cwd: "/tmp/worktrees/BUG-42-1234abcd" }),
    );
    expect(spawnMock).toHaveBeenNthCalledWith(
      2,
      "git",
      ["add", "-A"],
      expect.objectContaining({ cwd: "/tmp/worktrees/BUG-42-1234abcd" }),
    );
    expect(spawnMock).toHaveBeenNthCalledWith(
      3,
      "git",
      ["commit", "-m", "Fix BUG-42: Checkout spacing regression"],
      expect.objectContaining({ cwd: "/tmp/worktrees/BUG-42-1234abcd" }),
    );
    expect(spawnMock).toHaveBeenNthCalledWith(
      4,
      "git",
      ["push", "--set-upstream", "origin", "fix/BUG-42-1234abcd"],
      expect.objectContaining({ cwd: "/tmp/worktrees/BUG-42-1234abcd" }),
    );
    expect(result).toEqual({
      publishUrl: "https://github.com/barun1997/antigen/compare/main...fix/BUG-42-1234abcd?expand=1",
    });
  });

  it("throws when there is nothing to publish", async () => {
    spawnMock.mockReturnValueOnce(fakeProc({ exitCode: 0, stdout: "" }));

    await expect(
      publishWorktreeFix({
        worktreePath: "/tmp/worktrees/BUG-42-1234abcd",
        branch: "fix/BUG-42-1234abcd",
        ticketIdentifier: "BUG-42",
        ticketTitle: "Checkout spacing regression",
      }),
    ).rejects.toThrow(/no changes to publish/);
  });

  it("surfaces git push failures", async () => {
    spawnMock
      .mockReturnValueOnce(fakeProc({ exitCode: 0, stdout: " M src/file.ts\n" }))
      .mockReturnValueOnce(fakeProc({ exitCode: 0 }))
      .mockReturnValueOnce(fakeProc({ exitCode: 0 }))
      .mockReturnValueOnce(fakeProc({ exitCode: 1, stderr: "permission denied" }));

    await expect(
      publishWorktreeFix({
        worktreePath: "/tmp/worktrees/BUG-42-1234abcd",
        branch: "fix/BUG-42-1234abcd",
        ticketIdentifier: "BUG-42",
        ticketTitle: "Checkout spacing regression",
      }),
    ).rejects.toThrow(/git push --set-upstream origin fix\/BUG-42-1234abcd failed: permission denied/);
  });
});
