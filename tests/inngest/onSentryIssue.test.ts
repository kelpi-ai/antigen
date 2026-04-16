import { describe, it, expect, vi, beforeEach } from "vitest";

const createRunMock = vi.fn();
const launchChromeSessionMock = vi.fn();
const writeCodexConfigMock = vi.fn();
const startBrowserRecordingMock = vi.fn();
const runCodexReproducerMock = vi.fn();
const buildReproducerPromptMock = vi.fn();
const readFileMock = vi.fn();
const writeFileMock = vi.fn();

vi.mock("../../src/runs/createRun", () => ({
  createRun: (...args: unknown[]) => createRunMock(...args),
}));

vi.mock("../../src/browser/session", () => ({
  launchChromeSession: (...args: unknown[]) => launchChromeSessionMock(...args),
}));

vi.mock("../../src/codex/config", () => ({
  writeCodexConfig: (...args: unknown[]) => writeCodexConfigMock(...args),
}));

vi.mock("../../src/browser/record", () => ({
  startBrowserRecording: (...args: unknown[]) => startBrowserRecordingMock(...args),
}));

vi.mock("../../src/codex/reproducer", () => ({
  runCodexReproducer: (...args: unknown[]) => runCodexReproducerMock(...args),
}));

vi.mock("../../src/prompts/reproducer", () => ({
  buildReproducerPrompt: (...args: unknown[]) => buildReproducerPromptMock(...args),
}));

vi.mock("node:fs/promises", async () => {
  const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  return {
    ...actual,
    readFile: (...args: unknown[]) => readFileMock(...args),
    writeFile: (...args: unknown[]) => writeFileMock(...args),
  };
});

import { runSentryIssue, onSentryIssue, pickDebuggingPort } from "../../src/inngest/functions/onSentryIssue";
import { functions } from "../../src/inngest";

