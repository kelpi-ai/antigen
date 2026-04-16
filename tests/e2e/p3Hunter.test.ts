import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildApp } from "../../src/server";
import { inngest } from "../../src/inngest/client";
import { onPrReadyForReview } from "../../src/inngest/functions/onPrReadyForReview";
import { invokeCodex } from "../../src/codex/invoke";
import { createHuntRun, createScenarioWorkspace, updateHuntRunMetadata } from "../../src/p3/run";
import { launchChromeSession } from "../../src/p3/browser/session";
import { writeCodexConfig } from "../../src/p3/codex/config";

vi.mock("../../src/codex/invoke", () => ({
  invokeCodex: vi.fn(),
}));

vi.mock("../../src/p3/run", () => ({
  createHuntRun: vi.fn(),
  createScenarioWorkspace: vi.fn(),
  updateHuntRunMetadata: vi.fn(),
}));

vi.mock("../../src/p3/browser/session", () => ({
  launchChromeSession: vi.fn(),
}));

vi.mock("../../src/p3/codex/config", () => ({
  writeCodexConfig: vi.fn(),
}));

function sign(body: string, secret: string): string {
  return "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
}

function inngestSignature(secret: string, body: string, timestamp: string) {
  const signature = createHmac("sha256", secret).update(body).update(timestamp).digest("hex");
  return `t=${timestamp}&s=${signature}`;
}

type ReadyForReviewEvent = {
  name: "github/pr.ready_for_review";
  data: {
    prNumber: number;
    repo: string;
    prUrl: string;
    headSha: string;
    baseSha: string;
  };
};

