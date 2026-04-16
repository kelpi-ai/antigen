import type { ExecutorResult } from "../p3/contracts";

export interface HunterReducerPromptInput {
  repo: string;
  prNumber: number;
  prUrl: string;
  previewUrl: string | null;
  executorResults: ExecutorResult[];
}

export function buildHunterReducerPrompt(
  input: HunterReducerPromptInput,
): string {
  return `You are the P3 Hunter Reducer.

Context:
- Repo: ${input.repo}
- PR number: ${input.prNumber}
- PR URL: ${input.prUrl}
- Preview URL: ${input.previewUrl ?? "none"}

Executor results:
${JSON.stringify(input.executorResults, null, 2)}

Reducer rules:
- Post one consolidated PR comment to the PR above.
- Create or update Linear investigation tickets only for credible failures.
- Do not create draft pull requests.
- Do not enter the fixer flow.
- Treat uncertain results as advisory notes in the PR comment, not investigation tickets.

Output exactly one line in this format:
P3_REDUCER_JSON {"status":"clean|failures|partial|skipped","prComment":"...","investigationTickets":[{"action":"create|update","title":"...","body":"..."}]}

Do not print markdown. Do not print prose before or after the tagged JSON line.`;
}
