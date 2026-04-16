import { describe, it, expect, vi, beforeEach } from "vitest";

const createRunMock = vi.fn();
const runCodexReproducerMock = vi.fn();
const buildReproducerPromptMock = vi.fn();
const stitchScreenshotsToVideoMock = vi.fn();
const readFileMock = vi.fn();
const writeFileMock = vi.fn();

vi.mock("../../src/runs/createRun", () => ({
  createRun: (...args: unknown[]) => createRunMock(...args),
}));

vi.mock("../../src/codex/reproducer", () => ({
  runCodexReproducer: (...args: unknown[]) => runCodexReproducerMock(...args),
}));

vi.mock("../../src/prompts/reproducer", () => ({
  buildReproducerPrompt: (...args: unknown[]) => buildReproducerPromptMock(...args),
}));

vi.mock("../../src/browser/stitch", () => ({
  stitchScreenshotsToVideo: (...args: unknown[]) => stitchScreenshotsToVideoMock(...args),
}));

vi.mock("node:fs/promises", async () => {
  const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  return {
    ...actual,
    readFile: (...args: unknown[]) => readFileMock(...args),
    writeFile: (...args: unknown[]) => writeFileMock(...args),
  };
});

import { runSentryIssue, onSentryIssue } from "../../src/inngest/functions/onSentryIssue";
import { functions } from "../../src/inngest";

