import type { ReadyForReviewEvent } from "../p3/contracts";

export interface HunterPlannerPromptInput {
  event: ReadyForReviewEvent;
  maxScenarios: number;
}

export function buildHunterPlannerPrompt(
  input: HunterPlannerPromptInput,
): string {
  return `You are the P3 Hunter Planner.

A pull request is ready for review:
- Repo: ${input.event.repo}
- PR number: ${input.event.prNumber}
- PR URL: ${input.event.prUrl}
- Base SHA: ${input.event.baseSha}
- Head SHA: ${input.event.headSha}

Your job is to:
1. Use GitHub MCP to fetch PR metadata, changed files, unified diff, and deployment information.
2. Resolve the preview URL from GitHub if one exists.
3. Use Sentry MCP to pull recent or recurring incidents related to the changed areas.
4. Use Linear MCP to pull open or recent bug history related to the changed areas.
5. Correlate the diff and the incident history.
6. Produce exactly ${input.maxScenarios} ranked scenarios for executor runs.

Progressive repo context rule:
- Start with PR metadata, changed files, unified diff, and deployment information.
- Read targeted file contents or nearby tests only when needed.
- Do not load the whole repository by default.

Scenario rules:
- Every scenario must include id, summary, rationale, targetArea, risk, mode, guardrails, and expectedEvidence.
- mode must be either "read_safe" or "mutating".
- Any "mutating" scenario must include at least one guardrail.

Output exactly one line in this format:
P3_PLANNER_JSON {"previewUrl":"https://... or null","scenarios":[...]}

Do not print markdown. Do not print prose before or after the tagged JSON line.`;
}
