import { describe, it, expect } from "vitest";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import {
  createHuntRun,
  createScenarioWorkspace,
  updateHuntRunMetadata,
} from "../../src/p3/run";

describe("createHuntRun", () => {
  it("creates a run directory and metadata file", async () => {
    const root = await mkdtemp(join(tmpdir(), "incident-loop-p3-"));
    const run = await createHuntRun({
      artifactsRoot: root,
      prNumber: 42,
      repo: "acme/app",
    });

    expect(run.runId).toMatch(/^[a-f0-9-]+$/);
    expect(run.runDir).toContain(root);

    const metadata = JSON.parse(await readFile(run.metadataPath, "utf8"));
    expect(metadata.prNumber).toBe(42);
    expect(metadata.repo).toBe("acme/app");
    expect(metadata.status).toBe("created");
  });
});

describe("createScenarioWorkspace", () => {
  it("creates per-scenario codex and chrome profile dirs", async () => {
    const root = await mkdtemp(join(tmpdir(), "incident-loop-p3-"));
    const run = await createHuntRun({
      artifactsRoot: root,
      prNumber: 7,
      repo: "acme/app",
    });

    const workspace = await createScenarioWorkspace({
      runDir: run.runDir,
      scenarioId: "checkout-coupon",
    });

    expect(workspace.scenarioDir).toContain("checkout-coupon");
    expect(workspace.codexDir.endsWith(".codex")).toBe(true);
    expect(workspace.profileDir.endsWith("profile")).toBe(true);
  });

  it("sanitizes hostile scenario IDs so workspace stays under runDir", async () => {
    const root = await mkdtemp(join(tmpdir(), "incident-loop-p3-"));
    const run = await createHuntRun({
      artifactsRoot: root,
      prNumber: 11,
      repo: "acme/app",
    });

    const workspace = await createScenarioWorkspace({
      runDir: run.runDir,
      scenarioId: "../../escape",
    });

    const absoluteScenarioDir = resolve(workspace.scenarioDir);
    const absoluteRunDir = resolve(run.runDir);
    expect(absoluteScenarioDir.startsWith(`${absoluteRunDir}${sep}`)).toBe(true);
    expect(workspace.codexDir.startsWith(run.runDir)).toBe(true);
    expect(workspace.profileDir.startsWith(run.runDir)).toBe(true);
    expect((await stat(workspace.scenarioDir)).isDirectory()).toBe(true);
    expect((await stat(workspace.codexDir)).isDirectory()).toBe(true);
    expect((await stat(workspace.profileDir)).isDirectory()).toBe(true);
  });
});

describe("updateHuntRunMetadata", () => {
  it("merges new fields into metadata.json", async () => {
    const root = await mkdtemp(join(tmpdir(), "incident-loop-p3-"));
    const run = await createHuntRun({
      artifactsRoot: root,
      prNumber: 5,
      repo: "acme/app",
    });

    await updateHuntRunMetadata(run.metadataPath, {
      status: "failures",
      previewUrl: "https://pr-5.preview.dev",
    });

    const metadata = JSON.parse(await readFile(run.metadataPath, "utf8"));
    expect(metadata.status).toBe("failures");
    expect(metadata.previewUrl).toBe("https://pr-5.preview.dev");
  });
});
