import { describe, it, expect } from "vitest";
import { buildHunterReducerPrompt } from "../../src/prompts/hunterReducer";

describe("buildHunterReducerPrompt", () => {
  const prompt = buildHunterReducerPrompt({
    repo: "acme/app",
    prNumber: 123,
    prUrl: "https://github.com/acme/app/pull/123",
    previewUrl: "https://pr-123.preview.dev",
    executorResults: [
      {
        scenarioId: "checkout-coupon",
        outcome: "failed",
        summary: "coupon flow throws TypeError",
        finalUrl: "https://pr-123.preview.dev/checkout",
        consoleSignals: ["TypeError: x is undefined"],
        networkSignals: [],
        evidence: ["failure after retrying coupon"],
      },
    ],
  });

  it("requires one consolidated PR comment", () => {
    expect(prompt).toMatch(/one consolidated PR comment/i);
  });

  it("opens or updates Linear investigation tickets only", () => {
    expect(prompt).toMatch(/create or update/i);
    expect(prompt).toMatch(/Linear investigation tickets/i);
    expect(prompt).not.toMatch(/draft PR/i);
  });

  it("requires a PR comment even when there are no actionable suggestions", () => {
    expect(prompt).toMatch(/no actionable suggestions/i);
    expect(prompt).toMatch(/no suggestions were found/i);
  });

  it("requires tagged JSON output", () => {
    expect(prompt).toContain("P3_REDUCER_JSON");
  });
});
