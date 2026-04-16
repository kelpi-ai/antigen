# P2 Localhost Fixer — Design

**Date:** 2026-04-16
**Status:** Approved for planning
**Depends on:** `docs/superpowers/specs/2026-04-16-incident-loop-localhost-design.md`

## Summary

P2 remains a real fixer flow in the localhost architecture. A bug-labeled Linear issue triggers a durable Inngest workflow that fetches live ticket context through Linear MCP, refreshes a persistent local checkout of the GitHub-backed target repository, creates an isolated worktree from the latest pulled base, writes a regression test first, proves red-green, proves the fix did not break already-correct behavior, optionally verifies browser-visible behavior against the running localhost app, pushes the branch, and opens a draft PR through GitHub MCP.

The regression test remains the durable knowledge base for future bug prevention. The Linear ticket remains the transient incident record, and localhost run artifacts from P1 are supporting evidence rather than the primary API boundary.

## Goals

- Keep P2 as a true fix-and-PR flow, not a demo-only patch generator.
- Consume bug context from Linear without depending on P1 internals.
- Use a persistent local checkout of the GitHub repo as the execution substrate.
- Always branch from the latest pulled base rather than stale local state.
- Enforce TDD as a hard invariant: regression test first, then minimal fix.
- Prove the fix does not introduce new errors in already-correct paths.
- Support environment-specific verification for browser-visible bugs on localhost.
- Use GitHub MCP for draft PR creation while keeping code mutation local.

## Non-Goals

- Starting or managing the localhost app process.
- Cloning a fresh repository for every fix run.
- Using GitHub MCP as a replacement for local git operations.
- Treating localhost run artifact layout as the primary contract between P1 and P2.
- Making browser verification mandatory for non-UI or non-browser-visible bugs.

## External And Internal Contracts

### External input

Linear sends its native webhook payload to `POST /webhooks/linear`.

P2 accepts only:

- `Issue` create events
- tickets with a `bug` label

All other events are ignored.

### Internal event contract

The webhook adapter emits a repo-owned Inngest event:

```ts
{
  ticketId: string;
  identifier: string;
  module: string;
  url: string;
}
```

This event carries only the routing fields needed immediately:

- `ticketId` for the later Linear MCP fetch
- `identifier` for branch and worktree naming
- `module` for concurrency control
- `url` for traceability and PR linking

The rest of the system depends on this internal contract, not on the raw Linear webhook schema.

## Configuration

P2 extends the localhost runtime with repo-specific settings:

- `LINEAR_WEBHOOK_SECRET`
- `TARGET_REPO_PATH`
- `TARGET_REPO_WORKTREE_ROOT`
- `TARGET_REPO_REMOTE` default `origin`
- `TARGET_REPO_BASE_BRANCH` default `main`

P2 also relies on localhost P1 runtime settings already introduced by the localhost design:

- `OPENAI_API_KEY`
- `TARGET_APP_URL`
- `LINEAR_API_KEY`

The persistent checkout at `TARGET_REPO_PATH` must already be a valid git clone of the GitHub repo and must have a working remote matching `TARGET_REPO_REMOTE`.

## Ticket Context Model

Linear is the working incident record for P2. The fixer fetches the live ticket through Linear MCP before prompt construction.

The ticket may contain:

- reproduction steps
- expected versus actual behavior
- route and page details
- user inputs or selectors
- replay links or localhost artifact references from P1
- error signatures
- similar past issue references
- environment hints such as browser, OS, and viewport size
- labels such as `module:*`, `source:reproducer`, or `source:hunter`

P2 proceeds best-effort when the ticket is weakly structured. Codex should extract whatever reliable context it can, but it must not invent certainty. If the reproduction is ambiguous, flaky, or under-specified, the fixer must switch into the `systematic-debugging` skill workflow before applying a fix.

## Architecture

### `src/webhooks/linear.ts`

Responsibilities:

- verify `linear-signature`
- parse the Linear webhook payload
- filter to bug-labeled `Issue create` events
- extract `module:*` when present
- fall back to `module = "unknown"` when missing
- emit the normalized `linear/ticket.created` event

This module does not fetch ticket detail and does not perform fixer logic.

### `src/git/updateCheckout.ts`

Responsibilities:

- validate that `TARGET_REPO_PATH` is a git checkout
- fetch the latest refs from `TARGET_REPO_REMOTE`
- fast-fail if the checkout cannot be refreshed
- update local knowledge of `TARGET_REPO_BASE_BRANCH` before worktree creation

This module exists so “refresh base checkout” is independently testable from worktree creation.

### `src/git/worktree.ts`

Responsibilities:

- create a uniquely named worktree under `TARGET_REPO_WORKTREE_ROOT`
- create a matching fix branch from the refreshed base branch
- remove the worktree on completion or failure

### `src/linear/fetchTicketContext.ts`

Responsibilities:

- use Codex SDK + Linear MCP to fetch the latest ticket body, comments, labels, and relevant similar-issue context
- return typed ticket context including browser / OS / viewport hints when available

### `src/prompts/fixer.ts`

Responsibilities:

- turn ticket context, localhost runtime context, and worktree metadata into a deterministic fixer prompt
- encode the red-green contract
- encode the regression-guard requirement
- direct verification toward `TARGET_APP_URL`
- require browser-specific verification when the ticket makes that relevant
- require GitHub MCP draft PR creation
- require machine-parsable completion output

### `src/codex/fixer.ts`

Responsibilities:

- invoke the Codex fixer through the SDK path
- provide the fixer prompt and execution context
- parse the structured completion payload
- reject incomplete or invalid proof

### `src/inngest/functions/onLinearTicket.ts`

Responsibilities:

- receive the normalized event
- fetch live ticket context through Linear MCP
- refresh the persistent checkout from GitHub
- create the worktree from the refreshed base
- build the fixer prompt
- invoke Codex in the worktree
- remove the worktree in a `finally` path

This function owns sequencing, retries, concurrency, and cleanup.

## Repository Strategy

P2 uses one persistent local checkout of the GitHub-backed repo at `TARGET_REPO_PATH`.

For each run:

1. fetch latest refs from `TARGET_REPO_REMOTE`
2. create a worktree from the refreshed `TARGET_REPO_BASE_BRANCH`
3. let the fixer work entirely inside that worktree
4. commit and push with local git
5. create the draft PR through GitHub MCP

P2 must not create a worktree from stale local state.

## Concurrency Model

P2 serializes fixer runs by module and allows parallelism across modules.

- `module:checkout` becomes concurrency key `checkout`
- missing `module:*` falls back to `unknown`

This keeps same-area fixes from racing while still allowing parallel work on unrelated modules.

## TDD And Verification Contract

TDD is a success condition, not a suggestion.

The fixer must follow this order:

1. Fetch and understand the Linear ticket context.
2. Write a focused regression test in `tests/regressions/`.
3. Run the test and observe a real failure.
4. If the failure is unclear or untrustworthy, switch into the `systematic-debugging` workflow.
5. Write the minimal fix.
6. Run the regression test again and observe a real pass.
7. Run a focused regression guard against behavior that was already correct before the fix.
8. If the bug is browser-visible, verify it against `TARGET_APP_URL`.
9. Commit, push, and open a draft PR.

Browser-visible verification rules:

- Use environment hints from the Linear ticket when available.
- If the ticket suggests Safari or WebKit-specific behavior, use WebKit-capable verification instead of pretending Chrome alone proves the fix.
- For layout shift, missing elements, or broken CSS, include accessibility-tree diff evidence as supporting proof.
- Browser verification supports the claim, but the regression test remains the canonical knowledge artifact.

## Localhost Verification Model

The localhost app is assumed to already be running at `TARGET_APP_URL`.

P2 does not start or restart the app. The fixer may:

- use Chrome DevTools MCP against the running localhost app
- use Playwright browser selection such as WebKit when environment hints require it
- compare expected browser-visible behavior before and after the fix

This keeps P2 aligned with the localhost architecture while still allowing environment-specific debugging and verification.

## Knowledge Base Rule

The committed regression test is the durable knowledge artifact for future bug prevention.

Rules:

- one bug should produce one focused regression test
- test naming should be traceable to the Linear ticket
- only validated incident regressions belong in `tests/regressions/`
- speculative tests do not belong in the durable suite
- the regression test and fix land in the same PR

## Completion Contract

The fixer must return machine-readable output:

```ts
{
  status: "ok";
  prUrl: string;
  testPath: string;
  redEvidence: string;
  greenEvidence: string;
  regressionGuardEvidence: string;
  browserVerificationEvidence?: string;
}
```

Success requires all non-optional fields. A PR URL alone is insufficient.

The draft PR body should include:

- Linear ticket URL
- red evidence
- green evidence
- regression-guard evidence
- browser verification evidence when used

## Failure Handling

- Invalid webhook signature: return `401`; emit nothing.
- Wrong Linear event type or non-bug ticket: return `204`; emit nothing.
- Missing `module:*` label: emit with `module = "unknown"`.
- Linear MCP fetch failure: fail before any git mutation.
- Checkout refresh failure: fail before worktree creation.
- Worktree creation failure: fail the run.
- Codex failure after worktree creation: remove the worktree in `finally`, then fail.
- Push failure: fail and surface the error; do not attempt PR creation.
- Missing structured completion payload or missing proof: fail even if a PR exists.

## Testing Strategy

### Unit tests

- webhook tests for signature validation, filtering, module extraction, and `unknown` fallback
- checkout-refresh tests for remote fetch behavior and failure cases
- worktree tests for create, remove, and git failure handling
- ticket-context tests for Linear MCP fetch and environment-hint parsing
- prompt tests for red-green, regression guard, localhost verification instructions, GitHub MCP draft PR creation, and structured completion payload
- fixer runner tests for structured-result parsing
- orchestrator tests for sequence, cleanup, and failure handling

### Manual validation

P2 must be manually testable once localhost P1 exists:

- ensure the target app is already running at `TARGET_APP_URL`
- create or receive a bug-labeled Linear issue
- send or simulate the matching webhook
- confirm the function fetches live ticket data via Linear MCP
- confirm the persistent checkout is refreshed before worktree creation
- confirm the worktree is removed after completion
- confirm success only when red proof, green proof, regression-guard proof, and a draft PR URL are returned
- for browser-visible bugs, confirm environment hints influence the verification path

## Integration With Localhost P1

P2 must not depend on P1 internals.

P1 should create Linear tickets that satisfy the same external contract:

- `Issue create`
- `bug` label
- optional `module:*`
- structured ticket context in the body, comments, or linked artifacts

P2 treats any localhost run artifact references in the ticket as supporting evidence. The ticket itself remains the primary handoff contract.

## Acceptance Criteria

- P2 remains a true fix-and-PR flow in the localhost architecture.
- The webhook emits a normalized repo-owned event.
- P2 refreshes the persistent checkout from GitHub before creating a worktree.
- P2 fetches live ticket context through Linear MCP.
- Local git handles checkout refresh, worktree creation, commit, and push.
- GitHub MCP handles draft PR creation.
- Success requires explicit red evidence, green evidence, regression-guard evidence, and a draft PR URL.
- Browser-visible bugs can attach localhost verification evidence without replacing the regression test as the main proof.
- Worktrees are always cleaned up.
- The committed regression test remains the durable knowledge base for future bug prevention.