describe("p3 hunter e2e", () => {
  const sendSpy = vi.spyOn(inngest, "send");
  const capturedEvents: unknown[] = [];

  beforeEach(() => {
    process.env.INNGEST_EVENT_KEY = "test-key";
    process.env.INNGEST_SIGNING_KEY = "test-signing";
    process.env.CODEX_BIN = "/usr/local/bin/codex";
    process.env.GITHUB_WEBHOOK_SECRET = "test-secret";
    process.env.CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
    process.env.ARTIFACTS_DIR = ".incident-loop-artifacts";
    process.env.MAX_SCENARIOS_PER_PR = "2";
    process.env.P3_EXECUTOR_CONCURRENCY = "2";

    capturedEvents.length = 0;
    vi.clearAllMocks();
    sendSpy.mockImplementation(async (event) => {
      capturedEvents.push(event);
      return [{ id: "event-1" }] as never;
    });

    vi.mocked(createHuntRun).mockResolvedValue({
      runId: "run-123",
      runDir: "/tmp/run-123",
      metadataPath: "/tmp/run-123/metadata.json",
    });

    vi.mocked(createScenarioWorkspace).mockImplementation(async ({ runDir, scenarioId }) => ({
      scenarioDir: `${runDir}/scenarios/${scenarioId}`,
      codexDir: `${runDir}/scenarios/${scenarioId}/.codex`,
      profileDir: `${runDir}/scenarios/${scenarioId}/profile`,
      screenshotPath: `${runDir}/scenarios/${scenarioId}/failure.png`,
    }));

    vi.mocked(launchChromeSession).mockResolvedValue({
      process: { kill: vi.fn() } as never,
      debuggingPort: 9333,
      wsEndpoint: "ws://127.0.0.1:9333/devtools/browser/test",
    });

    vi.mocked(writeCodexConfig).mockResolvedValue("/tmp/run-123/.codex/config.toml");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("drives the ready_for_review webhook through /api/inngest and the hunter orchestration path", async () => {
    vi.mocked(invokeCodex)
      .mockResolvedValueOnce({
        stdout:
          'P3_PLANNER_JSON {"previewUrl":"https://preview.example","scenarios":[{"id":"checkout-coupon","summary":"checkout flow","rationale":"risk","targetArea":"checkout","risk":"high","mode":"read_safe","guardrails":[],"expectedEvidence":["consoleSignals"]},{"id":"account-check","summary":"account flow","rationale":"risk","targetArea":"account","risk":"medium","mode":"read_safe","guardrails":["sessionless"],"expectedEvidence":["networkSignals"]}]}',
        stderr: "",
        exitCode: 0,
      })
      .mockResolvedValueOnce({
        stdout:
          'P3_EXECUTOR_JSON {"scenarioId":"checkout-coupon","outcome":"failed","summary":"checkout failure","consoleSignals":["error"],"networkSignals":[],"evidence":["TypeError"],"screenshotPath":"/tmp/run-123/scenarios/checkout-coupon/failure.png"}',
        stderr: "",
        exitCode: 0,
      })
      .mockResolvedValueOnce({
        stdout:
          'P3_EXECUTOR_JSON {"scenarioId":"account-check","outcome":"passed","summary":"account passed","consoleSignals":[],"networkSignals":[],"evidence":[],"screenshotPath":"/tmp/run-123/scenarios/account-check/failure.png"}',
        stderr: "",
        exitCode: 0,
      })
      .mockResolvedValueOnce({
        stdout:
          'P3_REDUCER_JSON {"status":"failures","prComment":"One scenario failed","investigationTickets":[{"action":"create","title":"Regression detected","body":"Investigate checkout failure"}]}',
        stderr: "",
        exitCode: 0,
      });

    const app = buildApp();
    let flowResponse: Response | undefined;
    const stepOrder: string[] = [];
    const payload = {
      action: "ready_for_review",
      number: 123,
      pull_request: {
        html_url: "https://github.com/acme/app/pull/123",
        head: { sha: "head-sha" },
        base: { sha: "base-sha" },
      },
      repository: {
        full_name: "acme/app",
      },
    };
    const body = JSON.stringify(payload);
    const emittedEvent: ReadyForReviewEvent = {
      name: "github/pr.ready_for_review",
      data: {
        prNumber: 123,
        repo: "acme/app",
        prUrl: "https://github.com/acme/app/pull/123",
        headSha: "head-sha",
        baseSha: "base-sha",
      },
    };

    sendSpy.mockImplementation(async (event) => {
      const normalizedEvent = (event ?? emittedEvent) as ReadyForReviewEvent;
      capturedEvents.push(normalizedEvent);

      const functionId = onPrReadyForReview.id("incident-loop");
      const ctx = {
        run_id: `run-${Date.now()}`,
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
        const requestBody = JSON.stringify(bodyObj);
        const signature = inngestSignature(
          process.env.INNGEST_SIGNING_KEY || "",
          requestBody,
          Math.floor(Date.now() / 1000).toString(),
        );
        const nextUrl = `/api/inngest?fnId=${functionId}&stepId=${stepId}`;
        response = await app.request(nextUrl, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-inngest-signature": signature,
          },
          body: requestBody,
        });

        const bodyText = await response.text();
        if (response.status !== 206) {
          return { response, bodyText, operations: [] as Array<{ op: string; id: string; displayName?: string; name?: string; data: unknown }> };
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

        return { response, bodyText, operations };
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

        let operations = result.operations;
        let plannedSteps = operations.filter((operation) => operation.op === "StepPlanned");
        while (status === 206 && plannedSteps.length > 0) {
          for (const plannedStep of plannedSteps) {
            const plannedResult = await invokeStep(plannedStep.id);
            response = plannedResult.response;
            status = plannedResult.response.status;
            bodyText = plannedResult.bodyText;
            operations = plannedResult.operations;
            if (status !== 206) {
              break;
            }
          }

          if (status !== 206) {
            break;
          }

          plannedSteps = operations.filter((operation) => operation.op === "StepPlanned");
        }

        const hasProgress = operations.some(
          (operation) => operation.op === "StepRun" || operation.op === "StepPlanned",
        );
        if (!hasProgress) {
          break;
        }
      }

      flowResponse = new Response(bodyText, {
        status,
        headers: response.headers,
      });

      return [{ id: "event-1" }] as never;
    });

    const response = await app.request("/webhooks/github", {
      method: "POST",
      headers: {
        "x-github-event": "pull_request",
        "x-hub-signature-256": sign(body, "test-secret"),
      },
      body,
    });

    expect(response.status).toBe(202);
    expect(flowResponse).toBeDefined();
    expect([200, 206]).toContain(flowResponse!.status);
    expect(capturedEvents).toHaveLength(1);

    const eventEnvelope = capturedEvents[0];
    expect(eventEnvelope).toMatchObject({
      name: "github/pr.ready_for_review",
      data: {
        prNumber: 123,
        repo: "acme/app",
        prUrl: "https://github.com/acme/app/pull/123",
        headSha: "head-sha",
        baseSha: "base-sha",
      },
    });
    expect(stepOrder).toEqual([
      "create-run",
      "run-planner",
      "run-executor:checkout-coupon",
      "run-executor:account-check",
      "run-reducer",
      "update-metadata",
    ]);

    expect(vi.mocked(invokeCodex)).toHaveBeenCalledTimes(4);
    expect(vi.mocked(createHuntRun)).toHaveBeenCalledOnce();
    expect(vi.mocked(createScenarioWorkspace)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(launchChromeSession)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(writeCodexConfig)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(updateHuntRunMetadata)).toHaveBeenCalledWith(
      "/tmp/run-123/metadata.json",
      expect.objectContaining({
        status: "failures",
        previewUrl: "https://preview.example",
        credibleFailureCount: 1,
      }),
    );
  });
});
