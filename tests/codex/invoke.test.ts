import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";

const spawnMock = vi.fn();
vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

import { invokeCodex } from "../../src/codex/invoke";

function fakeProc(opts: { stdout?: string; stderr?: string; exitCode: number | null }): ChildProcess {
  const proc = new EventEmitter() as unknown as ChildProcess;
  (proc as unknown as { stdout: EventEmitter }).stdout = new EventEmitter();
  (proc as unknown as { stderr: EventEmitter }).stderr = new EventEmitter();
  setImmediate(() => {
    if (opts.stdout) (proc as any).stdout.emit("data", Buffer.from(opts.stdout));
    if (opts.stderr) (proc as any).stderr.emit("data", Buffer.from(opts.stderr));
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
      fakeProc({ stdout: "first line\n", stderr: "warn line\n", exitCode: 0 }),
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
      stdout: "first line\n",
      stderr: "warn line\n",
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
      { type: "stderr", chunk: "warn line\n" },
      { type: "exit", exitCode: 0 },
    ]);
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
});
