import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export interface RunContext {
  runId: string;
  runDir: string;
  videoPath: string;
  screenshotsDir: string;
  metadataPath: string;
  codexDir: string;
  codexEventsPath: string;
}

export async function createRun(input: {
  artifactsRoot: string;
  sentryIssueId: string;
  targetAppUrl: string;
}): Promise<RunContext> {
  const runId = randomUUID();
  const runDir = join(input.artifactsRoot, "runs", runId);
  const codexDir = join(runDir, ".codex");
  const screenshotsDir = join(runDir, "screenshots");
  const videoPath = join(runDir, "browser.mp4");
  const metadataPath = join(runDir, "metadata.json");
  const codexEventsPath = join(runDir, "codex-events.jsonl");

  await mkdir(codexDir, { recursive: true });
  await mkdir(screenshotsDir, { recursive: true });
  await writeFile(
    metadataPath,
    JSON.stringify(
      {
        runId,
        sentryIssueId: input.sentryIssueId,
        targetAppUrl: input.targetAppUrl,
        status: "created",
        screenshotsDir,
        videoPath,
        codexEventsPath,
        recording: {
          status: "pending",
          reason: "Awaiting Codex run analysis",
          openedNewPage: false,
        },
      },
      null,
      2,
    ),
  );

  return { runId, runDir, videoPath, screenshotsDir, metadataPath, codexDir, codexEventsPath };
}