describe("onSentryIssue", () => {
  beforeEach(() => {
    createRunMock.mockReset();
    runCodexReproducerMock.mockReset();
    buildReproducerPromptMock.mockReset();
    stitchScreenshotsToVideoMock.mockReset();
    readFileMock.mockReset();
    writeFileMock.mockReset();

    process.env.INNGEST_EVENT_KEY = "x";
    process.env.INNGEST_SIGNING_KEY = "x";
    process.env.TARGET_APP_URL = "http://localhost:3001";
    process.env.SENTRY_WEBHOOK_SECRET = "sentry-secret";
    process.env.LINEAR_API_KEY = "lin-api";
    process.env.ARTIFACTS_DIR = "/tmp/artifacts";
    process.env.CHROME_REMOTE_DEBUGGING_URL = "http://127.0.0.1:9222";
  });

  it("is registered in the barrel", () => {
    expect(functions).toContain(onSentryIssue);
  });

  it("coordinates full lifecycle, writes success metadata, and always cleans up", async () => {
    const run = {
      runId: "run-1234",
      runDir: "/tmp/run-1234",
      codexDir: "/tmp/run-1234/.codex",
      screenshotsDir: "/tmp/run-1234/screenshots",
      videoPath: "/tmp/run-1234/browser.mp4",
      metadataPath: "/tmp/run-1234/metadata.json",
      codexEventsPath: "/tmp/run-1234/codex-events.jsonl",
    };
    const existingMetadata = JSON.stringify({
      status: "created",
      sentryIssueId: "SENTRY-123",
      targetAppUrl: "http://localhost:3001",
      screenshotsDir: run.screenshotsDir,
      videoPath: run.videoPath,
      recording: {
        status: "pending",
        reason: "Awaiting Codex run analysis",
        openedNewPage: false,
      },
    });
    createRunMock.mockResolvedValue(run);
    buildReproducerPromptMock.mockReturnValue("prompt");
    stitchScreenshotsToVideoMock.mockResolvedValue({
      created: true,
      framePaths: ["/tmp/run-1234/screenshots/01-start.png"],
    });
    runCodexReproducerMock.mockResolvedValue({
      status: "reproduced",
      reproduced: true,
      ticketUrl: "https://linear.app/example/ENG-1",
      summary: "example",
      finalUrl: "http://localhost:3001/checkout",
      steps: ["one"],
      expected: "expected",
      actual: "actual",
      evidence: {
        videoPath: run.videoPath,
        screenshotPaths: ["/tmp/run-1234/screenshots/01-start.png"],
        consoleErrors: 1,
        failedRequests: 0,
      },
      recordingAssessment: {
        status: "verified",
        reason: "Codex stayed on the recorded page.",
        openedNewPage: false,
      },
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
      screenshotsDir: "/tmp/run-1234/screenshots",
      videoPath: "/tmp/run-1234/browser.mp4",
    });
    expect(runCodexReproducerMock).toHaveBeenCalledWith({
      prompt: "prompt",
      workingDirectory: "/tmp/run-1234",
      eventsPath: "/tmp/run-1234/codex-events.jsonl",
    });
    expect(stitchScreenshotsToVideoMock).toHaveBeenCalledWith({
      screenshotsDir: "/tmp/run-1234/screenshots",
      outputPath: "/tmp/run-1234/browser.mp4",
      ffmpegBin: "ffmpeg",
    });
    const [, metadataArg] = writeFileMock.mock.calls[0] as [string, string];
    const nextMetadata = JSON.parse(metadataArg);
    expect(nextMetadata.status).toBe("reproduced");
    expect(nextMetadata.ticketUrl).toBe("https://linear.app/example/ENG-1");
    expect(nextMetadata.finalUrl).toBe("http://localhost:3001/checkout");
    expect(nextMetadata.videoPath).toBe("/tmp/run-1234/browser.mp4");
    expect(nextMetadata.recording).toEqual({
      status: "verified",
      reason: "Codex stayed on the recorded page.",
      openedNewPage: false,
    });
    expect(result).toMatchObject({ status: "reproduced", ticketUrl: "https://linear.app/example/ENG-1" });
  });

  it("keeps live cleanup handles outside serializing step results", async () => {
    const run = {
      runId: "run-1234",
      runDir: "/tmp/run-1234",
      codexDir: "/tmp/run-1234/.codex",
      screenshotsDir: "/tmp/run-1234/screenshots",
      videoPath: "/tmp/run-1234/browser.mp4",
      metadataPath: "/tmp/run-1234/metadata.json",
      codexEventsPath: "/tmp/run-1234/codex-events.jsonl",
    };
    createRunMock.mockResolvedValue(run);
    buildReproducerPromptMock.mockReturnValue("prompt");
    stitchScreenshotsToVideoMock.mockResolvedValue({
      created: true,
      framePaths: ["/tmp/run-1234/screenshots/01-start.png"],
    });
    runCodexReproducerMock.mockResolvedValue({
      status: "reproduced",
      reproduced: true,
      ticketUrl: "https://linear.app/example/ENG-1",
      summary: "example",
      finalUrl: "http://localhost:3001/checkout",
      steps: ["one"],
      expected: "expected",
      actual: "actual",
      evidence: {
        videoPath: run.videoPath,
        screenshotPaths: ["/tmp/run-1234/screenshots/01-start.png"],
        consoleErrors: 1,
        failedRequests: 0,
      },
      recordingAssessment: {
        status: "verified",
        reason: "Codex stayed on the recorded page.",
        openedNewPage: false,
      },
    });
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

    const serializingStep = {
      run: async (_name: string, fn: () => unknown) => {
        const value = await fn();
        if (value === undefined) {
          return undefined;
        }
        return JSON.parse(JSON.stringify(value)) as unknown;
      },
    };

    const result = await runSentryIssue({ event, step: serializingStep });

    expect(result).toMatchObject({ status: "reproduced", ticketUrl: "https://linear.app/example/ENG-1" });
  });

  it("uses the configured browser without custom Codex MCP config", async () => {
    const run = {
      runId: "run-attach",
      runDir: "/tmp/run-attach",
      codexDir: "/tmp/run-attach/.codex",
      screenshotsDir: "/tmp/run-attach/screenshots",
      videoPath: "/tmp/run-attach/browser.mp4",
      metadataPath: "/tmp/run-attach/metadata.json",
      codexEventsPath: "/tmp/run-attach/codex-events.jsonl",
    };
    createRunMock.mockResolvedValue(run);
    buildReproducerPromptMock.mockReturnValue("prompt");
    stitchScreenshotsToVideoMock.mockResolvedValue({
      created: true,
      framePaths: ["/tmp/run-attach/screenshots/01-start.png"],
    });
    runCodexReproducerMock.mockResolvedValue({
      status: "reproduced",
      reproduced: true,
      ticketUrl: "https://linear.app/example/ENG-2",
      summary: "example",
      finalUrl: "file:///tmp/index.html",
      steps: ["one"],
      expected: "expected",
      actual: "actual",
      evidence: {
        videoPath: run.videoPath,
        screenshotPaths: ["/tmp/run-attach/screenshots/01-start.png"],
        consoleErrors: 0,
        failedRequests: 0,
      },
      recordingAssessment: {
        status: "verified",
        reason: "Codex stayed on the recorded page.",
        openedNewPage: false,
      },
    });
    readFileMock.mockResolvedValue(
      JSON.stringify({
        status: "created",
        sentryIssueId: "SENTRY-123",
        targetAppUrl: "http://localhost:3001",
        videoPath: run.videoPath,
      }),
    );
    writeFileMock.mockResolvedValue(undefined);

    const result = await runSentryIssue({
      event: {
        data: {
          issue: {
            id: "SENTRY-123",
            title: "TypeError",
            web_url: "https://sentry.io/issues/123/",
          },
        },
      },
    });

    expect(result).toMatchObject({
      status: "reproduced",
      ticketUrl: "https://linear.app/example/ENG-2",
    });
  });

  it("does not need a remote debugging url just to run Codex", async () => {
    const run = {
      runId: "run-default-port",
      runDir: "/tmp/run-default-port",
      codexDir: "/tmp/run-default-port/.codex",
      screenshotsDir: "/tmp/run-default-port/screenshots",
      videoPath: "/tmp/run-default-port/browser.mp4",
      metadataPath: "/tmp/run-default-port/metadata.json",
      codexEventsPath: "/tmp/run-default-port/codex-events.jsonl",
    };
    delete process.env.CHROME_REMOTE_DEBUGGING_URL;
    createRunMock.mockResolvedValue(run);
    buildReproducerPromptMock.mockReturnValue("prompt");
    stitchScreenshotsToVideoMock.mockResolvedValue({
      created: true,
      framePaths: ["/tmp/run-default-port/screenshots/01-start.png"],
    });
    runCodexReproducerMock.mockResolvedValue({
      status: "reproduced",
      reproduced: true,
      ticketUrl: "https://linear.app/example/ENG-3",
      summary: "example",
      finalUrl: "file:///tmp/index.html",
      steps: ["one"],
      expected: "expected",
      actual: "actual",
      evidence: {
        videoPath: run.videoPath,
        screenshotPaths: ["/tmp/run-default-port/screenshots/01-start.png"],
        consoleErrors: 0,
        failedRequests: 0,
      },
      recordingAssessment: {
        status: "verified",
        reason: "Codex stayed on the recorded page.",
        openedNewPage: false,
      },
    });
    readFileMock.mockResolvedValue(
      JSON.stringify({
        status: "created",
        sentryIssueId: "SENTRY-123",
        targetAppUrl: "http://localhost:3001",
        videoPath: run.videoPath,
      }),
    );
    writeFileMock.mockResolvedValue(undefined);

    await runSentryIssue({
      event: {
        data: {
          issue: {
            id: "SENTRY-123",
            title: "TypeError",
            web_url: "https://sentry.io/issues/123/",
          },
        },
      },
    });

    expect(buildReproducerPromptMock).toHaveBeenCalled();
  });

  it("emits Codex milestone steps into the Inngest trace after run-codex", async () => {
    const run = {
      runId: "run-1234",
      runDir: "/tmp/run-1234",
      codexDir: "/tmp/run-1234/.codex",
      screenshotsDir: "/tmp/run-1234/screenshots",
      videoPath: "/tmp/run-1234/browser.mp4",
      metadataPath: "/tmp/run-1234/metadata.json",
      codexEventsPath: "/tmp/run-1234/codex-events.jsonl",
    };
    const stepNames: string[] = [];

    createRunMock.mockResolvedValue(run);
    buildReproducerPromptMock.mockReturnValue("prompt");
    stitchScreenshotsToVideoMock.mockResolvedValue({
      created: true,
      framePaths: ["/tmp/run-1234/screenshots/01-start.png"],
    });
    runCodexReproducerMock.mockResolvedValue({
      status: "reproduced",
      reproduced: true,
      ticketUrl: "https://linear.app/example/ENG-1",
      summary: "example",
      finalUrl: "http://localhost:3001/checkout",
      steps: ["one"],
      expected: "expected",
      actual: "actual",
      evidence: {
        videoPath: run.videoPath,
        screenshotPaths: ["/tmp/run-1234/screenshots/01-start.png"],
        consoleErrors: 1,
        failedRequests: 0,
      },
      recordingAssessment: {
        status: "suspect",
        reason: "Codex opened a new page, so the saved video may not include the full reproduction.",
        openedNewPage: true,
      },
      milestones: [
        {
          stepName: "codex-sentry-issue",
          summary: "Codex fetched Sentry issue details",
          server: "sentry-bubble-reel",
          tool: "get_sentry_resource",
        },
        {
          stepName: "codex-browser-reproduction",
          summary: "Codex replayed the browser flow in Chrome DevTools",
          server: "chrome-devtools",
          tool: "take_snapshot",
        },
      ],
    });
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

    const serializingStep = {
      run: async (name: string, fn: () => unknown) => {
        stepNames.push(name);
        const value = await fn();
        if (value === undefined) {
          return undefined;
        }
        return JSON.parse(JSON.stringify(value)) as unknown;
      },
    };

    await runSentryIssue({ event, step: serializingStep });

    expect(stepNames).toEqual(
      expect.arrayContaining([
        "run-codex",
        "codex-sentry-issue",
        "codex-browser-reproduction",
        "codex-recording-integrity",
        "build-run-video",
      ]),
    );
  });

  it("still cleans up and marks failed metadata when Codex errors", async () => {
    const run = {
      runId: "run-1234",
      runDir: "/tmp/run-1234",
      codexDir: "/tmp/run-1234/.codex",
      screenshotsDir: "/tmp/run-1234/screenshots",
      videoPath: "/tmp/run-1234/browser.mp4",
      metadataPath: "/tmp/run-1234/metadata.json",
      codexEventsPath: "/tmp/run-1234/codex-events.jsonl",
    };
    createRunMock.mockResolvedValue(run);
    buildReproducerPromptMock.mockReturnValue("prompt");
    stitchScreenshotsToVideoMock.mockResolvedValue({
      created: false,
      framePaths: [],
    });
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

    expect(nextMetadata.status).toBe("failed");
    expect(nextMetadata.ticketUrl).toBe("");
    expect(nextMetadata.finalUrl).toBe("http://localhost:3001");
  });

  it("writes failed metadata when prompt building fails", async () => {
    const run = {
      runId: "run-1234",
      runDir: "/tmp/run-1234",
      codexDir: "/tmp/run-1234/.codex",
      screenshotsDir: "/tmp/run-1234/screenshots",
      videoPath: "/tmp/run-1234/browser.mp4",
      metadataPath: "/tmp/run-1234/metadata.json",
      codexEventsPath: "/tmp/run-1234/codex-events.jsonl",
    };
    createRunMock.mockResolvedValue(run);
    buildReproducerPromptMock.mockImplementation(() => {
      throw new Error("prompt failed");
    });
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

    await expect(runSentryIssue({ event })).rejects.toThrow(/prompt failed/);

    expect(writeFileMock).toHaveBeenCalledTimes(1);
    const [, metadataArg] = writeFileMock.mock.calls[0] as [string, string];
    const nextMetadata = JSON.parse(metadataArg);
    expect(nextMetadata.status).toBe("failed");
    expect(nextMetadata.ticketUrl).toBe("");
    expect(nextMetadata.finalUrl).toBe("http://localhost:3001");
  });
});
