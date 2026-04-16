import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHmac } from "node:crypto";
import { Hono } from "hono";

const sendMock = vi.fn();
vi.mock("../../src/inngest/client", () => ({
  inngest: { send: (...args: unknown[]) => sendMock(...args) },
}));

import { mountLinearWebhook } from "../../src/webhooks/linear";

function sign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

describe("POST /webhooks/linear", () => {
  const secret = "lin-webhook-secret";

  beforeEach(() => {
    sendMock.mockReset();
    process.env.INNGEST_EVENT_KEY = "x";
    process.env.INNGEST_SIGNING_KEY = "x";
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.TARGET_APP_URL = "http://localhost:3001";
    process.env.SENTRY_WEBHOOK_SECRET = "sentry-secret";
    process.env.LINEAR_API_KEY = "lin_api_xxx";
    process.env.LINEAR_WEBHOOK_SECRET = secret;
    process.env.TARGET_REPO_PATH = "/tmp/repo";
    process.env.TARGET_REPO_WORKTREE_ROOT = "/tmp/worktrees";
    process.env.TARGET_REPO_REMOTE = "origin";
    process.env.TARGET_REPO_BASE_BRANCH = "main";
    process.env.ARTIFACTS_DIR = "/tmp/artifacts";
    process.env.CHROME_PATH = "/usr/bin/chrome";
    process.env.FFMPEG_BIN = "/usr/bin/ffmpeg";
    process.env.PORT = "3001";
  });

  it("emits the normalized event for bug-labeled issues", async () => {
    const app = new Hono();
    mountLinearWebhook(app);

    const body = JSON.stringify({
      action: "create",
      type: "Issue",
      data: {
        id: "lin_123",
        identifier: "BUG-42",
        url: "https://linear.app/acme/issue/BUG-42",
        labels: [{ name: "bug" }, { name: "module:checkout" }],
      },
    });

    const res = await app.request("/webhooks/linear", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "linear-signature": sign(body, secret),
      },
      body,
    });

    expect(res.status).toBe(202);
    expect(sendMock).toHaveBeenCalledWith({
      name: "linear/ticket.created",
      data: {
        ticketId: "lin_123",
        identifier: "BUG-42",
        module: "checkout",
        url: "https://linear.app/acme/issue/BUG-42",
      },
    });
  });

  it("trims whitespace from module labels", async () => {
    const app = new Hono();
    mountLinearWebhook(app);

    const body = JSON.stringify({
      action: "create",
      type: "Issue",
      data: {
        id: "lin_123",
        identifier: "BUG-42",
        url: "https://linear.app/acme/issue/BUG-42",
        labels: [{ name: "bug" }, { name: "module: checkout" }],
      },
    });

    const res = await app.request("/webhooks/linear", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "linear-signature": sign(body, secret),
      },
      body,
    });

    expect(res.status).toBe(202);
    expect(sendMock).toHaveBeenCalledWith({
      name: "linear/ticket.created",
      data: {
        ticketId: "lin_123",
        identifier: "BUG-42",
        module: "checkout",
        url: "https://linear.app/acme/issue/BUG-42",
      },
    });
  });

  it("returns 401 for an invalid signature", async () => {
    const app = new Hono();
    mountLinearWebhook(app);

    const body = JSON.stringify({
      action: "create",
      type: "Issue",
      data: {
        id: "lin_123",
        identifier: "BUG-42",
        url: "https://linear.app/acme/issue/BUG-42",
        labels: [{ name: "bug" }],
      },
    });

    const res = await app.request("/webhooks/linear", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "linear-signature": "deadbeef",
      },
      body,
    });

    expect(res.status).toBe(401);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("ignores non-bug issues", async () => {
    const app = new Hono();
    mountLinearWebhook(app);

    const body = JSON.stringify({
      action: "create",
      type: "Issue",
      data: {
        id: "lin_123",
        identifier: "BUG-42",
        url: "https://linear.app/acme/issue/BUG-42",
        labels: [{ name: "feature" }],
      },
    });

    const res = await app.request("/webhooks/linear", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "linear-signature": sign(body, secret),
      },
      body,
    });

    expect(res.status).toBe(204);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("falls back to unknown when the module label is missing", async () => {
    const app = new Hono();
    mountLinearWebhook(app);

    const body = JSON.stringify({
      action: "create",
      type: "Issue",
      data: {
        id: "lin_123",
        identifier: "BUG-42",
        url: "https://linear.app/acme/issue/BUG-42",
        labels: [{ name: "bug" }],
      },
    });

    const res = await app.request("/webhooks/linear", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "linear-signature": sign(body, secret),
      },
      body,
    });

    expect(res.status).toBe(202);
    expect(sendMock).toHaveBeenCalledWith({
      name: "linear/ticket.created",
      data: {
        ticketId: "lin_123",
        identifier: "BUG-42",
        module: "unknown",
        url: "https://linear.app/acme/issue/BUG-42",
      },
    });
  });
});
