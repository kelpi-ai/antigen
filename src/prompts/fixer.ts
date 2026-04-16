import type { TicketContext } from "../linear/fetchTicketContext";

export function buildFixerPrompt(input: {
  ticket: TicketContext;
  worktreePath: string;
  branch: string;
  targetAppUrl: string;
}): string {
  return `
Fix the issue from Linear ticket ${input.ticket.identifier} in branch ${input.branch} (worktree: ${input.worktreePath}).
Use ticket ${input.ticket.ticketId} (${input.ticket.url}) in module "${input.ticket.module}".

Ticket Details:
Title: ${input.ticket.title}
Body: ${input.ticket.body}
Similar issue context: ${input.ticket.similarIssueContext}

Run and validate locally with target app URL: ${input.targetAppUrl}
Environment hints:
- browser: ${input.ticket.environmentHints.browser}
- os: ${input.ticket.environmentHints.os}
- viewport: ${input.ticket.environmentHints.viewport}

Plan and execute with strict red-green:
1) Reproduce and implement a failing red test.
2) Implement a green fix.
3) Add regression guard and prove it in the final evidence.
If reproduction is unclear, use systematic-debugging to narrow down assumptions before editing.

If this is a browser-visible bug, verify with browser runs against the provided URL and include browserVerificationEvidence.
For layout or missing-element issues, include an accessibility tree diff as part of your validation.

When finished, commit and push with local git.
Then use GitHub MCP to open a draft PR.

Return exactly one line:
FIXER_RESULT {"status":"ok","prUrl":"<url>","testPath":"<path>","redEvidence":"<red proof>","greenEvidence":"<green proof>","regressionGuardEvidence":"<regression proof>","browserVerificationEvidence":"<optional browser proof>"}
`.trim();
}
