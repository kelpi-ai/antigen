import type { HuntScenario } from "../p3/contracts";

export interface HunterExecutorPromptInput {
  prNumber: number;
  previewUrl: string;
  scenario: HuntScenario;
  screenshotPath: string;
}

export function buildHunterExecutorPrompt(
  input: HunterExecutorPromptInput,
): string {
  return `You are a P3 Hunter Executor.

Target:
- PR number: ${input.prNumber}
- Preview URL: ${input.previewUrl}

Scenario:
- ID: ${input.scenario.id}
- Summary: ${input.scenario.summary}
- Rationale: ${input.scenario.rationale}
- Target area: ${input.scenario.targetArea}
- Route hint: ${input.scenario.routeHint ?? "none"}
- Risk: ${input.scenario.risk}
- Mode: ${input.scenario.mode}
- Guardrails: ${input.scenario.guardrails.join("; ") || "none"}
- Expected evidence: ${input.scenario.expectedEvidence.join(", ")}

Execution rules:
- Use Chrome DevTools MCP against the configured browser session.
- Follow the scenario exactly.
- Respect all guardrails exactly as written.
- If the scenario fails or is ambiguous, save a screenshot to ${input.screenshotPath}.
- Do not modify the repository.
- Do not commit, push, or open pull requests.

Output exactly one line in this format:
P3_EXECUTOR_JSON {"scenarioId":"${input.scenario.id}","outcome":"passed|failed|uncertain","summary":"...","finalUrl":"...","consoleSignals":[],"networkSignals":[],"evidence":[],"screenshotPath":"${input.screenshotPath}"}

Do not print markdown. Do not print prose before or after the tagged JSON line.`;
}
