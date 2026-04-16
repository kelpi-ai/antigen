import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildApp } from "../src/server";

describe("server", () => {
  beforeEach(() => {
    process.env.INNGEST_EVENT_KEY = "test";
    process.env.INNGEST_SIGNING_KEY = "test";
    process.env.TARGET_APP_URL = "http://localhost:3001";
    process.env.SENTRY_WEBHOOK_SECRET = "sentry-secret";
    process.env.LINEAR_API_KEY = "lin-api";
    process.env.ARTIFACTS_DIR = join(tmpdir(), "incident-loop-empty");
  });

  it("responds 200 on GET /health", async () => {
    const app = buildApp();
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("responds 200 on GET /api/inngest", async () => {
    const app = buildApp();
    const res = await app.request("/api/inngest");
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual(
      expect.objectContaining({
        has_event_key: true,
        has_signing_key: true,
      }),
    );
    expect(body.function_count).toBeGreaterThanOrEqual(1);
  });

  it("responds 404 on GET /demo when there are no runs", async () => {
    const app = buildApp();
    const res = await app.request("/demo");

    expect(res.status).toBe(404);
    expect(await res.text()).toContain("No runs found");
  });

  it("responds 200 on GET /demo and /demo/data when a run exists", async () => {
    const artifactsRoot = await mkdtemp(join(tmpdir(), "incident-loop-demo-"));
    const runDir = join(artifactsRoot, "runs", "run-123");
    await mkdir(runDir, { recursive: true });
    await writeFile(
      join(runDir, "metadata.json"),
      JSON.stringify({
        runId: "run-123",
        status: "reproduced",
        sentryIssueId: "SENTRY-123",
        targetAppUrl: "file:///tmp/index.html",
        videoPath: join(runDir, "browser.mp4"),
        codexEventsPath: join(runDir, "codex-events.jsonl"),
      }),
    );
    await writeFile(join(runDir, "codex-events.jsonl"), "");
    process.env.ARTIFACTS_DIR = artifactsRoot;

    const app = buildApp();

    const page = await app.request("/demo");
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("Latest Run");

    const data = await app.request("/demo/data");
    expect(data.status).toBe(200);
    expect(await data.json()).toEqual(
      expect.objectContaining({
        summary: expect.objectContaining({ runId: "run-123" }),
      }),
    );
  });
});
