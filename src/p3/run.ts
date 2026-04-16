import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

export interface HuntRun {
  runId: string;
  runDir: string;
  metadataPath: string;
}

export interface ScenarioWorkspace {
  scenarioDir: string;
  codexDir: string;
  profileDir: string;
  screenshotPath: string;
}

export async function createHuntRun(input: {
  artifactsRoot: string;
  prNumber: number;
  repo: string;
}): Promise<HuntRun> {
  const runId = randomUUID();
  const runDir = join(input.artifactsRoot, "p3", runId);
  const metadataPath = join(runDir, "metadata.json");

  await mkdir(runDir, { recursive: true });
  await writeFile(
    metadataPath,
    JSON.stringify(
      {
        runId,
        prNumber: input.prNumber,
        repo: input.repo,
        status: "created",
      },
      null,
      2,
    ),
  );

  return { runId, runDir, metadataPath };
}

export async function createScenarioWorkspace(input: {
  runDir: string;
  scenarioId: string;
}): Promise<ScenarioWorkspace> {
  const scenarioDir = join(input.runDir, "scenarios", input.scenarioId);
  const codexDir = join(scenarioDir, ".codex");
  const profileDir = join(scenarioDir, "profile");
  const screenshotPath = join(scenarioDir, "failure.png");

  await mkdir(codexDir, { recursive: true });
  await mkdir(profileDir, { recursive: true });

  return { scenarioDir, codexDir, profileDir, screenshotPath };
}

export async function updateHuntRunMetadata(
  metadataPath: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const current = JSON.parse(await readFile(metadataPath, "utf8"));
  await writeFile(metadataPath, JSON.stringify({ ...current, ...patch }, null, 2));
}
