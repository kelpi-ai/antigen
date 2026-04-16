import { describe, expect, it, vi, beforeEach } from "vitest";

const {
  buildFixerPromptMock,
  fetchTicketContextMock,
  updateCheckoutMock,
  createWorktreeMock,
  removeWorktreeMock,
  runFixerMock,
} = vi.hoisted(() => ({
  buildFixerPromptMock: vi.fn(),
  fetchTicketContextMock: vi.fn(),
  updateCheckoutMock: vi.fn(),
  createWorktreeMock: vi.fn(),
  removeWorktreeMock: vi.fn(),
  runFixerMock: vi.fn(),
}));

vi.mock("../../src/prompts/fixer", () => ({
  buildFixerPrompt: buildFixerPromptMock,
}));

vi.mock("../../src/linear/fetchTicketContext", () => ({
  fetchTicketContext: fetchTicketContextMock,
}));

vi.mock("../../src/git/updateCheckout", () => ({
  updateCheckout: updateCheckoutMock,
}));

vi.mock("../../src/git/worktree", () => ({
  createWorktree: createWorktreeMock,
  removeWorktree: removeWorktreeMock,
}));

vi.mock("../../src/codex/fixer", () => ({
  runFixer: runFixerMock,
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
    updateCheckoutMock.mockReset();
    createWorktreeMock.mockReset();
    buildFixerPromptMock.mockReset();
    removeWorktreeMock.mockReset();
    runFixerMock.mockReset();
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
    };

    fetchTicketContextMock.mockResolvedValue(ticketContext);
    updateCheckoutMock.mockResolvedValue(undefined);
    createWorktreeMock.mockResolvedValue({
      path: "/tmp/wt/ABC-1-abcd",
      branch: "fix/ABC-1-abcd",
    });
    buildFixerPromptMock.mockReturnValue("prompt-body");
    runFixerMock.mockResolvedValue(result);

    const actual = await runLinearTicketFlow({
      event: { data: ticket },
      step,
    });

    expect(actual).toEqual(result);
    expect(steps).toEqual([
      "fetch-ticket-context",
      "update-checkout",
      "create-worktree",
      "build-prompt",
      "run-fixer",
      "remove-worktree",
    ]);
    expect(buildFixerPromptMock).toHaveBeenCalledWith(
      expect.objectContaining({ targetAppUrl: "http://localhost:3001" }),
    );
    expect(removeWorktreeMock).toHaveBeenCalledWith("/tmp/wt/ABC-1-abcd");
    expect(runFixerMock).toHaveBeenCalledWith(
      {
        prompt: "prompt-body",
        cwd: "/tmp/wt/ABC-1-abcd",
      },
    );
  });

  it("does not create or remove worktree if checkout refresh fails", async () => {
    const { steps, step } = createStepRecorder();

    fetchTicketContextMock.mockResolvedValue(ticketContext);
    updateCheckoutMock.mockRejectedValue(new Error("cannot refresh"));

    await expect(
      runLinearTicketFlow({ event: { data: ticket }, step }),
    ).rejects.toThrow(/cannot refresh/);

    expect(steps).toEqual(["fetch-ticket-context", "update-checkout"]);
    expect(createWorktreeMock).not.toHaveBeenCalled();
    expect(removeWorktreeMock).not.toHaveBeenCalled();
  });

  it("always removes the worktree when fixer fails", async () => {
    const { steps, step } = createStepRecorder();

    fetchTicketContextMock.mockResolvedValue(ticketContext);
    updateCheckoutMock.mockResolvedValue(undefined);
    createWorktreeMock.mockResolvedValue({
      path: "/tmp/wt/ABC-1-efgh",
      branch: "fix/ABC-1-efgh",
    });
    runFixerMock.mockRejectedValue(new Error("fixer failed"));

    await expect(
      runLinearTicketFlow({ event: { data: ticket }, step }),
    ).rejects.toThrow(/fixer failed/);

    expect(steps).toEqual([
      "fetch-ticket-context",
      "update-checkout",
      "create-worktree",
      "build-prompt",
      "run-fixer",
      "remove-worktree",
    ]);
    expect(removeWorktreeMock).toHaveBeenCalledWith("/tmp/wt/ABC-1-efgh");
  });

  it("removes the worktree when prompt generation fails", async () => {
    const { steps, step } = createStepRecorder();

    fetchTicketContextMock.mockResolvedValue(ticketContext);
    updateCheckoutMock.mockResolvedValue(undefined);
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
      "update-checkout",
      "create-worktree",
      "build-prompt",
      "remove-worktree",
    ]);
    expect(removeWorktreeMock).toHaveBeenCalledWith("/tmp/wt/ABC-1-ijkl");
  });

  it("keeps the original failure when cleanup also fails", async () => {
    const { steps, step } = createStepRecorder();

    fetchTicketContextMock.mockResolvedValue(ticketContext);
    updateCheckoutMock.mockResolvedValue(undefined);
    createWorktreeMock.mockResolvedValue({
      path: "/tmp/wt/ABC-1-mnop",
      branch: "fix/ABC-1-mnop",
    });
    buildFixerPromptMock.mockResolvedValue("prompt-body");
    runFixerMock.mockRejectedValue(new Error("fixer failed"));
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
      "update-checkout",
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
    };

    fetchTicketContextMock.mockResolvedValue(ticketContext);
    updateCheckoutMock.mockResolvedValue(undefined);
    createWorktreeMock.mockResolvedValue({
      path: "/tmp/wt/ABC-1-mnop",
      branch: "fix/ABC-1-mnop",
    });
    buildFixerPromptMock.mockReturnValue("prompt-body");
    runFixerMock.mockResolvedValue(result);
    removeWorktreeMock.mockRejectedValue(new Error("cleanup failed"));

    await expect(
      runLinearTicketFlow({ event: { data: ticket }, step }),
    ).rejects.toThrow(/cleanup failed/);

    expect(steps).toEqual([
      "fetch-ticket-context",
      "update-checkout",
      "create-worktree",
      "build-prompt",
      "run-fixer",
      "remove-worktree",
    ]);
    expect(removeWorktreeMock).toHaveBeenCalledWith("/tmp/wt/ABC-1-mnop");
  });
});
