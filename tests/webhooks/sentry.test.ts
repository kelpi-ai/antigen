import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHmac } from "node:crypto";
import { Hono } from "hono";

const sendMock = vi.fn();
vi.mock("../../src/inngest/client", () => ({
  inngest: { send: (...args: unknown[]) => sendMock(...args) },
}));

import { mountSentryWebhook } from "../../src/webhooks/sentry";

function sign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

describe("mountSentryWebhook", () => {
  beforeEach(() => {
    sendMock.mockReset();
    process.env.INNGEST_EVENT_KEY = "x";
    process.env.INNGEST_SIGNING_KEY = "x";
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.TARGET_APP_URL = "http://localhost:3001";
    process.env.SENTRY_WEBHOOK_SECRET = "test-secret";
    process.env.LINEAR_API_KEY = "lin-api";
  });

  it("emits sentry/issue.created when signature and payload are valid", async () => {
    const body = JSON.stringify({
      action: "created",
      data: {
        issue: {
          id: "SENTRY-999",
          title: "TypeError",
          web_url: "https://sentry.io/issues/999/",
          culprit: "checkout",
          environment: "staging",
          release: "1.0.0",
        },
      },
    });
    const app = new Hono();
    mountSentryWebhook(app);

    const res = await app.request("/webhooks/sentry", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "sentry-hook-resource": "issue",
        "sentry-hook-signature": sign(body, "test-secret"),
      },
      body,
    });

    expect(res.status).toBe(202);
    expect(sendMock).toHaveBeenCalledWith({
      name: "sentry/issue.created",
      data: expect.objectContaining({
        action: "created",
        issue: expect.objectContaining({ id: "SENTRY-999", title: "TypeError" }),
      }),
    });
  });

  it("returns 202 for non-issue resources", async () => {
    const body = JSON.stringify({
      action: "created",
      data: { issue: { id: "SENTRY-999" } },
    });
    const app = new Hono();
    mountSentryWebhook(app);

    const res = await app.request("/webhooks/sentry", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "sentry-hook-resource": "event_alert",
        "sentry-hook-signature": sign(body, "test-secret"),
      },
      body,
    });

    expect(res.status).toBe(202);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("returns 202 for unsupported actions", async () => {
    const body = JSON.stringify({
      action: "updated",
      data: {
        issue: {
          id: "SENTRY-999",
          title: "TypeError",
        },
      },
    });
    const app = new Hono();
    mountSentryWebhook(app);

    const res = await app.request("/webhooks/sentry", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "sentry-hook-resource": "issue",
        "sentry-hook-signature": sign(body, "test-secret"),
      },
      body,
    });

    expect(res.status).toBe(202);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("rejects bad signatures", async () => {
    const body = JSON.stringify({
      action: "created",
      data: { issue: { id: "SENTRY-999" } },
    });
    const app = new Hono();
    mountSentryWebhook(app);

    const res = await app.request("/webhooks/sentry", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "sentry-hook-resource": "issue",
        "sentry-hook-signature": "deadbeef",
      },
      body,
    });

    expect(res.status).toBe(401);
    expect(sendMock).not.toHaveBeenCalled();
  });
});
