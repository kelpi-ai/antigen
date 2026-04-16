import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";

const {
  fetchTicketContextMock,
  verifyCheckoutMock,
  fetchCheckoutRemoteMock,
  pullCheckoutBaseBranchMock,
  createWorktreeMock,
  removeWorktreeMock,
  buildFixerPromptMock,
  runCodexTaskMock,
  persistFixerTranscriptMock,
  parseFixerResultMock,
  publishWorktreeFixMock,
} = vi.hoisted(() => ({
  fetchTicketContextMock: vi.fn(),
  verifyCheckoutMock: vi.fn(),
  fetchCheckoutRemoteMock: vi.fn(),
  pullCheckoutBaseBranchMock: vi.fn(),
  createWorktreeMock: vi.fn(),
  removeWorktreeMock: vi.fn(),
  buildFixerPromptMock: vi.fn(),
  runCodexTaskMock: vi.fn(),
  persistFixerTranscriptMock: vi.fn(),
  parseFixerResultMock: vi.fn(),
  publishWorktreeFixMock: vi.fn(),
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

vi.mock("../../src/prompts/fixer", () => ({
  buildFixerPrompt: buildFixerPromptMock,
}));

vi.mock("../../src/codex/fixer", () => ({
  runCodexTask: runCodexTaskMock,
  persistFixerTranscript: persistFixerTranscriptMock,
  parseFixerResult: parseFixerResultMock,
}));

vi.mock("../../src/git/publish", () => ({
  publishWorktreeFix: publishWorktreeFixMock,
}));

import { buildApp } from "../../src/server";
import { inngest } from "../../src/inngest/client";
import { onLinearTicket } from "../../src/inngest/functions/onLinearTicket";

const sendSpy = vi.spyOn(inngest, "send");

type LinearTicketEvent = {
  name: "linear/ticket.created";
  data: { ticketId: string; identifier: string; module: string; url: string };
};

function inngestSignature(secret: string, body: string, timestamp: string) {
  const signature = createHmac("sha256", secret).update(body).update(timestamp).digest("hex");
  return `t=${timestamp}&s=${signature}`;
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
    fetchTicketContextMock.mockReset();
    verifyCheckoutMock.mockReset();
    fetchCheckoutRemoteMock.mockReset();
    pullCheckoutBaseBranchMock.mockReset();
    createWorktreeMock.mockReset();
    removeWorktreeMock.mockReset();
    buildFixerPromptMock.mockReset();
    runCodexTaskMock.mockReset();
    persistFixerTranscriptMock.mockReset();
    parseFixerResultMock.mockReset();
    publishWorktreeFixMock.mockReset();
  });

  it("posts the webhook, executes linear flow through /api/inngest in-process", async () => {
    const app = buildApp();
    let flowResponse: Response | undefined;
    const stepOrder: string[] = [];

    const emittedEvent: LinearTicketEvent = {
      name: "linear/ticket.created",
      data: {
        ticketId: "lin-123",
        identifier: "BUG-999",
        module: "checkout",
        url: "https://linear.app/acme/issue/BUG-999",
      },
    };

    const ticket = {
      ...emittedEvent.data,
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
    verifyCheckoutMock.mockResolvedValue(undefined);
    fetchCheckoutRemoteMock.mockResolvedValue(undefined);
    pullCheckoutBaseBranchMock.mockResolvedValue(undefined);
    createWorktreeMock.mockResolvedValue({
      path: "/tmp/worktrees/BUG-999-abc",
      branch: "fix/BUG-999-abc",
    });
    buildFixerPromptMock.mockReturnValue("run final automated e2e validation and fix");
    runCodexTaskMock.mockResolvedValue({
      stdout:
        'LOG\nFIXER_RESULT {"status":"ok","testPath":"tests/fixes/bug-999.spec.ts","redEvidence":"red proof","greenEvidence":"green proof","regressionGuardEvidence":"guard proof","e2eValidationEvidence":"e2e proof"}\n',
      stderr: "",
      exitCode: 0,
      transcript: "[stdout]\ninstalling dependencies\n",
    });
    persistFixerTranscriptMock.mockResolvedValue(
      "/tmp/artifacts/fixer-transcripts/bug-999.log",
    );
    parseFixerResultMock.mockReturnValue({
      status: "ok",
      testPath: "tests/fixes/bug-999.spec.ts",
      redEvidence: "red proof",
      greenEvidence: "green proof",
      regressionGuardEvidence: "guard proof",
      e2eValidationEvidence: "e2e proof",
    });
    publishWorktreeFixMock.mockResolvedValue({
      publishUrl: "https://github.com/barun1997/antigen/compare/main...fix/BUG-999-abc?expand=1",
    });

    sendSpy.mockImplementation(async (event) => {
      const normalizedEvent = (event ?? emittedEvent) as LinearTicketEvent;
      const linearFunctionId = onLinearTicket.id("incident-loop");
      const runId = `run-${Date.now()}`;
      const ctx = {
        run_id: runId,
        attempt: 0,
      };
      const completedSteps: Record<string, { type: "data"; data: unknown }> = {};
      let response: Response = new Response("", { status: 500 });

      const invokeStep = async (stepId = "step") => {
        const bodyObj = {
          event: normalizedEvent,
          version: 1,
          events: [normalizedEvent],
          steps: completedSteps,
          ctx,
        };
        const body = JSON.stringify(bodyObj);
        const signature = inngestSignature(process.env.INNGEST_SIGNING_KEY || "", body, Math.floor(Date.now() / 1000).toString());
        const nextUrl = `/api/inngest?fnId=${linearFunctionId}&stepId=${stepId}`;
        response = await app.request(nextUrl, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-inngest-signature": signature,
          },
          body,
        });

        const bodyText = await response.text();
        if (response.status !== 206) {
          return { response, bodyText };
        }

        const operations = JSON.parse(bodyText) as Array<{
          op: string;
          id: string;
          displayName?: string;
          name?: string;
          data: unknown;
        }>;
        for (const operation of operations) {
          if (operation.op === "StepRun") {
            completedSteps[operation.id] = {
              type: "data",
              data: operation.data,
            };
            stepOrder.push(operation.displayName || operation.name || operation.id);
          }
        }

        return { response, bodyText };
      };

      let status = 206;
      let bodyText = "";
      for (let attempt = 0; attempt < 20 && status === 206; attempt += 1) {
        const result = await invokeStep();
        response = result.response;
        status = result.response.status;
        bodyText = result.bodyText;
        if (status !== 206) {
          break;
        }
        const operations = JSON.parse(bodyText) as Array<{ op: string }>;
        const hasStepRun = operations.some((operation) => operation.op === "StepRun");
        if (!hasStepRun) {
          break;
        }
      }

      flowResponse = new Response(bodyText, {
        status,
        headers: response.headers,
      });

      const eventTicketId = normalizedEvent.data.ticketId || emittedEvent.data.ticketId;
      return { ids: [eventTicketId] } as never;
    });

    const body = JSON.stringify({
      action: "create",
      type: "Issue",
      data: {
        id: emittedEvent.data.ticketId,
        identifier: emittedEvent.data.identifier,
        url: emittedEvent.data.url,
        labels: [{ name: "bug" }, { name: "module: checkout" }],
      },
    });

    const linearSignature = `sha256=${createHmac("sha256", process.env.LINEAR_WEBHOOK_SECRET ?? "").update(body).digest("hex")}`;
    const webhookResponse = await app.request("/webhooks/linear", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "linear-signature": linearSignature,
      },
      body,
    });

    expect(webhookResponse.status).toBe(202);
    expect(flowResponse).toBeDefined();
    expect([200, 206]).toContain(flowResponse!.status);
    expect(stepOrder).toEqual([
      "fetch-ticket-context",
      "verify-target-checkout",
      "fetch-target-remote",
      "pull-target-base-branch",
      "create-worktree",
      "build-prompt",
      "run-fixer",
      "persist-fixer-transcript",
      "parse-fixer-result",
      "publish-fix",
      "remove-worktree",
    ]);
    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(sendSpy).toHaveBeenCalledWith(emittedEvent);

    const [actualEvent] = sendSpy.mock.calls[0] as [LinearTicketEvent];
    expect(actualEvent).toEqual(emittedEvent);

    expect(fetchTicketContextMock).toHaveBeenCalledWith(emittedEvent.data);
    expect(verifyCheckoutMock).toHaveBeenCalledWith();
    expect(fetchCheckoutRemoteMock).toHaveBeenCalledWith();
    expect(pullCheckoutBaseBranchMock).toHaveBeenCalledWith();
    expect(createWorktreeMock).toHaveBeenCalledWith("BUG-999");
    expect(buildFixerPromptMock).toHaveBeenCalledWith({
      ticket,
      worktreePath: "/tmp/worktrees/BUG-999-abc",
      branch: "fix/BUG-999-abc",
      targetAppUrl: "http://localhost:3001",
    });
    expect(runCodexTaskMock).toHaveBeenCalledWith({
      prompt: "run final automated e2e validation and fix",
      cwd: "/tmp/worktrees/BUG-999-abc",
      observer: expect.any(Object),
    });
    expect(persistFixerTranscriptMock).toHaveBeenCalledWith({
      identifier: "BUG-999",
      branch: "fix/BUG-999-abc",
      transcript: "[stdout]\ninstalling dependencies\n",
      observer: expect.any(Object),
    });
    expect(parseFixerResultMock).toHaveBeenCalledWith(
      'LOG\nFIXER_RESULT {"status":"ok","testPath":"tests/fixes/bug-999.spec.ts","redEvidence":"red proof","greenEvidence":"green proof","regressionGuardEvidence":"guard proof","e2eValidationEvidence":"e2e proof"}\n',
    );
    expect(publishWorktreeFixMock).toHaveBeenCalledWith({
      worktreePath: "/tmp/worktrees/BUG-999-abc",
      branch: "fix/BUG-999-abc",
      ticketIdentifier: "BUG-999",
      ticketTitle: "Checkout validation bug",
    });
    expect(removeWorktreeMock).toHaveBeenCalledWith("/tmp/worktrees/BUG-999-abc");

    const fetchCall = fetchTicketContextMock.mock.invocationCallOrder[0];
    const verifyCall = verifyCheckoutMock.mock.invocationCallOrder[0];
    const fetchRemoteCall = fetchCheckoutRemoteMock.mock.invocationCallOrder[0];
    const pullCall = pullCheckoutBaseBranchMock.mock.invocationCallOrder[0];
    const worktreeCall = createWorktreeMock.mock.invocationCallOrder[0];
    const promptCall = buildFixerPromptMock.mock.invocationCallOrder[0];
    const fixerCall = runCodexTaskMock.mock.invocationCallOrder[0];
    const removeCall = removeWorktreeMock.mock.invocationCallOrder[0];

    expect(fetchCall).toBeLessThan(verifyCall);
    expect(verifyCall).toBeLessThan(fetchRemoteCall);
    expect(fetchRemoteCall).toBeLessThan(pullCall);
    expect(pullCall).toBeLessThan(worktreeCall);
    expect(worktreeCall).toBeLessThan(promptCall);
    expect(promptCall).toBeLessThan(fixerCall);
    expect(fixerCall).toBeLessThan(removeCall);
  });
});
