import { readFile, writeFile } from "node:fs/promises";
import { inngest } from "../client";
import { env } from "../../config/env";
import { stitchScreenshotsToVideo } from "../../browser/stitch";
import { buildReproducerPrompt, type ReproducerIssueContext } from "../../prompts/reproducer";
import { createRun } from "../../runs/createRun";
import {
  runCodexReproducer,
  type CodexMilestone,
  type RecordingAssessment,
  type ReproducerResult,
  type ReproducerRunResult,
} from "../../codex/reproducer";

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
  recording: RecordingAssessment;
}): Promise<void> {
  const rawMetadata = await readFile(input.metadataPath, "utf8");
  const existing = JSON.parse(rawMetadata);
  const next = {
    ...existing,
    status: input.status,
    ticketUrl: input.ticketUrl,
    finalUrl: input.finalUrl,
    videoPath: input.videoPath,
    recording: input.recording,
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

  let runResult: ReproducerRunResult | null = null;
  let failure: Error | null = null;
  const cleanupErrors: Error[] = [];

  try {
    const prompt = buildReproducerPrompt({
      issue: mapIssueForPrompt(issue),
      targetAppUrl: env.TARGET_APP_URL,
      screenshotsDir: run.screenshotsDir,
      videoPath: run.videoPath,
    });

    runResult = await stepRun(step, "run-codex", () =>
      runCodexReproducer({
        prompt,
        workingDirectory: run.runDir,
        eventsPath: run.codexEventsPath,
      }),
    );
  } catch (error) {
    failure = asError(error);
  }

  const codexMilestones: CodexMilestone[] = runResult?.milestones ?? [];
  for (const milestone of codexMilestones) {
    try {
      await stepRun(step, milestone.stepName, () => ({
        summary: milestone.summary,
        server: milestone.server,
        tool: milestone.tool,
        details: milestone.details ?? "",
      }));
    } catch (error) {
      cleanupErrors.push(asError(error));
    }
  }

  if (runResult?.recordingAssessment) {
    const recordingAssessment = runResult.recordingAssessment;
    try {
      await stepRun(step, "codex-recording-integrity", () => ({
        status: recordingAssessment.status,
        reason: recordingAssessment.reason,
        openedNewPage: recordingAssessment.openedNewPage,
      }));
    } catch (error) {
      cleanupErrors.push(asError(error));
    }
  }

  if (runResult) {
    const completedRun = runResult;

    try {
      const videoResult = await stepRun(step, "build-run-video", () =>
        stitchScreenshotsToVideo({
          screenshotsDir: run.screenshotsDir,
          outputPath: run.videoPath,
          ffmpegBin: env.FFMPEG_BIN ?? "ffmpeg",
        }),
      );

      if (!videoResult.created) {
        runResult = {
          ...completedRun,
          recordingAssessment: {
            ...completedRun.recordingAssessment,
            reason: `${completedRun.recordingAssessment.reason} No screenshots were saved, so no synthesized video was created.`,
          },
        };
      }
    } catch (error) {
      runResult = {
        ...completedRun,
        recordingAssessment: {
          status: "suspect",
          reason: `${completedRun.recordingAssessment.reason} Video synthesis failed: ${asError(error).message}`,
          openedNewPage: completedRun.recordingAssessment.openedNewPage,
        },
      };
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
        recording:
          runResult?.recordingAssessment ?? {
            status: "pending",
            reason: "Awaiting Codex run analysis",
            openedNewPage: false,
          },
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
