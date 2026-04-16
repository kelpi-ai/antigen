import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
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
  const safeScenarioId = sanitizeScenarioId(input.scenarioId);
  const scenarioDir = join(input.runDir, "scenarios", safeScenarioId);
  const codexDir = join(scenarioDir, ".codex");
  const profileDir = join(scenarioDir, "profile");
  const screenshotPath = join(scenarioDir, "failure.png");

  await mkdir(codexDir, { recursive: true });
  await mkdir(profileDir, { recursive: true });

  return { scenarioDir, codexDir, profileDir, screenshotPath };
}

function sanitizeScenarioId(rawScenarioId: string): string {
  const normalizedId = rawScenarioId.toLowerCase().trim();
  const safeSlug = normalizedId
    .replace(/[^a-z0-9._-]/g, "-")
    .replace(/\.{2,}/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 48);

  const fingerprint = createHash("sha256")
    .update(rawScenarioId)
    .digest("hex")
    .slice(0, 12);

  if (!safeSlug) {
    return `scenario-${fingerprint}`;
  }

  if (safeSlug === normalizedId) {
    return safeSlug;
  }

  return `${safeSlug}-${fingerprint}`;
}

export async function updateHuntRunMetadata(
  metadataPath: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const current = JSON.parse(await readFile(metadataPath, "utf8"));
  await writeFile(metadataPath, JSON.stringify({ ...current, ...patch }, null, 2));
}