describe("onSentryIssue", () => {
  beforeEach(() => {
    createRunMock.mockReset();
    launchChromeSessionMock.mockReset();
    writeCodexConfigMock.mockReset();
    startBrowserRecordingMock.mockReset();
    runCodexReproducerMock.mockReset();
    buildReproducerPromptMock.mockReset();
    readFileMock.mockReset();
    writeFileMock.mockReset();

    process.env.INNGEST_EVENT_KEY = "x";
    process.env.INNGEST_SIGNING_KEY = "x";
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.TARGET_APP_URL = "http://localhost:3001";
    process.env.SENTRY_WEBHOOK_SECRET = "sentry-secret";
    process.env.LINEAR_API_KEY = "lin-api";
    process.env.ARTIFACTS_DIR = "/tmp/artifacts";
  });

  it("is registered in the barrel", () => {
    expect(functions).toContain(onSentryIssue);
  });

  it("coordinates full lifecycle, writes success metadata, and always cleans up", async () => {
    const run = {
      runId: "run-1234",
      runDir: "/tmp/run-1234",
      codexDir: "/tmp/run-1234/.codex",
      videoPath: "/tmp/run-1234/browser.mp4",
      metadataPath: "/tmp/run-1234/metadata.json",
    };
    const chromeProcessKill = vi.fn();
    const recordStop = vi.fn().mockResolvedValue(undefined);
    const existingMetadata = JSON.stringify({
      status: "created",
      sentryIssueId: "SENTRY-123",
      targetAppUrl: "http://localhost:3001",
      videoPath: run.videoPath,
    });
    const expectedPort = pickDebuggingPort(run.runId);

    createRunMock.mockResolvedValue(run);
    launchChromeSessionMock.mockResolvedValue({
      process: { kill: chromeProcessKill },
      debuggingPort: expectedPort,
      wsEndpoint: "ws://127.0.0.1:9222/devtools/browser/test",
    });
    writeCodexConfigMock.mockResolvedValue(`${run.codexDir}/config.toml`);
    startBrowserRecordingMock.mockResolvedValue({ stop: recordStop });
    buildReproducerPromptMock.mockReturnValue("prompt");
    runCodexReproducerMock.mockResolvedValue({
      status: "reproduced",
      reproduced: true,
      ticketUrl: "https://linear.app/example/ENG-1",
      summary: "example",
      finalUrl: "http://localhost:3001/checkout",
      steps: ["one"],
      expected: "expected",
      actual: "actual",
      evidence: { videoPath: run.videoPath, consoleErrors: 1, failedRequests: 0 },
    });
    readFileMock.mockResolvedValue(existingMetadata);
    writeFileMock.mockResolvedValue(undefined);

    const event = {
      data: {
        issue: {
          id: "SENTRY-123",
          title: "TypeError",
          web_url: "https://sentry.io/issues/123/",
          culprit: "checkout.applyCoupon",
          environment: "production",
          release: "app@1.4.2",
        },
      },
    };

    const result = await runSentryIssue({ event });

    expect(createRunMock).toHaveBeenCalledWith({
      artifactsRoot: "/tmp/artifacts",
      sentryIssueId: "SENTRY-123",
      targetAppUrl: "http://localhost:3001",
    });
    expect(launchChromeSessionMock).toHaveBeenCalledWith({
      chromePath: "google-chrome",
      userDataDir: "/tmp/run-1234",
      debuggingPort: expectedPort,
    });
    expect(writeCodexConfigMock).toHaveBeenCalledWith({
      codexDir: "/tmp/run-1234/.codex",
      wsEndpoint: "ws://127.0.0.1:9222/devtools/browser/test",
    });
    expect(startBrowserRecordingMock).toHaveBeenCalledWith({
      port: expectedPort,
      outputPath: "/tmp/run-1234/browser.mp4",
      ffmpegBin: "ffmpeg",
    });
    expect(buildReproducerPromptMock).toHaveBeenCalledWith({
      issue: {
        id: "SENTRY-123",
        title: "TypeError",
        permalink: "https://sentry.io/issues/123/",
        culprit: "checkout.applyCoupon",
        environment: "production",
        release: "app@1.4.2",
      },
      targetAppUrl: "http://localhost:3001",
      videoPath: "/tmp/run-1234/browser.mp4",
    });
    expect(runCodexReproducerMock).toHaveBeenCalledWith({
      prompt: "prompt",
      workingDirectory: "/tmp/run-1234",
    });
    expect(recordStop).toHaveBeenCalledTimes(1);
    expect(chromeProcessKill).toHaveBeenCalledWith("SIGKILL");
    const [, metadataArg] = writeFileMock.mock.calls[0] as [string, string];
    const nextMetadata = JSON.parse(metadataArg);
    expect(nextMetadata.status).toBe("reproduced");
    expect(nextMetadata.ticketUrl).toBe("https://linear.app/example/ENG-1");
    expect(nextMetadata.finalUrl).toBe("http://localhost:3001/checkout");
    expect(nextMetadata.videoPath).toBe("/tmp/run-1234/browser.mp4");
    expect(result).toMatchObject({ status: "reproduced", ticketUrl: "https://linear.app/example/ENG-1" });
  });

  it("still cleans up and marks failed metadata when Codex errors", async () => {
    const run = {
      runId: "run-1234",
      runDir: "/tmp/run-1234",
      codexDir: "/tmp/run-1234/.codex",
      videoPath: "/tmp/run-1234/browser.mp4",
      metadataPath: "/tmp/run-1234/metadata.json",
    };
    const chromeProcessKill = vi.fn();
    const recordStop = vi.fn().mockResolvedValue(undefined);
    const expectedPort = pickDebuggingPort(run.runId);

    createRunMock.mockResolvedValue(run);
    launchChromeSessionMock.mockResolvedValue({
      process: { kill: chromeProcessKill },
      debuggingPort: expectedPort,
      wsEndpoint: "ws://127.0.0.1:9222/devtools/browser/test",
    });
    writeCodexConfigMock.mockResolvedValue(`${run.codexDir}/config.toml`);
    startBrowserRecordingMock.mockResolvedValue({ stop: recordStop });
    buildReproducerPromptMock.mockReturnValue("prompt");
    runCodexReproducerMock.mockRejectedValue(new Error("codex failed"));
    readFileMock.mockResolvedValue(
      JSON.stringify({
        status: "created",
        sentryIssueId: "SENTRY-123",
      }),
    );
    writeFileMock.mockResolvedValue(undefined);

    const event = {
      data: {
        issue: {
          id: "SENTRY-123",
          title: "TypeError",
          web_url: "https://sentry.io/issues/123/",
          culprit: "checkout.applyCoupon",
          environment: "production",
          release: "app@1.4.2",
        },
      },
    };

    await expect(runSentryIssue({ event })).rejects.toThrow(/codex failed/);
    const [, metadataArg] = writeFileMock.mock.calls[0] as [string, string];
    const nextMetadata = JSON.parse(metadataArg);

    expect(recordStop).toHaveBeenCalled();
    expect(chromeProcessKill).toHaveBeenCalledWith("SIGKILL");
    expect(nextMetadata.status).toBe("failed");
    expect(nextMetadata.ticketUrl).toBe("");
    expect(nextMetadata.finalUrl).toBe("http://localhost:3001");
  });

  it("cleans up chrome and writes failed metadata when setup fails after launch", async () => {
    const run = {
      runId: "run-1234",
      runDir: "/tmp/run-1234",
      codexDir: "/tmp/run-1234/.codex",
      videoPath: "/tmp/run-1234/browser.mp4",
      metadataPath: "/tmp/run-1234/metadata.json",
    };
    const chromeProcessKill = vi.fn();
    const expectedPort = pickDebuggingPort(run.runId);

    createRunMock.mockResolvedValue(run);
    launchChromeSessionMock.mockResolvedValue({
      process: { kill: chromeProcessKill },
      debuggingPort: expectedPort,
      wsEndpoint: "ws://127.0.0.1:9222/devtools/browser/test",
    });
    writeCodexConfigMock.mockRejectedValue(new Error("config failed"));
    readFileMock.mockResolvedValue(
      JSON.stringify({
        status: "created",
        sentryIssueId: "SENTRY-123",
      }),
    );
    writeFileMock.mockResolvedValue(undefined);

    const event = {
      data: {
        issue: {
          id: "SENTRY-123",
          title: "TypeError",
          web_url: "https://sentry.io/issues/123/",
          culprit: "checkout.applyCoupon",
          environment: "production",
          release: "app@1.4.2",
        },
      },
    };

    await expect(runSentryIssue({ event })).rejects.toThrow(/config failed/);

    expect(chromeProcessKill).toHaveBeenCalledWith("SIGKILL");
    expect(writeFileMock).toHaveBeenCalledTimes(1);
    const [, metadataArg] = writeFileMock.mock.calls[0] as [string, string];
    const nextMetadata = JSON.parse(metadataArg);
    expect(nextMetadata.status).toBe("failed");
    expect(nextMetadata.ticketUrl).toBe("");
    expect(nextMetadata.finalUrl).toBe("http://localhost:3001");
  });
});
