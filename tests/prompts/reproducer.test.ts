import { describe, it, expect } from "vitest";
import { buildReproducerPrompt } from "../../src/prompts/reproducer";

describe("buildReproducerPrompt", () => {
  it("requires DevTools MCP, localhost target, and Linear ticket creation", () => {
    const prompt = buildReproducerPrompt({
      issue: {
        id: "SENTRY-123",
        title: "TypeError",
        permalink: "https://sentry.io/issues/123/",
        culprit: "checkout.applyCoupon",
        environment: "production",
        release: "app@1.4.2",
      },
      targetAppUrl: "http://localhost:3001",
      videoPath: ".incident-loop-artifacts/runs/abc/browser.mp4",
    });

    expect(prompt).toContain("Chrome DevTools MCP");
    expect(prompt).toContain("http://localhost:3001");
    expect(prompt).toMatch(/create exactly one Linear ticket/i);
    expect(prompt).toMatch(/return JSON only/i);
  });
});
