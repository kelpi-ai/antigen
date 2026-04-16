import { describe, expect, it, vi, beforeEach } from "vitest";

const {
  buildFixerPromptMock,
  fetchTicketContextMock,
  verifyCheckoutMock,
  fetchCheckoutRemoteMock,
  pullCheckoutBaseBranchMock,
  createWorktreeMock,
  removeWorktreeMock,
  runCodexTaskMock,
  persistFixerTranscriptMock,
  parseFixerResultMock,
  CodexTaskErrorMock,
} = vi.hoisted(() => ({
  buildFixerPromptMock: vi.fn(),
  fetchTicketContextMock: vi.fn(),
  verifyCheckoutMock: vi.fn(),
  fetchCheckoutRemoteMock: vi.fn(),
  pullCheckoutBaseBranchMock: vi.fn(),
  createWorktreeMock: vi.fn(),
  removeWorktreeMock: vi.fn(),
  runCodexTaskMock: vi.fn(),
  persistFixerTranscriptMock: vi.fn(),
  parseFixerResultMock: vi.fn(),
  CodexTaskErrorMock: class CodexTaskError extends Error {
    constructor(public output: unknown, message: string) {
      super(message);
      this.name = "CodexTaskError";
    }
  },
}));

vi.mock("../../src/prompts/fixer", () => ({
  buildFixerPrompt: buildFixerPromptMock,
}));

vi.mock("../../src/linear/fetchTicketContext", () => ({
  fetchTicketContext: fetchTicketContextMock,
}));

vi.mock("../../src/git/updateCheckout", () => ({
  verifyCheckout: verifyCheckoutMock,
  fetchCheckoutRemote: fetchCheckoutRemoteMock,
  pullCheckoutBaseBranch: pullCheckoutBaseBranchMock,
}));

vi.mock("../../src/git/worktree", () => ({
  createWorktree: createWorktreeMock,
  removeWorktree: removeWorktreeMock,
}));

vi.mock("../../src/codex/fixer", () => ({
  runCodexTask: runCodexTaskMock,
  persistFixerTranscript: persistFixerTranscriptMock,
  parseFixerResult: parseFixerResultMock,
  CodexTaskError: CodexTaskErrorMock,
}));

import { functions } from "../../src/inngest";
import { onLinearTicket, runLinearTicketFlow } from "../../src/inngest/functions/onLinearTicket";

interface StepLike {
  steps: string[];
  step: {
    run: ReturnType<typeof vi.fn>;
  };
}

function createStepRecorder(): StepLike {
  const steps: string[] = [];
  return {
    steps,
    step: {
      run: vi.fn(async (id: string, fn: () => Promise<unknown>) => {
        steps.push(id);
        return fn();
      }),
    },
  };
}

