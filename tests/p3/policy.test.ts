import { describe, it, expect } from "vitest";
import {
  selectTopScenarios,
  ensureExecutableScenario,
  shouldCreateInvestigation,
  runWithConcurrencyLimit,
} from "../../src/p3/policy";
import type { ExecutorResult, HuntScenario } from "../../src/p3/contracts";

describe("selectTopScenarios", () => {
  it("ranks by risk and limits the list", () => {
    const scenarios: HuntScenario[] = [
      {
        id: "low",
        summary: "low",
        rationale: "low",
        targetArea: "checkout",
        risk: "low",
        mode: "read_safe",
        guardrails: [],
        expectedEvidence: ["finalUrl"],
      },
      {
        id: "high",
        summary: "high",
        rationale: "high",
        targetArea: "checkout",
        risk: "high",
        mode: "read_safe",
        guardrails: [],
        expectedEvidence: ["finalUrl"],
      },
      {
        id: "medium",
        summary: "medium",
        rationale: "medium",
        targetArea: "checkout",
        risk: "medium",
        mode: "read_safe",
        guardrails: [],
        expectedEvidence: ["finalUrl"],
      },
    ];

    expect(selectTopScenarios(scenarios, 2).map((s) => s.id)).toEqual([
      "high",
      "medium",
    ]);
  });
});

describe("ensureExecutableScenario", () => {
  it("throws when a mutating scenario has no guardrails", () => {
    expect(() =>
      ensureExecutableScenario({
        id: "s1",
        summary: "danger",
        rationale: "mutates",
        targetArea: "billing",
        risk: "high",
        mode: "mutating",
        guardrails: [],
        expectedEvidence: ["consoleSignals"],
      }),
    ).toThrow(/guardrails/i);
  });
});

describe("shouldCreateInvestigation", () => {
  it("requires a failed outcome with evidence", () => {
    const failed: ExecutorResult = {
      scenarioId: "s1",
      outcome: "failed",
      summary: "boom",
      evidence: ["console error"],
      consoleSignals: [],
      networkSignals: [],
    };
    const uncertain: ExecutorResult = {
      scenarioId: "s2",
      outcome: "uncertain",
      summary: "maybe",
      evidence: ["timeout"],
      consoleSignals: [],
      networkSignals: [],
    };
    expect(shouldCreateInvestigation(failed)).toBe(true);
    expect(shouldCreateInvestigation(uncertain)).toBe(false);
  });
});

describe("runWithConcurrencyLimit", () => {
  it("preserves input order while running with a bounded worker pool", async () => {
    const results = await runWithConcurrencyLimit(
      [30, 10, 20],
      2,
      async (value) => {
        await new Promise((resolve) => setTimeout(resolve, value));
        return value / 10;
      },
    );

    expect(results).toEqual([3, 1, 2]);
  });
});
