import { describe, it, expect } from "vitest";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRun } from "../../src/runs/createRun";

describe("createRun", () => {
  it("creates a run directory and metadata file path", async () => {
    const root = await mkdtemp(join(tmpdir(), "incident-loop-"));
    const run = await createRun({
      artifactsRoot: root,
      sentryIssueId: "SENTRY-123",
      targetAppUrl: "http://localhost:3001",
    });

    expect(run.runId).toMatch(/^[a-f0-9-]+$/);
    expect(run.runDir).toBe(join(root, "runs", run.runId));
    expect(run.codexDir).toBe(join(run.runDir, ".codex"));
    expect(run.videoPath).toBe(join(run.runDir, "browser.mp4"));
    expect(run.metadataPath).toBe(join(run.runDir, "metadata.json"));
    expect((await stat(run.codexDir)).isDirectory()).toBe(true);

    const metadata = JSON.parse(await readFile(run.metadataPath, "utf8"));
    expect(metadata.status).toBe("created");
    expect(metadata.sentryIssueId).toBe("SENTRY-123");
    expect(metadata.runId).toBe(run.runId);
    expect(metadata.targetAppUrl).toBe("http://localhost:3001");
    expect(metadata.videoPath).toBe(run.videoPath);
  });
});
