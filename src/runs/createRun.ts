import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export interface RunContext {
  runId: string;
  runDir: string;
  videoPath: string;
  metadataPath: string;
  codexDir: string;
}

export async function createRun(input: {
  artifactsRoot: string;
  sentryIssueId: string;
  targetAppUrl: string;
}): Promise<RunContext> {
  const runId = randomUUID();
  const runDir = join(input.artifactsRoot, "runs", runId);
  const codexDir = join(runDir, ".codex");
  const videoPath = join(runDir, "browser.mp4");
  const metadataPath = join(runDir, "metadata.json");

  await mkdir(codexDir, { recursive: true });
  await writeFile(
    metadataPath,
    JSON.stringify(
      {
        runId,
        sentryIssueId: input.sentryIssueId,
        targetAppUrl: input.targetAppUrl,
        status: "created",
        videoPath,
      },
      null,
      2,
    ),
  );

  return { runId, runDir, videoPath, metadataPath, codexDir };
}
