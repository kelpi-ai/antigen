import { existsSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { readTimelineEvents, type TimelineEvent } from "./timeline";
import {
  findSuccessfulToolText,
  parseCodexEvents,
  parseCodexFinalResult,
  parseCodexMilestones,
  type CodexEvent,
  type CodexMilestone,
  type ParsedCodexFinalResult,
} from "./codexEvents";

export interface RunMetadata {
  runId: string;
  status: string;
  sentryIssueId: string;
  targetAppUrl?: string;
  videoPath?: string;
  timelinePath?: string;
  codexEventsPath?: string;
  recording?: {
    status?: string;
    reason?: string;
    openedNewPage?: boolean;
  };
  ticketUrl?: string;
  finalUrl?: string;
}

export interface BuildRunDetailInput {
  artifactsRoot: string;
  findLatestRunId?: (artifactsRoot?: string) => Promise<string>;
  readMetadata?: (metadataPath?: string) => Promise<RunMetadata>;
  readTimeline?: (timelinePath?: string) => Promise<TimelineEvent[]>;
  readCodexEvents?: (codexEventsPath?: string) => Promise<CodexEvent[]>;
}

export interface RunSummary {
  runId: string;
  status: string;
  sentryIssueId: string;
  sentryIssueUrl: string;
  ticketUrl: string;
  finalUrl: string;
  expected: string;
  actual: string;
  targetAppUrl: string;
}

export interface RunTimelineItem {
  step: string;
  status: TimelineEvent["status"] | "pending";
  startedAt: string;
  endedAt: string;
  summary: string;
  payload: Record<string, unknown>;
}

export interface RunFlowItem {
  key: string;
  title: string;
  status: "completed" | "pending" | "failed";
  summary: string;
  detail: string;
}

export interface RunEvidence {
  videoUrl: string;
  videoAvailable: boolean;
  videoLabel: string;
  steps: string[];
  consoleErrors: number;
  failedRequests: number;
  summary: string;
}

export interface RunSentry {
  title: string;
  culprit: string;
  permalink: string;
  breadcrumbs: string[];
  stackSnippet: string;
}

export interface RunCodex {
  milestones: CodexMilestone[];
  rawEvents: CodexEvent[];
}

export interface RunDetailViewModel {
  summary: RunSummary;
  flow: RunFlowItem[];
  timeline: RunTimelineItem[];
  evidence: RunEvidence;
  sentry: RunSentry;
  codex: RunCodex;
}

export interface RunSelectionCandidate {
  runId: string;
  mtimeMs: number;
  metadata: Partial<RunMetadata>;
  hasTimeline: boolean;
  hasCodexEvents: boolean;
  hasVideo: boolean;
}

function pathFromArtifactsOrRun(
  artifactsRoot: string,
  runDir: string,
  candidate?: string,
  fallbackRelativePath = "",
): string {
  if (!candidate) {
    return join(runDir, fallbackRelativePath);
  }

  if (isAbsolute(candidate)) {
    return candidate;
  }

  if (candidate.startsWith(".")) {
    return resolve(candidate);
  }

  const artifactCandidate = join(artifactsRoot, candidate);
  if (existsSync(artifactCandidate)) {
    return artifactCandidate;
  }

  return join(runDir, candidate);
}

async function readdirSafe(path: string): Promise<Array<import("node:fs").Dirent>> {
  const { readdir } = await import("node:fs/promises");

  try {
    return await readdir(path, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function statSafe(path: string): Promise<import("node:fs").Stats | null> {
  const { stat } = await import("node:fs/promises");

  try {
    return await stat(path);
  } catch {
    return null;
  }
}

async function readMetadataDefault(metadataPath: string): Promise<RunMetadata> {
  const raw = await readFile(metadataPath, "utf8");
  return JSON.parse(raw) as RunMetadata;
}

async function readTimelineDefault(timelinePath: string): Promise<TimelineEvent[]> {
  return readTimelineEvents(timelinePath);
}

async function readCodexEventsDefault(codexEventsPath: string): Promise<CodexEvent[]> {
  try {
    const raw = await readFile(codexEventsPath, "utf8");
    return parseCodexEvents(raw);
  } catch {
    return [];
  }
}

export function scoreRunForDemo(candidate: RunSelectionCandidate): number {
  let score = 0;

  if (candidate.hasCodexEvents) score += 6;
  if (candidate.metadata.ticketUrl) score += 4;
  if (candidate.metadata.finalUrl) score += 2;
  if (candidate.hasTimeline) score += 2;
  if (candidate.hasVideo) score += 1;

  switch (candidate.metadata.status) {
    case "reproduced":
    case "completed":
    case "done":
      score += 10;
      break;
    case "failed":
      score += 4;
      break;
    default:
      score += 0;
  }

  return score;
}

async function defaultFindLatestRunId(artifactsRoot: string): Promise<string> {
  const runsRoot = join(artifactsRoot, "runs");
  const runDirs = (await readdirSafe(runsRoot)).filter((entry) => entry.isDirectory());
  if (runDirs.length === 0) {
    throw new Error("No runs found");
  }

  const ranked = await Promise.all(
    runDirs.map(async (entry) => {
      const runDir = join(runsRoot, entry.name);
      const stat = await statSafe(runDir);
      const metadata: Partial<RunMetadata> = await readMetadataDefault(join(runDir, "metadata.json")).catch(
        () =>
          ({
            runId: entry.name,
            status: "",
            sentryIssueId: "",
          }) satisfies Partial<RunMetadata>,
      );

      const timelinePath = pathFromArtifactsOrRun(artifactsRoot, runDir, metadata.timelinePath, "timeline.jsonl");
      const codexEventsPath = pathFromArtifactsOrRun(
        artifactsRoot,
        runDir,
        metadata.codexEventsPath ?? "codex-events.jsonl",
        "codex-events.jsonl",
      );
      const videoPath = pathFromArtifactsOrRun(artifactsRoot, runDir, metadata.videoPath, "browser.mp4");

      return {
        runId: entry.name,
        mtimeMs: stat?.mtimeMs ?? 0,
        metadata,
        hasTimeline: existsSync(timelinePath),
        hasCodexEvents: existsSync(codexEventsPath),
        hasVideo: existsSync(videoPath),
      } satisfies RunSelectionCandidate;
    }),
  );

  ranked.sort((a, b) => b.mtimeMs - a.mtimeMs);

  return ranked[0].runId;
}

function normalizeEvidenceCount(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return value;
  }
  return 0;
}

function parseSentryContext(events: CodexEvent[], sentryIssueId: string): RunSentry {
  const issueText = findSuccessfulToolText(events, {
    server: "sentry-bubble-reel",
    tool: "get_sentry_resource",
  });
  const breadcrumbsText = findSuccessfulToolText(events, {
    server: "sentry-bubble-reel",
    tool: "get_sentry_resource",
    resourceType: "breadcrumbs",
  });

  const title =
    issueText.match(/\*\*Description\*\*: ([^\n]+)/)?.[1]?.trim() ??
    `Sentry issue ${sentryIssueId}`;
  const culprit = issueText.match(/\*\*Culprit\*\*: ([^\n]+)/)?.[1]?.trim() ?? "";
  const permalink =
    issueText.match(/\*\*URL\*\*: ([^\n]+)/)?.[1]?.trim() ??
    "";

  const breadcrumbBlock = breadcrumbsText.match(/```([\s\S]*?)```/)?.[1] ?? "";
  const breadcrumbs = breadcrumbBlock
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const stackSnippet = issueText.match(/\*\*Stacktrace:\*\*\s*```([\s\S]*?)```/)?.[1]?.trim() ?? "";

  return {
    title,
    culprit,
    permalink,
    breadcrumbs,
    stackSnippet,
  };
}

function buildFlow(input: {
  metadata: RunMetadata;
  sentry: RunSentry;
  milestones: CodexMilestone[];
  finalResult: ParsedCodexFinalResult | null;
}): RunFlowItem[] {
  const milestoneSteps = new Set(input.milestones.map((milestone) => milestone.step));
  const runFailed = input.metadata.status === "failed";
  const runDone = ["reproduced", "completed", "done"].includes(input.metadata.status);

  return [
    {
      key: "sentry-received",
      title: "Sentry issue received",
      status: "completed",
      summary: `Issue ${input.metadata.sentryIssueId} entered the incident loop.`,
      detail: input.sentry.title || "Webhook payload was accepted and persisted as a local run.",
    },
    {
      key: "sentry-context",
      title: "Sentry context inspected",
      status: milestoneSteps.has("codex-sentry-issue") ? "completed" : runFailed ? "failed" : "pending",
      summary: milestoneSteps.has("codex-sentry-issue")
        ? "Codex pulled issue details from Sentry."
        : "Waiting for Codex to inspect the issue in Sentry.",
      detail: input.sentry.culprit || input.sentry.permalink || "Culprit, stack, and breadcrumbs are extracted here.",
    },
    {
      key: "browser-reproduction",
      title: "Browser reproduction attempted",
      status: milestoneSteps.has("codex-browser-reproduction") ? "completed" : runFailed ? "failed" : "pending",
      summary: milestoneSteps.has("codex-browser-reproduction")
        ? "Codex drove Chrome DevTools to replay the issue path."
        : "Waiting for Codex browser actions.",
      detail:
        input.finalResult?.actual ||
        input.finalResult?.summary ||
        "This stage shows the path Codex took through the target app.",
    },
    {
      key: "linear-ticket",
      title: "Linear ticket created",
      status:
        input.metadata.ticketUrl || input.finalResult?.ticketUrl || milestoneSteps.has("codex-linear-ticket")
          ? "completed"
          : runFailed
            ? "failed"
            : "pending",
      summary:
        input.metadata.ticketUrl || input.finalResult?.ticketUrl || milestoneSteps.has("codex-linear-ticket")
          ? "Codex filed the reproduction in Linear."
          : "Waiting for Linear issue creation.",
      detail:
        input.metadata.ticketUrl ||
        input.finalResult?.ticketUrl ||
        "The run will link the ticket here when available.",
    },
    {
      key: "run-outcome",
      title: "Run outcome",
      status: runDone ? "completed" : runFailed ? "failed" : "pending",
      summary: runDone
        ? "The incident loop completed successfully."
        : runFailed
          ? "The incident loop failed before completion."
          : "The run is still in progress.",
      detail:
        input.finalResult?.summary ||
        input.metadata.finalUrl ||
        "Outcome will be updated as more run artifacts land on disk.",
    },
  ];
}

export async function buildRunDetailViewModel(input: BuildRunDetailInput): Promise<RunDetailViewModel> {
  const findLatestRunId = input.findLatestRunId ?? defaultFindLatestRunId;
  const readMetadata = input.readMetadata ?? readMetadataDefault;
  const readTimeline = input.readTimeline ?? readTimelineDefault;
  const readCodexEvents = input.readCodexEvents ?? readCodexEventsDefault;

  const runId = await findLatestRunId(input.artifactsRoot);
  const runDir = join(input.artifactsRoot, "runs", runId);
  const metadata = await readMetadata(join(runDir, "metadata.json"));

  const timelinePath = pathFromArtifactsOrRun(input.artifactsRoot, runDir, metadata.timelinePath, "timeline.jsonl");
  const codexEventsPath = pathFromArtifactsOrRun(
    input.artifactsRoot,
    runDir,
    metadata.codexEventsPath ?? "codex-events.jsonl",
    "codex-events.jsonl",
  );
  const videoPath = pathFromArtifactsOrRun(input.artifactsRoot, runDir, metadata.videoPath, "browser.mp4");

  const timeline = (await readTimeline(timelinePath)).map((event) => ({
    step: event.step,
    status: event.status,
    startedAt: event.startedAt,
    endedAt: event.endedAt,
    summary: event.summary,
    payload: event.payload,
  }));

  const rawEvents = await readCodexEvents(codexEventsPath);
  const milestones = parseCodexMilestones(rawEvents);
  const finalResult = parseCodexFinalResult(rawEvents);
  const sentry = parseSentryContext(rawEvents, metadata.sentryIssueId);
  const videoAvailable = existsSync(videoPath);

  const mergedTimeline: RunTimelineItem[] = [
    ...timeline,
    ...milestones
      .filter((milestone) => !timeline.some((event) => event.step === milestone.step))
      .map((milestone) => ({
        step: milestone.step,
        status: "completed" as const,
        startedAt: "",
        endedAt: "",
        summary: milestone.summary,
        payload: { raw: milestone.raw },
      })),
  ];

  return {
    summary: {
      runId,
      status: metadata.status,
      sentryIssueId: metadata.sentryIssueId,
      sentryIssueUrl: sentry.permalink,
      ticketUrl: metadata.ticketUrl ?? finalResult?.ticketUrl ?? "",
      finalUrl: metadata.finalUrl ?? finalResult?.finalUrl ?? "",
      expected: finalResult?.expected ?? "",
      actual: finalResult?.actual ?? "",
      targetAppUrl: metadata.targetAppUrl ?? "",
    },
    flow: buildFlow({
      metadata,
      sentry,
      milestones,
      finalResult,
    }),
    timeline: mergedTimeline,
    evidence: {
      videoUrl: `/demo/media/runs/${runId}/browser.mp4`,
      videoAvailable,
      videoLabel: videoAvailable ? "Agent recording available" : "Manual recording / no agent recording",
      steps: finalResult?.steps ?? [],
      consoleErrors: normalizeEvidenceCount(finalResult?.evidence?.consoleErrors),
      failedRequests: normalizeEvidenceCount(finalResult?.evidence?.failedRequests),
      summary: finalResult?.summary ?? "",
    },
    sentry,
    codex: {
      milestones,
      rawEvents,
    },
  };
}
