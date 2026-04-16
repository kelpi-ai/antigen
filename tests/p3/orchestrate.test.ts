import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runPrHunter } from "../../src/p3/orchestrate";
import type { ReadyForReviewEvent } from "../../src/p3/contracts";
import type { ChildProcess } from "node:child_process";
import { invokeCodex } from "../../src/codex/invoke";
import { createHuntRun, createScenarioWorkspace, updateHuntRunMetadata } from "../../src/p3/run";
import { launchChromeSession } from "../../src/p3/browser/session";
import { writeCodexConfig } from "../../src/p3/codex/config";
import * as policy from "../../src/p3/policy";

const readyEvent: ReadyForReviewEvent = {
  prNumber: 123,
  repo: "acme/app",
  prUrl: "https://github.com/acme/app/pull/123",
  headSha: "head-sha",
  baseSha: "base-sha",
};

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

describe("runPrHunter", () => {
  const step: { run: (...args: any[]) => Promise<unknown> } = {
    run: vi.fn(async (_name: string, fn: () => unknown) => fn()) as unknown as (
      ...args: any[]
    ) => Promise<unknown>,
  };

  beforeEach(() => {
    process.env.INNGEST_EVENT_KEY = "test-key";
    process.env.INNGEST_SIGNING_KEY = "test-signing";
    process.env.CODEX_BIN = "/usr/local/bin/codex";
    process.env.GITHUB_WEBHOOK_SECRET = "gh-secret";
    process.env.CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
    process.env.ARTIFACTS_DIR = ".incident-loop-artifacts";
    process.env.MAX_SCENARIOS_PER_PR = "2";
    process.env.P3_EXECUTOR_CONCURRENCY = "2";

    vi.mocked(createHuntRun).mockReset().mockResolvedValue({
      runId: "run-123",
      runDir: "/tmp/run-123",
      metadataPath: "/tmp/run-123/metadata.json",
    });
    vi.mocked(createScenarioWorkspace).mockReset();
    vi.mocked(updateHuntRunMetadata).mockReset();
    vi.mocked(invokeCodex).mockReset();
    vi.mocked(launchChromeSession).mockReset();
    vi.mocked(writeCodexConfig).mockReset();
    vi
      .mocked(step.run)
      .mockReset()
      .mockImplementation(async (_name: string, fn: () => unknown) => fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls reducer directly when planner preview URL is missing", async () => {
    vi.mocked(invokeCodex)
      .mockResolvedValueOnce({
        stdout: 'garbage\nP3_PLANNER_JSON {"previewUrl":null,"scenarios":[]}\n',
        stderr: "",
        exitCode: 0,
      })
      .mockResolvedValueOnce({
        stdout: 'P3_REDUCER_JSON {"status":"skipped","prComment":"No preview URL available.","investigationTickets":[]}\n',
        stderr: "",
        exitCode: 0,
      });

    const result = await runPrHunter({ event: readyEvent, step });

    expect(result.status).toBe("skipped");
    expect(invokeCodex).toHaveBeenCalledTimes(2);
    expect(createScenarioWorkspace).not.toHaveBeenCalled();
    expect(launchChromeSession).not.toHaveBeenCalled();
    expect(writeCodexConfig).not.toHaveBeenCalled();
    expect(updateHuntRunMetadata).toHaveBeenCalledWith(
      "/tmp/run-123/metadata.json",
      expect.objectContaining({
        status: "skipped",
        previewUrl: null,
        credibleFailureCount: 0,
      }),
    );
  });

  it("runs executors and kills Chrome after each run", async () => {
    const runConcurrency = vi.spyOn(policy, "runWithConcurrencyLimit");
    const enforceScenario = vi.spyOn(policy, "ensureExecutableScenario");
    const selectScenarios = vi.spyOn(policy, "selectTopScenarios");

    const firstKill = vi.fn();
    const secondKill = vi.fn();
    vi.mocked(launchChromeSession).mockResolvedValueOnce({
      process: { kill: firstKill } as unknown as ChildProcess,
      debuggingPort: 9333,
      wsEndpoint: "ws://127.0.0.1:9333/devtools/browser/test",
    }).mockResolvedValueOnce({
      process: { kill: secondKill } as unknown as ChildProcess,
      debuggingPort: 9333,
      wsEndpoint: "ws://127.0.0.1:9333/devtools/browser/test",
    });

    vi.mocked(createScenarioWorkspace).mockImplementation(
      async ({ runDir, scenarioId }) => ({
        scenarioDir: `${runDir}/scenarios/${scenarioId}`,
        codexDir: `${runDir}/scenarios/${scenarioId}/.codex`,
        profileDir: `${runDir}/scenarios/${scenarioId}/profile`,
        screenshotPath: `${runDir}/scenarios/${scenarioId}/failure.png`,
      }),
    );

    vi.mocked(invokeCodex)
      .mockResolvedValueOnce({
        stdout:
          'P3_PLANNER_JSON {"previewUrl":"https://preview.example","scenarios":[{"id":"checkout-coupon","summary":"coupon flow","rationale":"risk","targetArea":"checkout","risk":"high","mode":"read_safe","guardrails":[],"expectedEvidence":["consoleSignals"]},{"id":"account-check","summary":"account flow","rationale":"risk","targetArea":"account","risk":"medium","mode":"mutating","guardrails":["use a seeded account"],"expectedEvidence":["networkSignals"]}]}',
        stderr: "",
        exitCode: 0,
      })
      .mockResolvedValueOnce({
        stdout:
          'P3_EXECUTOR_JSON {"scenarioId":"checkout-coupon","outcome":"failed","summary":"checkout failure","consoleSignals":["oops"],"networkSignals":[],"evidence":["TypeError"],"screenshotPath":"/tmp/run-123/scenarios/checkout-coupon/failure.png"}',
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
          'P3_REDUCER_JSON {"status":"failures","prComment":"One failed scenario","investigationTickets":[{"action":"create","title":"Regression","body":"investigate"}]}',
        stderr: "",
        exitCode: 0,
      });

    const result = await runPrHunter({ event: readyEvent, step });

    expect(result.status).toBe("failures");
    expect(selectScenarios).toHaveBeenCalledWith(
      expect.any(Array),
      2,
    );
    expect(enforceScenario).toHaveBeenCalledTimes(2);
    expect(runConcurrency).toHaveBeenCalledWith(
      expect.any(Array),
      2,
      expect.any(Function),
    );
    expect(createScenarioWorkspace).toHaveBeenCalledTimes(2);
    expect(launchChromeSession).toHaveBeenCalledTimes(2);
    expect(writeCodexConfig).toHaveBeenCalledTimes(2);
    expect(vi.mocked(invokeCodex)).toHaveBeenCalledTimes(4);
    expect(updateHuntRunMetadata).toHaveBeenCalledWith(
      "/tmp/run-123/metadata.json",
      expect.objectContaining({
        status: "failures",
        previewUrl: "https://preview.example",
        credibleFailureCount: 1,
      }),
    );

    expect(firstKill).toHaveBeenCalledTimes(1);
    expect(secondKill).toHaveBeenCalledTimes(1);
  });

  it("kills Chrome if executor parsing fails", async () => {
    const kill = vi.fn();
    vi.mocked(launchChromeSession).mockResolvedValue({
      process: { kill } as unknown as ChildProcess,
      debuggingPort: 9333,
      wsEndpoint: "ws://127.0.0.1:9333/devtools/browser/test",
    });

    vi.mocked(createScenarioWorkspace).mockResolvedValue({
      scenarioDir: "/tmp/run-123/scenarios/checkout-coupon",
      codexDir: "/tmp/run-123/scenarios/checkout-coupon/.codex",
      profileDir: "/tmp/run-123/scenarios/checkout-coupon/profile",
      screenshotPath: "/tmp/run-123/scenarios/checkout-coupon/failure.png",
    });

    vi.mocked(invokeCodex)
      .mockResolvedValueOnce({
        stdout:
          'P3_PLANNER_JSON {"previewUrl":"https://preview.example","scenarios":[{"id":"checkout-coupon","summary":"coupon flow","rationale":"risk","targetArea":"checkout","risk":"high","mode":"read_safe","guardrails":[],"expectedEvidence":["consoleSignals"]}]}',
        stderr: "",
        exitCode: 0,
      })
      .mockResolvedValueOnce({
        stdout: "not-json-output",
        stderr: "",
        exitCode: 0,
      });

    await expect(runPrHunter({ event: readyEvent, step })).rejects.toThrow(/P3_EXECUTOR_JSON/);
    expect(kill).toHaveBeenCalledTimes(1);
  });
});
