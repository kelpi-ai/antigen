import { describe, it, expect } from "vitest";
import { buildHunterExecutorPrompt } from "../../src/prompts/hunterExecutor";

describe("buildHunterExecutorPrompt", () => {
  const prompt = buildHunterExecutorPrompt({
    prNumber: 123,
    previewUrl: "https://pr-123.preview.dev",
    scenario: {
      id: "checkout-coupon",
      summary: "Retry coupon after invalid code",
      rationale: "checkout has recent failures and this PR touches coupon logic",
      targetArea: "checkout",
      routeHint: "/checkout",
      risk: "high",
      mode: "mutating",
      guardrails: ["use a seeded test account only", "do not submit the final order"],
      expectedEvidence: ["finalUrl", "consoleSignals"],
    },
    screenshotPath: "/tmp/run/failure.png",
  });

  it("mentions the preview URL and scenario details", () => {
    expect(prompt).toContain("https://pr-123.preview.dev");
    expect(prompt).toContain("Retry coupon after invalid code");
  });

  it("requires Chrome DevTools MCP and read-only repo behavior", () => {
    expect(prompt).toMatch(/Chrome DevTools MCP/i);
    expect(prompt).toMatch(/Do not modify the repository/i);
  });

  it("passes through mutating guardrails", () => {
    expect(prompt).toContain("use a seeded test account only");
    expect(prompt).toContain("do not submit the final order");
  });

  it("requires tagged JSON output", () => {
    expect(prompt).toContain("P3_EXECUTOR_JSON");
  });
});