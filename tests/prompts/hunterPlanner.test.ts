import { describe, it, expect } from "vitest";
import { buildHunterPlannerPrompt } from "../../src/prompts/hunterPlanner";

describe("buildHunterPlannerPrompt", () => {
  const prompt = buildHunterPlannerPrompt({
    event: {
      prNumber: 123,
      repo: "acme/app",
      prUrl: "https://github.com/acme/app/pull/123",
      headSha: "head-sha",
      baseSha: "base-sha",
    },
    maxScenarios: 5,
  });

  it("mentions GitHub, Sentry, and Linear MCP", () => {
    expect(prompt).toMatch(/GitHub MCP/i);
    expect(prompt).toMatch(/Sentry MCP/i);
    expect(prompt).toMatch(/Linear MCP/i);
  });

  it("requires progressive repo context instead of whole-repo loading", () => {
    expect(prompt).toMatch(/changed files/i);
    expect(prompt).toMatch(/unified diff/i);
    expect(prompt).toMatch(/do not load the whole repository/i);
  });

  it("requires preview URL resolution and exactly the top N scenarios", () => {
    expect(prompt).toContain("preview URL");
    expect(prompt).toContain("exactly 5");
  });

  it("requires tagged JSON output", () => {
    expect(prompt).toContain("P3_PLANNER_JSON");
  });
});
