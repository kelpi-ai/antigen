# P2 Fixer — Design

**Date:** 2026-04-16
**Status:** Approved for planning
**Depends on:** P0 only at ship time; must integrate cleanly with P1 when P1 lands

## Summary

P2 turns a Linear bug ticket into a draft fix PR. The Linear webhook is only an external adapter and trigger. The durable fixer flow runs in Inngest, creates an isolated git worktree for the target repository, fetches the latest ticket context through Linear MCP, writes a regression test first, proves red, applies the minimal fix, proves green, and opens a draft PR containing both the test and the fix.

The regression test is the durable knowledge base for future bug prevention. The Linear ticket is the transient incident record that may contain reproduction steps, expected versus actual behavior, environment details, replay links, error signatures, and references to previous similar issues.

## Goals

- Accept manually created Linear bug tickets before P1 exists.
- Integrate with future P1 output without changing P2 architecture.
- Enforce TDD as a hard invariant: regression test first, then fix.
- Keep concurrent fixer runs isolated and conflict-aware.
- Produce a draft PR that contains the regression test and the minimal code fix.
- Preserve the regression suite as the long-term knowledge base for preventing repeated bugs.

## Non-Goals

- Depending on P1-specific payload structure.
- Supporting multiple target repositories in v1.
- Accepting arbitrary Linear tickets without bug intent.
- Allowing prompt-only TDD discipline without proof.
- Committing speculative or weakly justified tests to `tests/regressions/`.

## External And Internal Contracts

### External input

Linear sends its native webhook payload to `POST /webhooks/linear`.

P2 accepts only:

- `Issue` create events
- tickets with a `bug` label

All other events are ignored.

### Internal event contract

The webhook adapter emits a normalized Inngest event that belongs to this repo, not to Linear:

```ts
{
  ticketId: string;
  identifier: string;
  module: string;
  url: string;
}
```

This event contains only the routing fields needed immediately:

- `ticketId` for later Linear MCP fetches
- `identifier` for worktree and branch naming
- `module` for concurrency control
- `url` for traceability

The internal event contract isolates the rest of the system from Linear webhook schema changes.

## Ticket Context Model

Linear is the working incident record for P2. The fixer fetches the live ticket through Linear MCP before prompt construction.

The ticket may contain any of the following:

- reproduction steps
- expected versus actual behavior
- environment, page, or route details
- selectors or user inputs
- replay links
- error signatures
- links or notes about previous similar issues
- labels such as `module:*`, `source:reproducer`, or `source:hunter`

P2 proceeds best-effort when the ticket is weakly structured. Codex should extract whatever reliable context it can, but it must not invent certainty. References to previous similar issues are hints that can guide debugging and test design, but they do not replace validating the current bug. If the reproduction is ambiguous, flaky, or under-specified, the fixer must switch into the `systematic-debugging` skill workflow before applying a fix.

## Architecture

### `src/webhooks/linear.ts`

Responsibilities:

- verify `linear-signature`
- parse the Linear webhook payload
- filter to bug-labeled `Issue create` events
- extract `module:*` when present
- fall back to `module = "unknown"` when missing
- emit the normalized `linear/ticket.created` event

This module does not fetch extra ticket detail and does not perform any fixer logic.

### `src/inngest/functions/onLinearTicket.ts`

Responsibilities:

- receive the normalized event
- fetch the latest full ticket context through Linear MCP
- create an isolated worktree
- build the fixer prompt
- invoke Codex inside the worktree
- parse structured completion output
- remove the worktree in a `finally` path

This function owns sequencing, retries, concurrency, and cleanup.

### `src/git/worktree.ts`

Responsibilities:

- create a uniquely named worktree under `TARGET_REPO_WORKTREE_ROOT`
- create a matching fix branch
- remove the worktree on completion or failure

This module hides raw `git worktree add` and `git worktree remove` subprocess handling.

### `src/prompts/fixer.ts`

Responsibilities:

- turn ticket context plus worktree metadata into one deterministic fixer prompt
- encode the red-green contract
- direct the regression test into `tests/regressions/`
- require a draft PR
- require machine-parsable completion output

## Repository Strategy

P2 targets one configured repository in v1 through `TARGET_REPO_PATH`.

