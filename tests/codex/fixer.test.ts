import { describe, expect, it, vi } from "vitest";

const startThreadMock = vi.fn();
const runMock = vi.fn();

vi.mock("@openai/codex-sdk", () => ({
  Codex: vi.fn(() => ({
    startThread: startThreadMock,
  })),
}));

import { runCodexTask, runFixer, parseFixerResult } from "../../src/codex/fixer";

describe("fixer", () => {
  beforeEach(() => {
    startThreadMock.mockReset();
    runMock.mockReset();
  });

  describe("parseFixerResult", () => {
    it("throws when FIXER_RESULT line is missing", () => {
      expect(() => parseFixerResult("some preamble\nno result here")).toThrow(/missing FIXER_RESULT line/);
    });

    it("parses FIXER_RESULT JSON from stdout", () => {
      const stdout = [
        "some preamble",
        'FIXER_RESULT {"status":"ok","prUrl":"https://example.test/pr/1","testPath":"tests/fix.spec.ts","redEvidence":"red","greenEvidence":"green","regressionGuardEvidence":"guard"}',
      ].join("\n");

      const parsed = parseFixerResult(stdout);

      expect(parsed).toEqual({
        status: "ok",
        prUrl: "https://example.test/pr/1",
        testPath: "tests/fix.spec.ts",
        redEvidence: "red",
        greenEvidence: "green",
        regressionGuardEvidence: "guard",
      });
    });

    it("throws when proof fields are missing", () => {
      const stdout = [
        'FIXER_RESULT {"status":"ok","prUrl":"https://example.test/pr/1","testPath":"tests/fix.spec.ts","greenEvidence":"green","regressionGuardEvidence":"guard"}',
      ].join("\n");

      expect(() => parseFixerResult(stdout)).toThrow(/missing required proof/);
    });
  });

  describe("runCodexTask", () => {
    it("uses minimal thread options and only sets workingDirectory when cwd is provided", async () => {
      startThreadMock.mockReturnValue({ run: runMock });
      runMock.mockResolvedValue({ finalResponse: "done" });

      await runCodexTask("fix this", "/tmp/repo");

      expect(startThreadMock).toHaveBeenCalledWith({ workingDirectory: "/tmp/repo" });
      expect(runMock).toHaveBeenCalledWith("fix this");
    });

    it("passes no thread options when cwd is not provided", async () => {
      startThreadMock.mockReturnValue({ run: runMock });
      runMock.mockResolvedValue({ finalResponse: "done" });

      await runCodexTask("fix this");

      expect(startThreadMock).toHaveBeenCalledWith(undefined);
      expect(runMock).toHaveBeenCalledWith("fix this");
    });

    it("returns turn.finalResponse", async () => {
      startThreadMock.mockReturnValue({ run: runMock });
      runMock.mockResolvedValue({ finalResponse: "done" });

      const response = await runCodexTask("fix this", "/tmp/repo");

      expect(response).toBe("done");
      expect(startThreadMock).toHaveBeenCalledWith({ workingDirectory: "/tmp/repo" });
      expect(runMock).toHaveBeenCalledWith("fix this");
    });
  });

  describe("runFixer", () => {
    it("parses result from runCodexTask and passes cwd to thread", async () => {
      startThreadMock.mockReturnValue({ run: runMock });
      runMock.mockResolvedValue({
        finalResponse:
          'LOG\nFIXER_RESULT {"status":"ok","prUrl":"https://example.test/pr/2","testPath":"tests/fix2.spec.ts","redEvidence":"red","greenEvidence":"green","regressionGuardEvidence":"guard","browserVerificationEvidence":"browser"}\n',
      });

      const result = await runFixer({
        prompt: "fix issue",
        cwd: "/tmp/repo2",
      });

      expect(startThreadMock).toHaveBeenCalledWith({ workingDirectory: "/tmp/repo2" });
      expect(result).toEqual({
        status: "ok",
        prUrl: "https://example.test/pr/2",
        testPath: "tests/fix2.spec.ts",
        redEvidence: "red",
        greenEvidence: "green",
        regressionGuardEvidence: "guard",
        browserVerificationEvidence: "browser",
      });
    });
  });
});
