import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { inngest } from "../client";
import { env } from "../../config/env";
import { buildReproducerPrompt, type ReproducerIssueContext } from "../../prompts/reproducer";
import { createRun } from "../../runs/createRun";
import { launchChromeSession, type ChromeSession } from "../../browser/session";
import { startBrowserRecording, type BrowserRecording } from "../../browser/record";
import { writeCodexConfig } from "../../codex/config";
import { runCodexReproducer, type ReproducerResult } from "../../codex/reproducer";

interface SentryIssue {
  id: string;
  title?: string;
  web_url?: string;
  permalink?: string;
  culprit?: string;
  environment?: string;
  release?: string;
}

interface StepRunner {
  run(name: string, fn: () => unknown): Promise<unknown>;
}

interface SentryIssueEvent {
  data: {
    issue?: SentryIssue;
  };
}

interface LifecycleDeps {
  event: SentryIssueEvent;
  step?: StepRunner;
}

function stepRun<T>(step: StepRunner | undefined, name: string, fn: () => Promise<T> | T): Promise<T> {
  if (!step) {
    return Promise.resolve().then(fn) as Promise<T>;
  }

  return step.run(name, fn) as Promise<T>;
}

export function pickDebuggingPort(runId: string): number {
  const hash = createHash("sha1").update(runId).digest("hex");
  const short = Number.parseInt(hash.slice(0, 8), 16);
  return 9222 + (Number.isNaN(short) ? 0 : short % 1000);
}

function asError(value: unknown): Error {
  if (value instanceof Error) {
    return value;
  }
  return new Error(String(value));
}

function mapIssueForPrompt(issue: SentryIssue): ReproducerIssueContext {
  return {
    id: issue.id,
    title: issue.title ?? "",
    permalink: issue.permalink ?? issue.web_url ?? "",
    culprit: issue.culprit ?? "",
    environment: issue.environment ?? "",
    release: issue.release ?? "",
  };
}

async function updateRunMetadata(input: {
  metadataPath: string;
  status: string;
  ticketUrl: string;
  finalUrl: string;
  videoPath: string;
}): Promise<void> {
  const rawMetadata = await readFile(input.metadataPath, "utf8");
  const existing = JSON.parse(rawMetadata);
  const next = {
    ...existing,
    status: input.status,
    ticketUrl: input.ticketUrl,
    finalUrl: input.finalUrl,
    videoPath: input.videoPath,
  };

  await writeFile(input.metadataPath, JSON.stringify(next, null, 2));
}

export async function runSentryIssue(input: LifecycleDeps): Promise<ReproducerResult> {
  const { event, step } = input;
  if (!event.data?.issue) {
    throw new Error("Sentry issue payload missing required issue data");
  }

  const issue = event.data.issue;

  const run = await stepRun(step, "create-run", () =>
    createRun({
      artifactsRoot: env.ARTIFACTS_DIR,
      sentryIssueId: issue.id,
      targetAppUrl: env.TARGET_APP_URL,
    }),
  );

  let chrome: ChromeSession | null = null;
  let recording: BrowserRecording | null = null;
  let runResult: ReproducerResult | null = null;
  let failure: Error | null = null;
  const cleanupErrors: Error[] = [];

  try {
    const launchedChrome = await stepRun(step, "launch-chrome", () =>
      launchChromeSession({
        chromePath: env.CHROME_PATH ?? "google-chrome",
        userDataDir: run.runDir,
        debuggingPort: pickDebuggingPort(run.runId),
      }),
    );
    chrome = launchedChrome;

    await stepRun(step, "write-codex-config", () =>
      writeCodexConfig({
        codexDir: run.codexDir,
        wsEndpoint: launchedChrome.wsEndpoint,
      }),
    );

    recording = await stepRun(step, "start-recording", () =>
      startBrowserRecording({
        port: launchedChrome.debuggingPort,
        outputPath: run.videoPath,
        ffmpegBin: env.FFMPEG_BIN ?? "ffmpeg",
      }),
    );

    const prompt = buildReproducerPrompt({
      issue: mapIssueForPrompt(issue),
      targetAppUrl: env.TARGET_APP_URL,
      videoPath: run.videoPath,
    });

    runResult = await stepRun(step, "run-codex", () =>
      runCodexReproducer({
        prompt,
        workingDirectory: run.runDir,
      }),
    );
  } catch (error) {
    failure = asError(error);
  }

  if (recording) {
    try {
      await stepRun(step, "stop-recording", () => recording.stop());
    } catch (error) {
      cleanupErrors.push(asError(error));
    }
  }

  if (chrome) {
    try {
      await stepRun(step, "stop-chrome", () => chrome.process.kill("SIGKILL"));
    } catch (error) {
      cleanupErrors.push(asError(error));
    }
  }

  try {
    await stepRun(step, "update-metadata", () =>
      updateRunMetadata({
        metadataPath: run.metadataPath,
        status: runResult?.status ?? "failed",
        ticketUrl: runResult?.ticketUrl ?? "",
        finalUrl: runResult?.finalUrl ?? env.TARGET_APP_URL,
        videoPath: run.videoPath,
      }),
    );
  } catch (error) {
    cleanupErrors.push(asError(error));
  }

  if (failure) {
    throw failure;
  }

  if (cleanupErrors.length > 0) {
    throw cleanupErrors[0];
  }

  if (!runResult) {
    throw new Error("Codex reproducer did not return a result");
  }

  return runResult;
}

export const onSentryIssue = inngest.createFunction(
  { id: "on-sentry-issue" },
  { event: "sentry/issue.created" },
  async ({ event, step }) => {
    return runSentryIssue({ event: event as SentryIssueEvent, step });
  },
);
