import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const { invokeCodexMock, mkdirMock, writeFileMock } = vi.hoisted(() => ({
  invokeCodexMock: vi.fn(),
  mkdirMock: vi.fn(),
  writeFileMock: vi.fn(),
}));

vi.mock("../../src/codex/invoke", () => ({
  invokeCodex: (...args: unknown[]) => invokeCodexMock(...args),
}));

vi.mock("node:fs/promises", () => ({
  mkdir: (...args: unknown[]) => mkdirMock(...args),
  writeFile: (...args: unknown[]) => writeFileMock(...args),
}));

import { persistFixerTranscript, parseFixerResult, runCodexTask, runFixer } from "../../src/codex/fixer";

describe("fixer", () => {
  const originalEnv = { ...process.env };
  const requiredEnvDefaults = {
    ARTIFACTS_DIR: "/tmp/artifacts",
    INNGEST_EVENT_KEY: "x",
    INNGEST_SIGNING_KEY: "x",
    OPENAI_API_KEY: "x",
    TARGET_APP_URL: "http://localhost",
    SENTRY_WEBHOOK_SECRET: "x",
    LINEAR_API_KEY: "x",
    LINEAR_WEBHOOK_SECRET: "x",
    TARGET_REPO_PATH: "/tmp/repo",
    TARGET_REPO_WORKTREE_ROOT: "/tmp/repo-root",
  };

  beforeEach(() => {
    process.env = { ...originalEnv, ...requiredEnvDefaults };
    invokeCodexMock.mockReset();
    mkdirMock.mockReset();
    writeFileMock.mockReset();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("parseFixerResult", () => {
    it("throws when FIXER_RESULT line is missing", () => {
      expect(() => parseFixerResult("some preamble\nno result here")).toThrow(/missing FIXER_RESULT line/);
    });

    it("parses FIXER_RESULT JSON from stdout", () => {
      const stdout = [
        "some preamble",
        'FIXER_RESULT {"status":"ok","prUrl":"https://example.test/pr/1","testPath":"tests/fix.spec.ts","redEvidence":"red","greenEvidence":"green","regressionGuardEvidence":"guard","e2eValidationEvidence":"e2e proof"}',
      ].join("\n");

      const parsed = parseFixerResult(stdout);

      expect(parsed).toEqual({
        status: "ok",
        prUrl: "https://example.test/pr/1",
        testPath: "tests/fix.spec.ts",
        redEvidence: "red",
        greenEvidence: "green",
        regressionGuardEvidence: "guard",
        e2eValidationEvidence: "e2e proof",
      });
    });

    it("throws when proof fields are missing", () => {
      const stdout = [
        'FIXER_RESULT {"status":"ok","prUrl":"https://example.test/pr/1","testPath":"tests/fix.spec.ts","greenEvidence":"green","regressionGuardEvidence":"guard","e2eValidationEvidence":"e2e proof"}',
      ].join("\n");

      expect(() => parseFixerResult(stdout)).toThrow(/missing required proof/);
    });
  });

  describe("runCodexTask", () => {
    it("passes cwd and configured model overrides to invokeCodex", async () => {
      process.env.CODEX_MODEL = "gpt-5.3-codex-spark";
      process.env.CODEX_REASONING_EFFORT = "medium";
      invokeCodexMock.mockResolvedValue({ stdout: "done", stderr: "", exitCode: 0 });

      await runCodexTask({
        prompt: "fix this",
        cwd: "/tmp/repo",
      });

      expect(invokeCodexMock).toHaveBeenCalledWith(
        "fix this",
        expect.objectContaining({
          cwd: "/tmp/repo",
          model: "gpt-5.3-codex-spark",
          reasoningEffort: "medium",
          observer: expect.objectContaining({
            onStart: expect.any(Function),
            onStdout: expect.any(Function),
            onStderr: expect.any(Function),
            onExit: expect.any(Function),
          }),
        }),
      );
    });

    it("omits model overrides when env is not set", async () => {
      invokeCodexMock.mockResolvedValue({ stdout: "done", stderr: "", exitCode: 0 });

      await runCodexTask({
        prompt: "fix this",
      });

      expect(invokeCodexMock).toHaveBeenCalledWith(
        "fix this",
        expect.objectContaining({
          cwd: undefined,
          model: undefined,
          reasoningEffort: undefined,
          observer: expect.objectContaining({
            onStart: expect.any(Function),
            onStdout: expect.any(Function),
            onStderr: expect.any(Function),
            onExit: expect.any(Function),
          }),
        }),
      );
    });

    it("collects a chronological transcript and forwards observer events", async () => {
      const seen: Array<string> = [];
      invokeCodexMock.mockImplementation(async (_prompt: string, opts: { observer: any }) => {
        opts.observer.onStart({ command: "codex", args: ["exec"], cwd: "/tmp/repo" });
        opts.observer.onStdout("alpha\n");
        opts.observer.onStderr("warn\n");
        opts.observer.onExit({ exitCode: 0 });
        return {
          stdout: "alpha\nFIXER_RESULT {\"status\":\"ok\",\"prUrl\":\"https://example.test/pr/2\",\"testPath\":\"tests/fix2.spec.ts\",\"redEvidence\":\"red\",\"greenEvidence\":\"green\",\"regressionGuardEvidence\":\"guard\",\"e2eValidationEvidence\":\"e2e proof\"}\n",
          stderr: "warn\n",
          exitCode: 0,
        };
      });

      const output = await runCodexTask({
        prompt: "fix this",
        cwd: "/tmp/repo",
        observer: {
          onEvent(event) {
            seen.push(event.type);
          },
        },
      });

      expect(output.transcript).toBe("[stdout]\nalpha\n[stderr]\nwarn\n");
      expect(seen).toEqual(["spawn", "stdout", "stderr", "exit"]);
    });
  });

  describe("persistFixerTranscript", () => {
    it("persists a transcript under ARTIFACTS_DIR/fixer-transcripts", async () => {
      process.env.ARTIFACTS_DIR = "/tmp/artifacts";
      mkdirMock.mockResolvedValue(undefined);
      writeFileMock.mockResolvedValue(undefined);

      const transcriptPath = await persistFixerTranscript({
        identifier: "SID-7",
        branch: "fix/SID-7-7ff6b279",
        transcript: "[stdout]\nalpha\n",
      });

      expect(mkdirMock).toHaveBeenCalledWith(
        "/tmp/artifacts/fixer-transcripts",
        { recursive: true },
      );
      expect(writeFileMock).toHaveBeenCalledWith(
        "/tmp/artifacts/fixer-transcripts/sid-7--fix-sid-7-7ff6b279.log",
        "[stdout]\nalpha\n",
        "utf8",
      );
      expect(transcriptPath).toBe(
        "/tmp/artifacts/fixer-transcripts/sid-7--fix-sid-7-7ff6b279.log",
      );
    });

    it("returns null when transcript persistence fails", async () => {
      process.env.ARTIFACTS_DIR = "/tmp/artifacts";
      mkdirMock.mockResolvedValue(undefined);
      writeFileMock.mockRejectedValue(new Error("disk full"));

      await expect(
        persistFixerTranscript({
          identifier: "SID-7",
          branch: "fix/SID-7-7ff6b279",
          transcript: "[stdout]\nalpha\n",
        }),
      ).resolves.toBeNull();
    });
  });

  describe("runFixer", () => {
    it("parses result from runCodexTask", async () => {
      invokeCodexMock.mockResolvedValue({
        stdout:
          'LOG\nFIXER_RESULT {"status":"ok","prUrl":"https://example.test/pr/2","testPath":"tests/fix2.spec.ts","redEvidence":"red","greenEvidence":"green","regressionGuardEvidence":"guard","e2eValidationEvidence":"e2e proof","browserVerificationEvidence":"browser"}\n',
        stderr: "",
        exitCode: 0,
      });

      const result = await runFixer({
        prompt: "fix issue",
        cwd: "/tmp/repo2",
      });

      expect(invokeCodexMock).toHaveBeenCalledWith(
        "fix issue",
        expect.objectContaining({
          cwd: "/tmp/repo2",
          model: undefined,
          reasoningEffort: undefined,
          observer: expect.objectContaining({
            onStart: expect.any(Function),
            onStdout: expect.any(Function),
            onStderr: expect.any(Function),
            onExit: expect.any(Function),
          }),
        }),
      );
      expect(result).toEqual({
        status: "ok",
        prUrl: "https://example.test/pr/2",
        testPath: "tests/fix2.spec.ts",
        redEvidence: "red",
        greenEvidence: "green",
        regressionGuardEvidence: "guard",
        e2eValidationEvidence: "e2e proof",
        browserVerificationEvidence: "browser",
      });
    });
  });
});
