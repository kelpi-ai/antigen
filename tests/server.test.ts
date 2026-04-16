import { describe, it, expect, beforeEach } from "vitest";
import { buildApp } from "../src/server";

describe("server", () => {
  beforeEach(() => {
    process.env.INNGEST_EVENT_KEY = "test";
    process.env.INNGEST_SIGNING_KEY = "test";
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.TARGET_APP_URL = "http://localhost:3001";
    process.env.SENTRY_WEBHOOK_SECRET = "sentry-secret";
    process.env.LINEAR_API_KEY = "lin-api";
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
});