Each fixer run creates a dedicated worktree so:

- concurrent runs do not trample each other
- Codex can work in a clean branch
- cleanup is explicit and auditable

P2 does not choose repositories dynamically from Linear ticket content in v1.

## Concurrency Model

P2 serializes fixer runs by module and allows parallelism across modules.

- If a ticket has `module:checkout`, its concurrency key is `checkout`.
- If a ticket has no module label, its concurrency key is `unknown`.

This gives P2 safe default behavior:

- same-area fixes do not race
- unrelated modules can progress in parallel
- unlabeled tickets still move forward instead of blocking on human labeling

## TDD Contract

TDD is a success condition, not a suggestion.

The fixer must follow this order:

1. Fetch and understand the Linear ticket context.
2. Write a focused regression test in `tests/regressions/`.
3. Run the test and observe a real failure.
4. If the repro is unclear or the failure is not trustworthy, switch into the `systematic-debugging` skill workflow.
5. Write the minimal fix.
6. Run the regression test again and observe a real pass.
7. Open a draft PR containing the regression test and the fix.

The orchestrator must not treat the run as successful unless it receives machine-parsable proof of:

- the failing test run
- the passing rerun
- the draft PR URL

A draft PR URL alone is insufficient.

## Knowledge Base Rule

The committed regression test is the durable knowledge artifact for future bug prevention.

Rules:

- one bug should produce one focused regression test
- test naming should be traceable to the Linear ticket
- only validated incident regressions belong in `tests/regressions/`
- speculative tests do not belong in the durable suite
- the regression test and fix land in the same PR

This keeps the suite trustworthy: every test in `tests/regressions/` corresponds to a real incident that was reproduced, fixed, and preserved.

## Completion Contract

The fixer prompt should require structured output rather than a single loose string.

The minimum completion payload must contain:

```ts
{
  status: "ok";
  prUrl: string;
  testPath: string;
  redEvidence: string;
  greenEvidence: string;
}
```

If any required field is missing, the run is treated as failed.

The draft PR body should also include the same red and green evidence so reviewers can audit the TDD claim without inspecting raw orchestration logs.

## Failure Handling

- Invalid webhook signature: return `401`; emit nothing.
- Wrong Linear event type or non-bug ticket: return `204`; emit nothing.
- Missing `module:*` label: emit with `module = "unknown"`.
- Linear MCP fetch failure: fail the Inngest run before worktree creation and allow retry.
- Worktree creation failure: fail the run.
- Codex failure after worktree creation: remove the worktree in `finally`, then fail the run.
- Missing structured completion payload or missing red-green proof: fail the run even if a PR exists.

## Testing Strategy

### Unit tests

- webhook tests for signature validation, event filtering, module extraction, and `unknown` fallback
- worktree tests for create, remove, and git failure handling
- prompt contract tests for red-green requirements, draft PR requirement, test destination, and structured completion format
- orchestrator tests for sequence, cleanup, concurrency configuration, Linear MCP fetch behavior, and failure handling

### Manual validation

P2 must be manually testable before P1 exists:

- create a Linear bug ticket manually
- include whatever reproduction context is available
- send or simulate the matching webhook
- confirm the function fetches live ticket data via Linear MCP
- confirm a worktree is created and later removed
- confirm success only when red-green evidence and a draft PR URL are returned

## Integration With P1

P2 must not depend on P1 internals.

When P1 lands, integration should require only that P1 create Linear tickets that satisfy the same external contract:

- `Issue create`
- `bug` label
- optional `module:*`
- rich ticket context in the body, comments, or linked artifacts

P2 remains unchanged because it already consumes live ticket context through Linear MCP rather than depending on a fixed webhook snapshot from P1.

## Acceptance Criteria

- P2 works with manually created bug-labeled Linear tickets before P1 exists.
- The webhook layer is only an adapter and emits a repo-owned normalized event.
- Routing fields needed immediately are available without an extra fetch.
- Full ticket context is fetched through Linear MCP inside the durable flow.
- Missing `module:*` labels fall back to `unknown`.
- Worktrees are always cleaned up.
- Success requires explicit red-green evidence and a draft PR URL.
- The committed regression test is treated as the durable knowledge base for future bug prevention.
