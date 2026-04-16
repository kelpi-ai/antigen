import { describe, it, expect, beforeEach } from "vitest";
import { buildApp } from "../src/server";

describe("server", () => {
  beforeEach(() => {
    process.env.INNGEST_EVENT_KEY = "test";
    process.env.INNGEST_SIGNING_KEY = "test";
    process.env.CODEX_BIN = "/usr/local/bin/codex";
    process.env.GITHUB_WEBHOOK_SECRET = "test-secret";
    process.env.CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
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
});