describe("onLinearTicket", () => {
  const originalEnv = { ...process.env };

  const ticket = {
    ticketId: "abc-1",
    identifier: "ABC-1",
    module: "billing",
    url: "https://linear.app/org/issue/ABC-1",
  };

  const ticketContext = {
    ...ticket,
    title: "Checkout spacing regression",
    body: "Button clipped at 1366x768",
    browserVisible: true,
    similarIssueContext: "Prior issue in same area",
    environmentHints: {
      browser: "Chromium",
      os: "Linux",
      viewport: "1366x768",
    },
  };

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.INNGEST_EVENT_KEY = "event-key";
    process.env.INNGEST_SIGNING_KEY = "signing-key";
    process.env.OPENAI_API_KEY = "sk-openai";
    process.env.TARGET_APP_URL = "http://localhost:3001";
    process.env.SENTRY_WEBHOOK_SECRET = "sentry-webhook-secret";
    process.env.LINEAR_API_KEY = "linear-api-key";
    process.env.LINEAR_WEBHOOK_SECRET = "linear-webhook-secret";
    process.env.TARGET_REPO_PATH = "/tmp/target-repo";
    process.env.TARGET_REPO_WORKTREE_ROOT = "/tmp/worktrees";
    process.env.TARGET_REPO_REMOTE = "origin";
    process.env.TARGET_REPO_BASE_BRANCH = "main";
    process.env.ARTIFACTS_DIR = "/tmp/artifacts";
    process.env.CHROME_PATH = "/usr/bin/google-chrome";
    process.env.FFMPEG_BIN = "/usr/bin/ffmpeg";
    process.env.PORT = "3000";

    fetchTicketContextMock.mockReset();
    verifyCheckoutMock.mockReset();
    fetchCheckoutRemoteMock.mockReset();
    pullCheckoutBaseBranchMock.mockReset();
    createWorktreeMock.mockReset();
    buildFixerPromptMock.mockReset();
    removeWorktreeMock.mockReset();
    runCodexTaskMock.mockReset();
    persistFixerTranscriptMock.mockReset();
    parseFixerResultMock.mockReset();
  });

  it("has id 'on-linear-ticket'", () => {
    expect(onLinearTicket.id()).toBe("on-linear-ticket");
  });

  it("is registered in the barrel", () => {
    expect(functions).toContain(onLinearTicket);
  });

  it("runs steps in the expected order", async () => {
    const { steps, step } = createStepRecorder();
    const result = {
      status: "ok" as const,
      prUrl: "https://example.test/pr/1",
      testPath: "tests/fix.spec.ts",
      redEvidence: "red",
      greenEvidence: "green",
      regressionGuardEvidence: "guard",
      e2eValidationEvidence: "e2e proof",
    };

    fetchTicketContextMock.mockResolvedValue(ticketContext);
    verifyCheckoutMock.mockResolvedValue(undefined);
    fetchCheckoutRemoteMock.mockResolvedValue(undefined);
    pullCheckoutBaseBranchMock.mockResolvedValue(undefined);
    createWorktreeMock.mockResolvedValue({
      path: "/tmp/wt/ABC-1-abcd",
      branch: "fix/ABC-1-abcd",
    });
    buildFixerPromptMock.mockReturnValue("prompt-body");
    runCodexTaskMock.mockResolvedValue({
      stdout:
        'LOG\nFIXER_RESULT {"status":"ok","prUrl":"https://example.test/pr/1","testPath":"tests/fix.spec.ts","redEvidence":"red","greenEvidence":"green","regressionGuardEvidence":"guard","e2eValidationEvidence":"e2e proof"}\n',
      stderr: "",
      exitCode: 0,
      transcript: "[stdout]\ninstalling dependencies\n",
    });
    persistFixerTranscriptMock.mockImplementation(async ({ observer }) => {
      observer?.onEvent?.({ type: "persisted", path: "/tmp/artifacts/fixer-transcripts/abc-1.log" });
      return "/tmp/artifacts/fixer-transcripts/abc-1.log";
    });
    parseFixerResultMock.mockReturnValue(result);

    const actual = await runLinearTicketFlow({
      event: { data: ticket },
      step,
    });

    expect(actual).toEqual(result);
    expect(steps).toEqual([
      "fetch-ticket-context",
      "verify-target-checkout",
      "fetch-target-remote",
      "pull-target-base-branch",
      "create-worktree",
      "build-prompt",
      "run-fixer",
      "persist-fixer-transcript",
      "parse-fixer-result",
      "remove-worktree",
    ]);
    expect(buildFixerPromptMock).toHaveBeenCalledWith(
      expect.objectContaining({ targetAppUrl: "http://localhost:3001" }),
    );
    expect(removeWorktreeMock).toHaveBeenCalledWith("/tmp/wt/ABC-1-abcd");
    expect(runCodexTaskMock).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "prompt-body",
        cwd: "/tmp/wt/ABC-1-abcd",
      }),
    );
    expect(persistFixerTranscriptMock).toHaveBeenCalledWith({
      identifier: "ABC-1",
      branch: "fix/ABC-1-abcd",
      transcript: "[stdout]\ninstalling dependencies\n",
      observer: expect.any(Object),
    });
    expect(parseFixerResultMock).toHaveBeenCalledWith(
      'LOG\nFIXER_RESULT {"status":"ok","prUrl":"https://example.test/pr/1","testPath":"tests/fix.spec.ts","redEvidence":"red","greenEvidence":"green","regressionGuardEvidence":"guard","e2eValidationEvidence":"e2e proof"}\n',
    );
  });

  it("does not create or remove worktree if checkout refresh fails", async () => {
    const { steps, step } = createStepRecorder();

    fetchTicketContextMock.mockResolvedValue(ticketContext);
    verifyCheckoutMock.mockRejectedValue(new Error("cannot refresh"));

    await expect(
      runLinearTicketFlow({ event: { data: ticket }, step }),
    ).rejects.toThrow(/cannot refresh/);

    expect(steps).toEqual(["fetch-ticket-context", "verify-target-checkout"]);
    expect(createWorktreeMock).not.toHaveBeenCalled();
    expect(removeWorktreeMock).not.toHaveBeenCalled();
  });

  it("always removes the worktree when fixer fails", async () => {
    const { steps, step } = createStepRecorder();

    fetchTicketContextMock.mockResolvedValue(ticketContext);
    verifyCheckoutMock.mockResolvedValue(undefined);
    fetchCheckoutRemoteMock.mockResolvedValue(undefined);
    pullCheckoutBaseBranchMock.mockResolvedValue(undefined);
    createWorktreeMock.mockResolvedValue({
      path: "/tmp/wt/ABC-1-efgh",
      branch: "fix/ABC-1-efgh",
    });
    runCodexTaskMock.mockRejectedValue(new Error("fixer failed"));

    let caughtError: unknown;
    try {
      await runLinearTicketFlow({ event: { data: ticket }, step });
      expect.fail("expected runLinearTicketFlow to throw");
    } catch (error) {
      caughtError = error;
    }
    expect(caughtError).toBeInstanceOf(Error);
    expect((caughtError as Error).message).toContain("fixer failed");

    expect(steps).toEqual([
      "fetch-ticket-context",
      "verify-target-checkout",
      "fetch-target-remote",
      "pull-target-base-branch",
      "create-worktree",
      "build-prompt",
      "run-fixer",
      "remove-worktree",
    ]);
    expect(runCodexTaskMock).toHaveBeenCalledTimes(1);
    expect(persistFixerTranscriptMock).toHaveBeenCalledTimes(0);
    expect(parseFixerResultMock).toHaveBeenCalledTimes(0);

    expect(removeWorktreeMock).toHaveBeenCalledWith("/tmp/wt/ABC-1-efgh");
  });

  it("removes the worktree when prompt generation fails", async () => {
    const { steps, step } = createStepRecorder();

    fetchTicketContextMock.mockResolvedValue(ticketContext);
    verifyCheckoutMock.mockResolvedValue(undefined);
    fetchCheckoutRemoteMock.mockResolvedValue(undefined);
    pullCheckoutBaseBranchMock.mockResolvedValue(undefined);
    createWorktreeMock.mockResolvedValue({
      path: "/tmp/wt/ABC-1-ijkl",
      branch: "fix/ABC-1-ijkl",
    });
    buildFixerPromptMock.mockRejectedValue(new Error("prompt failed"));

    await expect(
      runLinearTicketFlow({ event: { data: ticket }, step }),
    ).rejects.toThrow(/prompt failed/);

    expect(steps).toEqual([
      "fetch-ticket-context",
      "verify-target-checkout",
      "fetch-target-remote",
      "pull-target-base-branch",
      "create-worktree",
      "build-prompt",
      "remove-worktree",
    ]);
    expect(removeWorktreeMock).toHaveBeenCalledWith("/tmp/wt/ABC-1-ijkl");
  });

  it("keeps the original failure when cleanup also fails", async () => {
    const { steps, step } = createStepRecorder();

    fetchTicketContextMock.mockResolvedValue(ticketContext);
    verifyCheckoutMock.mockResolvedValue(undefined);
    fetchCheckoutRemoteMock.mockResolvedValue(undefined);
    pullCheckoutBaseBranchMock.mockResolvedValue(undefined);
    createWorktreeMock.mockResolvedValue({
      path: "/tmp/wt/ABC-1-mnop",
      branch: "fix/ABC-1-mnop",
    });
    buildFixerPromptMock.mockResolvedValue("prompt-body");
    runCodexTaskMock.mockRejectedValue(new Error("fixer failed"));
    removeWorktreeMock.mockRejectedValue(new Error("cleanup failed"));

    try {
      await runLinearTicketFlow({ event: { data: ticket }, step });
      expect.fail("expected runLinearTicketFlow to throw");
    } catch (error) {
      const aggregate = error as AggregateError;
      expect(aggregate).toBeInstanceOf(AggregateError);
      const messages = aggregate.errors.map((value) =>
        value instanceof Error ? value.message : String(value),
      );
      expect(messages).toEqual(expect.arrayContaining(["fixer failed", "cleanup failed"]));
    }

    expect(steps).toEqual([
      "fetch-ticket-context",
      "verify-target-checkout",
      "fetch-target-remote",
      "pull-target-base-branch",
      "create-worktree",
      "build-prompt",
      "run-fixer",
      "remove-worktree",
    ]);
  });

  it("throws the cleanup failure when fixer succeeds but worktree removal fails", async () => {
    const { steps, step } = createStepRecorder();
    const result = {
      status: "ok" as const,
      prUrl: "https://example.test/pr/2",
      testPath: "tests/fix2.spec.ts",
      redEvidence: "red",
      greenEvidence: "green",
      regressionGuardEvidence: "guard",
      e2eValidationEvidence: "e2e proof",
    };

    fetchTicketContextMock.mockResolvedValue(ticketContext);
    verifyCheckoutMock.mockResolvedValue(undefined);
    fetchCheckoutRemoteMock.mockResolvedValue(undefined);
    pullCheckoutBaseBranchMock.mockResolvedValue(undefined);
    createWorktreeMock.mockResolvedValue({
      path: "/tmp/wt/ABC-1-mnop",
      branch: "fix/ABC-1-mnop",
    });
    buildFixerPromptMock.mockReturnValue("prompt-body");
    runCodexTaskMock.mockResolvedValue({
      stdout:
        'LOG\nFIXER_RESULT {"status":"ok","prUrl":"https://example.test/pr/2","testPath":"tests/fix2.spec.ts","redEvidence":"red","greenEvidence":"green","regressionGuardEvidence":"guard","e2eValidationEvidence":"e2e proof"}\n',
      stderr: "",
      exitCode: 0,
      transcript: "[stdout]\ninstalling dependencies\n",
    });
    persistFixerTranscriptMock.mockImplementation(async ({ observer }) => {
      observer?.onEvent?.({
        type: "persisted",
        path: "/tmp/artifacts/fixer-transcripts/abc-1.log",
      });
      return "/tmp/artifacts/fixer-transcripts/abc-1.log";
    });
    parseFixerResultMock.mockReturnValue(result);
    removeWorktreeMock.mockRejectedValue(new Error("cleanup failed"));

    await expect(
      runLinearTicketFlow({ event: { data: ticket }, step }),
    ).rejects.toThrow(/cleanup failed/);

    expect(steps).toEqual([
      "fetch-ticket-context",
      "verify-target-checkout",
      "fetch-target-remote",
      "pull-target-base-branch",
      "create-worktree",
      "build-prompt",
      "run-fixer",
      "persist-fixer-transcript",
      "parse-fixer-result",
      "remove-worktree",
    ]);
    expect(removeWorktreeMock).toHaveBeenCalledWith("/tmp/wt/ABC-1-mnop");
  });

  it("streams fixer output, persists the transcript, and parses in separate steps", async () => {
    const { steps, step } = createStepRecorder();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = {
      status: "ok" as const,
      prUrl: "https://example.test/pr/1",
      testPath: "tests/fix.spec.ts",
      redEvidence: "red",
      greenEvidence: "green",
      regressionGuardEvidence: "guard",
      e2eValidationEvidence: "e2e proof",
    };

    fetchTicketContextMock.mockResolvedValue(ticketContext);
    verifyCheckoutMock.mockResolvedValue(undefined);
    fetchCheckoutRemoteMock.mockResolvedValue(undefined);
    pullCheckoutBaseBranchMock.mockResolvedValue(undefined);
    createWorktreeMock.mockResolvedValue({
      path: "/tmp/wt/ABC-1-abcd",
      branch: "fix/ABC-1-abcd",
    });
    buildFixerPromptMock.mockReturnValue("prompt-body");
    runCodexTaskMock.mockImplementation(
      async ({ observer }: { observer?: { onEvent?: (event: unknown) => void } }) => {
        observer?.onEvent?.({ type: "spawn", command: "codex", args: ["exec"], cwd: "/tmp/wt/ABC-1-abcd" });
        observer?.onEvent?.({ type: "stdout", chunk: "installing dependencies\n" });
        observer?.onEvent?.({ type: "stderr", chunk: "warn line\n" });
        observer?.onEvent?.({ type: "exit", exitCode: 0 });

        return {
          stdout:
            'LOG\nFIXER_RESULT {"status":"ok","prUrl":"https://example.test/pr/1","testPath":"tests/fix.spec.ts","redEvidence":"red","greenEvidence":"green","regressionGuardEvidence":"guard","e2eValidationEvidence":"e2e proof"}\n',
          stderr: "warn line\n",
          exitCode: 0,
          transcript: "[stdout]\ninstalling dependencies\n[stderr]\nwarn line\n",
        };
      },
    );
    persistFixerTranscriptMock.mockImplementation(async ({ observer }) => {
      observer?.onEvent?.({
        type: "persisted",
        path: "/tmp/artifacts/fixer-transcripts/abc-1.log",
      });
      return "/tmp/artifacts/fixer-transcripts/abc-1.log";
    });
    parseFixerResultMock.mockReturnValue(result);

    const actual = await runLinearTicketFlow({
      event: { data: ticket },
      step,
    });

    expect(actual).toEqual(result);
    expect(steps).toEqual([
      "fetch-ticket-context",
      "verify-target-checkout",
      "fetch-target-remote",
      "pull-target-base-branch",
      "create-worktree",
      "build-prompt",
      "run-fixer",
      "persist-fixer-transcript",
      "parse-fixer-result",
      "remove-worktree",
    ]);
    expect(logSpy).toHaveBeenCalledWith("fixer.spawn", expect.objectContaining({ cwd: "/tmp/wt/ABC-1-abcd" }));
    expect(logSpy).toHaveBeenCalledWith("fixer.stdout", "installing dependencies\n");
    expect(errorSpy).toHaveBeenCalledWith("fixer.stderr", "warn line\n");
    expect(logSpy).toHaveBeenCalledWith("fixer.persisted", "/tmp/artifacts/fixer-transcripts/abc-1.log");
    expect(logSpy).toHaveBeenCalledWith("fixer.parse.start", "ABC-1");
    expect(logSpy).toHaveBeenCalledWith("fixer.parse.ok", "https://example.test/pr/1");
  });

  it("persists the transcript before rethrowing a fixer execution failure", async () => {
    const { steps, step } = createStepRecorder();

    fetchTicketContextMock.mockResolvedValue(ticketContext);
    verifyCheckoutMock.mockResolvedValue(undefined);
    fetchCheckoutRemoteMock.mockResolvedValue(undefined);
    pullCheckoutBaseBranchMock.mockResolvedValue(undefined);
    createWorktreeMock.mockResolvedValue({
      path: "/tmp/wt/ABC-1-fail",
      branch: "fix/ABC-1-fail",
    });
    buildFixerPromptMock.mockReturnValue("prompt-body");
    runCodexTaskMock.mockRejectedValue(
      new CodexTaskErrorMock(
        {
          stdout: "partial output\n",
          stderr: "boom\n",
          exitCode: 1,
          transcript: "[stdout]\npartial output\n[stderr]\nboom\n",
        },
        "codex exited 1: boom",
      ),
    );
    persistFixerTranscriptMock.mockResolvedValue("/tmp/artifacts/fixer-transcripts/abc-1-fail.log");

    await expect(
      runLinearTicketFlow({ event: { data: ticket }, step }),
    ).rejects.toThrow(/codex exited 1: boom/);

    expect(steps).toEqual([
      "fetch-ticket-context",
      "verify-target-checkout",
      "fetch-target-remote",
      "pull-target-base-branch",
      "create-worktree",
      "build-prompt",
      "run-fixer",
      "persist-fixer-transcript",
      "remove-worktree",
    ]);
    expect(persistFixerTranscriptMock).toHaveBeenCalledWith({
      identifier: "ABC-1",
      branch: "fix/ABC-1-fail",
      transcript: "[stdout]\npartial output\n[stderr]\nboom\n",
      observer: expect.any(Object),
    });
  });
});
