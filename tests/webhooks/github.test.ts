import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";

import { inngest } from "../../src/inngest/client";
import { githubWebhookAdapter } from "../../src/webhooks/github";

vi.mock("../../src/inngest/client", () => ({
  inngest: {
    send: vi.fn(),
  },
}));

function sign(body: string, secret: string): string {
  return "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
}

describe("githubWebhookAdapter", () => {
  beforeEach(() => {
    process.env.INNGEST_EVENT_KEY = "test";
    process.env.INNGEST_SIGNING_KEY = "test";
    process.env.CODEX_BIN = "/usr/local/bin/codex";
    process.env.GITHUB_WEBHOOK_SECRET = "test-secret";
    process.env.CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
    process.env.ARTIFACTS_DIR = ".incident-loop-artifacts";
    process.env.MAX_SCENARIOS_PER_PR = "5";
    process.env.P3_EXECUTOR_CONCURRENCY = "2";
    vi.clearAllMocks();
  });

  it("accepts ready_for_review and sends inngest event", async () => {
    const app = new Hono();
    app.post("/webhooks/github", githubWebhookAdapter);

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

  it("ignores events that are not ready_for_review", async () => {
    const app = new Hono();
    app.post("/webhooks/github", githubWebhookAdapter);

    const payload = {
      action: "opened",
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

    expect(res.status).toBe(204);
    expect(inngest.send).not.toHaveBeenCalled();
  });

  it("returns 400 for invalid JSON payloads", async () => {
    const app = new Hono();
    app.post("/webhooks/github", githubWebhookAdapter);

    const body = "{ this is not valid JSON }";
    const res = await app.request("/webhooks/github", {
      method: "POST",
      headers: {
        "x-github-event": "pull_request",
        "x-hub-signature-256": sign(body, "test-secret"),
      },
      body,
    });

    expect(res.status).toBe(400);
    expect(inngest.send).not.toHaveBeenCalled();
  });

  it("returns 401 for invalid signature", async () => {
    const app = new Hono();
    app.post("/webhooks/github", githubWebhookAdapter);

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
        "x-hub-signature-256": "sha256=invalid",
      },
      body,
    });

    expect(res.status).toBe(401);
    expect(inngest.send).not.toHaveBeenCalled();
  });

  it("returns 204 when event is not pull_request", async () => {
    const app = new Hono();
    app.post("/webhooks/github", githubWebhookAdapter);

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
        "x-github-event": "issues",
        "x-hub-signature-256": sign(body, "test-secret"),
      },
      body,
    });

    expect(res.status).toBe(204);
    expect(inngest.send).not.toHaveBeenCalled();
  });

  it("returns 502 when event dispatch fails", async () => {
    vi.mocked(inngest.send).mockRejectedValueOnce(new Error("dispatch failed"));
    const app = new Hono();
    app.post("/webhooks/github", githubWebhookAdapter);

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

    expect(res.status).toBe(502);
    expect(inngest.send).toHaveBeenCalledTimes(1);
  });
});
