import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { Hono } from "hono";

const {
  fetchTicketContextMock,
  updateCheckoutMock,
  createWorktreeMock,
  removeWorktreeMock,
  buildFixerPromptMock,
  runFixerMock,
} = vi.hoisted(() => ({
  fetchTicketContextMock: vi.fn(),
  updateCheckoutMock: vi.fn(),
  createWorktreeMock: vi.fn(),
  removeWorktreeMock: vi.fn(),
  buildFixerPromptMock: vi.fn(),
  runFixerMock: vi.fn(),
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

vi.mock("../../src/prompts/fixer", () => ({
  buildFixerPrompt: buildFixerPromptMock,
}));

vi.mock("../../src/codex/fixer", () => ({
  runFixer: runFixerMock,
}));

import { mountLinearWebhook } from "../../src/webhooks/linear";
import { runLinearTicketFlow } from "../../src/inngest/functions/onLinearTicket";
import { inngest } from "../../src/inngest/client";

const sendSpy = vi.spyOn(inngest, "send");

function sign(body: string, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

function createStepRecorder() {
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

describe("linear p2 localhost flow", () => {
  beforeEach(() => {
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

    sendSpy.mockReset();
    sendSpy.mockResolvedValue(undefined as never);
    fetchTicketContextMock.mockReset();
    updateCheckoutMock.mockReset();
    createWorktreeMock.mockReset();
    removeWorktreeMock.mockReset();
    buildFixerPromptMock.mockReset();
    runFixerMock.mockReset();
  });

  it("validates webhook emission and runs runLinearTicketFlow with mocked side effects", async () => {
    const app = new Hono();
    mountLinearWebhook(app);
    const body = JSON.stringify({
      action: "create",
      type: "Issue",
      data: {
        id: "lin-123",
        identifier: "BUG-999",
        url: "https://linear.app/acme/issue/BUG-999",
        labels: [{ name: "bug" }, { name: "module: checkout" }],
      },
    });

    const res = await app.request("/webhooks/linear", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "linear-signature": sign(body, process.env.LINEAR_WEBHOOK_SECRET),
      },
      body,
    });

    expect(res.status).toBe(202);
    expect(sendSpy).toHaveBeenCalledTimes(1);
    const emittedEvent = sendSpy.mock.calls[0][0] as {
      name: "linear/ticket.created";
      data: {
        ticketId: string;
        identifier: string;
        module: string;
        url: string;
      };
    };

    expect(emittedEvent).toEqual({
      name: "linear/ticket.created",
      data: {
        ticketId: "lin-123",
        identifier: "BUG-999",
        module: "checkout",
        url: "https://linear.app/acme/issue/BUG-999",
      },
    });

    const ticket = {
      ticketId: emittedEvent.data.ticketId,
      identifier: emittedEvent.data.identifier,
      module: emittedEvent.data.module,
      url: emittedEvent.data.url,
      title: "Checkout validation bug",
      body: "Button disappears at 1366x768",
      browserVisible: true,
      similarIssueContext: "Known checkout viewport issue",
      environmentHints: {
        browser: "Chromium",
        os: "Ubuntu 22.04",
        viewport: "1366x768",
      },
    };

    fetchTicketContextMock.mockResolvedValue(ticket);
    updateCheckoutMock.mockResolvedValue(undefined);
    createWorktreeMock.mockResolvedValue({
      path: "/tmp/worktrees/BUG-999-abc",
      branch: "fix/BUG-999-abc",
    });
    buildFixerPromptMock.mockReturnValue("run final end-to-end validation and fix");
    runFixerMock.mockResolvedValue({
      status: "ok",
      prUrl: "https://example.test/pull/1",
      testPath: "tests/fixes/bug-999.spec.ts",
      redEvidence: "red proof",
      greenEvidence: "green proof",
      regressionGuardEvidence: "guard proof",
    });

    const { steps, step } = createStepRecorder();
    const result = await runLinearTicketFlow({
      event: { data: emittedEvent.data },
      step,
    });

    expect(result).toEqual({
      status: "ok",
      prUrl: "https://example.test/pull/1",
      testPath: "tests/fixes/bug-999.spec.ts",
      redEvidence: "red proof",
      greenEvidence: "green proof",
      regressionGuardEvidence: "guard proof",
    });
    expect(steps).toEqual([
      "fetch-ticket-context",
      "update-checkout",
      "create-worktree",
      "build-prompt",
      "run-fixer",
      "remove-worktree",
    ]);
    expect(fetchTicketContextMock).toHaveBeenCalledWith(emittedEvent.data);
    expect(buildFixerPromptMock).toHaveBeenCalledWith({
      ticket,
      worktreePath: "/tmp/worktrees/BUG-999-abc",
      branch: "fix/BUG-999-abc",
      targetAppUrl: "http://localhost:3001",
    });
    expect(runFixerMock).toHaveBeenCalledWith({
      prompt: "run final end-to-end validation and fix",
      cwd: "/tmp/worktrees/BUG-999-abc",
    });
    expect(removeWorktreeMock).toHaveBeenCalledWith("/tmp/worktrees/BUG-999-abc");
  });
});
