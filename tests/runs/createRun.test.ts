import { describe, it, expect } from "vitest";
import { mkdtemp, readFile } from "node:fs/promises";
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
    expect(run.runDir).toContain(root);
    expect(run.videoPath.endsWith("browser.mp4")).toBe(true);
    expect(run.metadataPath.endsWith("metadata.json")).toBe(true);

    const metadata = JSON.parse(await readFile(run.metadataPath, "utf8"));
    expect(metadata.status).toBe("created");
    expect(metadata.sentryIssueId).toBe("SENTRY-123");
  });
});
