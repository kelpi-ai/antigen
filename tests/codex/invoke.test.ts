import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";

type FakeChunks = string | string[];

function chunksFrom(value?: FakeChunks): string[] {
  if (!value) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

const spawnMock = vi.fn();
vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

import { invokeCodex } from "../../src/codex/invoke";

function fakeProc(opts: {
  stdout?: FakeChunks;
  stderr?: FakeChunks;
  exitCode: number | null;
}): ChildProcess {
  const proc = new EventEmitter() as unknown as ChildProcess;
  (proc as unknown as { stdout: EventEmitter }).stdout = new EventEmitter();
  (proc as unknown as { stderr: EventEmitter }).stderr = new EventEmitter();
  setImmediate(() => {
    for (const chunk of chunksFrom(opts.stdout)) {
      (proc as any).stdout.emit("data", Buffer.from(chunk));
    }
    for (const chunk of chunksFrom(opts.stderr)) {
      (proc as any).stderr.emit("data", Buffer.from(chunk));
    }
    proc.emit("close", opts.exitCode);
  });
  return proc;
}

describe("invokeCodex", () => {
  const originalEnv = { ...process.env };
  beforeEach(() => {
    process.env = { ...originalEnv };
    spawnMock.mockReset();
    process.env.CODEX_BIN = "/usr/local/bin/codex";
    process.env.INNGEST_EVENT_KEY = "x";
    process.env.INNGEST_SIGNING_KEY = "x";
    process.env.GITHUB_WEBHOOK_SECRET = "gh-secret";
    process.env.CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  });
  afterEach(() => {
    process.env = originalEnv;
    vi.useRealTimers();
  });

  it("spawns codex with --full-auto and the prompt", async () => {
    spawnMock.mockReturnValue(fakeProc({ stdout: "done", exitCode: 0 }));
    await invokeCodex("reproduce issue 123");
    expect(spawnMock).toHaveBeenCalledWith(
      "/usr/local/bin/codex",
      ["exec", "--full-auto", "reproduce issue 123"],
      expect.objectContaining({ stdio: ["ignore", "pipe", "pipe"] }),
    );
  });

  it("passes through an explicit model override", async () => {
    spawnMock.mockReturnValue(fakeProc({ stdout: "done", exitCode: 0 }));

    await invokeCodex("reproduce issue 123", { model: "gpt-5.3-codex-spark" });

    expect(spawnMock).toHaveBeenCalledWith(
      "/usr/local/bin/codex",
      ["exec", "--full-auto", "--model", "gpt-5.3-codex-spark", "reproduce issue 123"],
      expect.objectContaining({ stdio: ["ignore", "pipe", "pipe"] }),
    );
  });

  it("passes through an explicit reasoning effort override", async () => {
    spawnMock.mockReturnValue(fakeProc({ stdout: "done", exitCode: 0 }));

    await invokeCodex("reproduce issue 123", { reasoningEffort: "medium" });

    expect(spawnMock).toHaveBeenCalledWith(
      "/usr/local/bin/codex",
      ["exec", "--full-auto", "-c", 'model_reasoning_effort="medium"', "reproduce issue 123"],
      expect.objectContaining({ stdio: ["ignore", "pipe", "pipe"] }),
    );
  });

  it("falls back to codex binary when CODEX_BIN is unset", async () => {
    delete process.env.CODEX_BIN;
    spawnMock.mockReturnValue(fakeProc({ stdout: "done", exitCode: 0 }));
    await invokeCodex("reproduce issue 123");
    expect(spawnMock).toHaveBeenCalledWith(
      "codex",
      ["exec", "--full-auto", "reproduce issue 123"],
      expect.objectContaining({ stdio: ["ignore", "pipe", "pipe"] }),
    );
  });

  it("resolves with stdout on exit 0", async () => {
    spawnMock.mockReturnValue(fakeProc({ stdout: "ok-output", exitCode: 0 }));
    const result = await invokeCodex("hello");
    expect(result.stdout).toBe("ok-output");
    expect(result.exitCode).toBe(0);
  });

  it("forwards stdout and stderr to chunk callbacks", async () => {
    const onStdoutChunk = vi.fn();
    const onStderrChunk = vi.fn();
    spawnMock.mockReturnValue(
      fakeProc({
        stdout: "first line\nsecond line without newline",
        stderr: "warn line\n",
        exitCode: 0,
      }),
    );

    await invokeCodex("hello", {
      onStdoutChunk,
      onStderrChunk,
    });

    expect(onStdoutChunk).toHaveBeenCalledWith("first line");
    expect(onStdoutChunk).toHaveBeenCalledWith("second line without newline");
    expect(onStderrChunk).toHaveBeenCalledWith("warn line");
  });

  it("rejects with stderr on non-zero exit", async () => {
    spawnMock.mockReturnValue(fakeProc({ stderr: "boom", exitCode: 1 }));
    await expect(invokeCodex("hello")).rejects.toThrow(/codex exited 1.*boom/);
  });

  it("rejects when close code is null", async () => {
    spawnMock.mockReturnValue(fakeProc({ stderr: "boom", exitCode: null }));
    await expect(invokeCodex("hello")).rejects.toThrow(/codex exited null.*boom/);
  });

  it("rejects on timeout and kills the child", async () => {
    vi.useFakeTimers();
    const kill = vi.fn();
    const proc = new EventEmitter() as unknown as ChildProcess;
    (proc as unknown as { stdout: EventEmitter }).stdout = new EventEmitter();
    (proc as unknown as { stderr: EventEmitter }).stderr = new EventEmitter();
    (proc as unknown as { kill: typeof kill }).kill = kill;
    spawnMock.mockReturnValue(proc);

    const promise = invokeCodex("hello", { timeoutMs: 10 });
    const rejection = expect(promise).rejects.toThrow(/codex timed out after 10ms/);
    await vi.advanceTimersByTimeAsync(10);

    await rejection;
    expect(kill).toHaveBeenCalledWith("SIGKILL");
  });

  it("streams stdout, stderr, and lifecycle events to an observer while buffering output", async () => {
    const events: Array<
      | { type: "start"; command: string; args: string[]; cwd?: string }
      | { type: "stdout"; chunk: string }
      | { type: "stderr"; chunk: string }
      | { type: "exit"; exitCode: number | null }
    > = [];

    spawnMock.mockReturnValue(
      fakeProc({
        stdout: ["first line\n", "second line\n"],
        stderr: ["warn line\n", "warn again\n"],
        exitCode: 0,
      }),
    );

    const result = await invokeCodex("reproduce issue 123", {
      cwd: "/tmp/repo",
      observer: {
        onStart(meta) {
          events.push({ type: "start", ...meta });
        },
        onStdout(chunk) {
          events.push({ type: "stdout", chunk });
        },
        onStderr(chunk) {
          events.push({ type: "stderr", chunk });
        },
        onExit(meta) {
          events.push({ type: "exit", exitCode: meta.exitCode });
        },
      },
    });

    expect(result).toEqual({
      stdout: "first line\nsecond line\n",
      stderr: "warn line\nwarn again\n",
      exitCode: 0,
    });
    expect(events).toEqual([
      {
        type: "start",
        command: "/usr/local/bin/codex",
        args: ["exec", "--full-auto", "reproduce issue 123"],
        cwd: "/tmp/repo",
      },
      { type: "stdout", chunk: "first line\n" },
      { type: "stdout", chunk: "second line\n" },
      { type: "stderr", chunk: "warn line\n" },
      { type: "stderr", chunk: "warn again\n" },
      { type: "exit", exitCode: 0 },
    ]);
  });

  it("does not emit start if spawn throws", async () => {
    const events: Array<
      | { type: "start"; command: string; args: string[]; cwd?: string }
      | { type: "exit"; exitCode: number | null }
    > = [];

    spawnMock.mockImplementation(() => {
      throw new Error("spawn failed");
    });

    await expect(
      invokeCodex("hello", {
        observer: {
          onStart(meta) {
            events.push({ type: "start", ...meta });
          },
          onExit(meta) {
            events.push({ type: "exit", exitCode: meta.exitCode });
          },
        },
      }),
    ).rejects.toThrow("spawn failed");

    expect(events).toEqual([]);
  });

  it("rejects with a structured execution error that preserves buffered output", async () => {
    spawnMock.mockReturnValue(
      fakeProc({ stdout: "partial output\n", stderr: "boom", exitCode: 1 }),
    );

    await expect(invokeCodex("hello")).rejects.toMatchObject({
      name: "CodexExecutionError",
      exitCode: 1,
      stdout: "partial output\n",
      stderr: "boom",
    });
  });

  it("does not fail when observer callbacks throw", async () => {
    spawnMock.mockReturnValue(fakeProc({ stdout: "ok\n", stderr: "warn\n", exitCode: 0 }));

    const result = await invokeCodex("hello", {
      observer: {
        onStart() {
          throw new Error("boom start");
        },
        onStdout() {
          throw new Error("boom stdout");
        },
        onStderr() {
          throw new Error("boom stderr");
        },
        onExit() {
          throw new Error("boom exit");
        },
      },
    });

    expect(result).toEqual({
      stdout: "ok\n",
      stderr: "warn\n",
      exitCode: 0,
    });
  });
});
