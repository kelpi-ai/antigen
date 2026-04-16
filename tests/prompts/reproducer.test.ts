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
      screenshotsDir: "/tmp/run-123/screenshots",
      videoPath: "",
    });

    expect(prompt).toContain("Chrome DevTools MCP");
    expect(prompt).toContain("http://localhost:3001");
    expect(prompt).toMatch(/already open on the target app/i);
    expect(prompt).toMatch(/reuse the existing page/i);
    expect(prompt).toMatch(/no browser recording is being captured by the agent/i);
    expect(prompt).toMatch(/create exactly one Linear ticket/i);
    expect(prompt).toMatch(/return JSON only/i);
    expect(prompt).toMatch(/use the sentry issue details to choose/i);
    expect(prompt).toMatch(/do not chase unrelated obvious demo bugs/i);
    expect(prompt).toMatch(/take_screenshot/i);
    expect(prompt).toContain("/tmp/run-123/screenshots");
  });
});
