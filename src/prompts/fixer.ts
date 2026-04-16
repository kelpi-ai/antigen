import type { TicketContext } from "../linear/fetchTicketContext";

function buildSentryContextBlock(ticket: TicketContext): string {
  if (!ticket.sentryIssue && !ticket.seer) {
    return "";
  }

  return `
Sentry / Seer Context:
- issue id: ${ticket.sentryIssue?.id ?? "unknown"}
- issue url: ${ticket.sentryIssue?.url ?? "unknown"}
- issue title: ${ticket.sentryIssue?.title ?? "unknown"}
- culprit: ${ticket.sentryIssue?.culprit ?? "unknown"}
- environment: ${ticket.sentryIssue?.environment ?? "unknown"}
- release: ${ticket.sentryIssue?.release ?? "unknown"}
- Seer summary: ${ticket.seer?.summary ?? "unavailable"}
- Seer root cause: ${ticket.seer?.rootCause ?? "unavailable"}
- Seer solution: ${ticket.seer?.solution ?? "unavailable"}
If Sentry Seer analysis is present, treat it as analysis input, not source of truth. Verify it with the repository, tests, and browser evidence before claiming success.
`.trim();
}

export function buildFixerPrompt(input: {
  ticket: TicketContext;
  worktreePath: string;
  branch: string;
  targetAppUrl: string;
}): string {
  const sentryContextBlock = buildSentryContextBlock(input.ticket);

  return `
Fix the issue from Linear ticket ${input.ticket.identifier} in branch ${input.branch} (worktree: ${input.worktreePath}).
Use ticket ${input.ticket.ticketId} (${input.ticket.url}) in module "${input.ticket.module}".

Ticket Details:
Title: ${input.ticket.title}
Body: ${input.ticket.body}
Similar issue context: ${input.ticket.similarIssueContext}
${sentryContextBlock ? `\n\n${sentryContextBlock}` : ""}

Operate only on the current incident-loop repository in ${input.worktreePath}.
Inspect and align with the existing implementation before editing:
- src/server.ts
- src/webhooks/linear.ts
- src/inngest/functions/onLinearTicket.ts
- the most relevant existing tests under tests/
Prefer editing existing files under src/ and tests/ instead of creating new subsystems.
Do not invent new API response shapes, artifact formats, webhook payload contracts, or recording behavior unless they already exist in this repository.
Preserve already-working behavior and keep the fix narrowly scoped to the reported issue.

Run and validate locally with target app URL: ${input.targetAppUrl}
Environment hints:
- browser: ${input.ticket.environmentHints.browser}
- os: ${input.ticket.environmentHints.os}
- viewport: ${input.ticket.environmentHints.viewport}

Plan and execute with strict red-green:
1) Reproduce and implement a failing red test.
2) Implement a green fix.
3) Add regression guard and prove it in the final evidence.
4) Before claiming success, run a final automated end-to-end validation against target app URL ${input.targetAppUrl} and include proof in the final result.
If reproduction is unclear, use systematic-debugging to narrow down assumptions before editing.

If this is a browser-visible bug, verify with browser runs against the provided URL and include browserVerificationEvidence.
For layout or missing-element issues, include an accessibility tree diff as part of your validation.
If target app URL ${input.targetAppUrl} is unreachable from this environment, fall back to the repository's existing signed-webhook or in-process end-to-end test harness and cite that proof.

Leave the verified code changes in the current worktree.
Do not commit, push, or open pull requests from this run. The host process will publish the branch after you return the structured result.

Return exactly one line:
FIXER_RESULT {"status":"ok","testPath":"<path>","redEvidence":"<red proof>","greenEvidence":"<green proof>","regressionGuardEvidence":"<regression proof>","e2eValidationEvidence":"<automated e2e proof>","browserVerificationEvidence":"<optional browser proof>"}
`.trim();
}
