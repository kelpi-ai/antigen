import { createHmac } from "node:crypto";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { inngest } from "../src/inngest/client";
import { buildApp } from "../src/server";

function sign(body: string, secret: string): string {
  return "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
}

describe("server", () => {
  beforeEach(() => {
    process.env.INNGEST_EVENT_KEY = "test";
    process.env.INNGEST_SIGNING_KEY = "test";
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.TARGET_APP_URL = "http://localhost:3001";
    process.env.SENTRY_WEBHOOK_SECRET = "sentry-secret";
    process.env.LINEAR_API_KEY = "lin_api_xxx";
    process.env.LINEAR_WEBHOOK_SECRET = "lin-webhook-secret";
    process.env.TARGET_REPO_PATH = "/tmp/repo";
    process.env.TARGET_REPO_WORKTREE_ROOT = "/tmp/worktrees";
    process.env.TARGET_REPO_REMOTE = "origin";
    process.env.TARGET_REPO_BASE_BRANCH = "main";
    process.env.CODEX_BIN = "/usr/local/bin/codex";
    process.env.GITHUB_WEBHOOK_SECRET = "test-secret";
    process.env.ARTIFACTS_DIR = "/tmp/artifacts";
    process.env.CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
    process.env.FFMPEG_BIN = "/usr/bin/ffmpeg";
    process.env.MAX_SCENARIOS_PER_PR = "5";
    process.env.P3_EXECUTOR_CONCURRENCY = "2";
    process.env.PORT = "3001";
    vi.restoreAllMocks();
    vi.spyOn(inngest, "send").mockResolvedValue([{ id: "event-1" }] as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
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

  it("mounts POST /webhooks/linear", async () => {
    const app = buildApp();
    const res = await app.request("/webhooks/linear", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "linear-signature": "invalid-signature",
      },
      body: "{}",
    });

    expect(res.status).toBe(401);
  });

  it("returns 401 for an invalid GitHub webhook signature", async () => {
    const app = buildApp();
    const payload = {
      action: "ready_for_review",
      number: 123,
      pull_request: {
        html_url: "https://github.com/octocat/hello-world/pull/123",
        head: { sha: "head-sha" },
        base: { sha: "base-sha" },
      },
      repository: {
        full_name: "octocat/hello-world",
      },
    };

    const res = await app.request("/webhooks/github", {
      method: "POST",
      headers: {
        "x-github-event": "pull_request",
        "x-hub-signature-256": "sha256=invalid",
      },
      body: JSON.stringify(payload),
    });

    expect(res.status).toBe(401);
  });

  it("dispatches ready_for_review events through the mounted /webhooks/github route", async () => {
    const app = buildApp();
    const payload = {
      action: "ready_for_review",
      number: 123,
      pull_request: {
        html_url: "https://github.com/octocat/hello-world/pull/123",
        head: { sha: "head-sha" },
        base: { sha: "base-sha" },
      },
      repository: {
        full_name: "octocat/hello-world",
      },
    };

    const body = JSON.stringify(payload);
    const res = await app.request("/webhooks/github", {
      method: "POST",
      headers: {
        "x-github-event": "pull_request",
        "x-hub-signature-256": sign(body, "test-secret"),
      },
      body,
    });

    expect(res.status).toBe(202);
    expect(inngest.send).toHaveBeenCalledWith({
      name: "github/pr.ready_for_review",
      data: {
        prNumber: 123,
        repo: "octocat/hello-world",
        prUrl: "https://github.com/octocat/hello-world/pull/123",
        headSha: "head-sha",
        baseSha: "base-sha",
      },
    });
  });
});
