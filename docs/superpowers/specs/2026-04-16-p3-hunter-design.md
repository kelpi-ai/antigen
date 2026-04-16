# P3 Hunter - Design

**Date:** 2026-04-16
**Status:** Draft for user review
**Supersedes:** the April 15 Flow 3 hunter concept

## Summary

P3 revives the original incident-aware PR hunter idea, but redesigns it to fit the April 16 architecture and your phase-isolation constraint. The flow is self-contained: it is triggered only by the GitHub `pull_request.ready_for_review` webhook, owns its own prompts, contracts, orchestration, and policies, and does not depend on P1 or P2 internals.

When a PR is marked ready for review, P3 reads GitHub context for the PR, pulls recent incident history from Sentry MCP and related bug history from Linear MCP, ranks the highest-risk scenarios, runs a bounded hunt against the PR preview environment, posts one advisory PR summary comment, and opens or updates Linear investigation tickets for credible failures. P3 remains advisory in v1 and never blocks merge by itself.

## Goals

- Keep the original Phase 3 value: incident-aware regression hunting on PRs.
- Redesign P3 so it is independently shippable and phase-isolated.
- Trigger only from the GitHub `pull_request.ready_for_review` webhook.
- Use `PR diff + incident history` to rank scenarios instead of running a static suite.
- Hunt against the PR preview environment by default.
- Allow both read-safe and state-changing scenarios, but only when the scenario contract explicitly declares the execution mode and guardrails.
- Post one consolidated advisory PR comment per run.
- Open or update Linear investigation tickets for credible failures.

## Non-goals

- Depending on P1 reproducer modules, artifacts, or runtime code paths.
- Depending on P2 fixer modules, prompts, or ticket-consumption logic.
- Becoming a required merge gate in v1.
- Loading or cloning the full repository by default.
- Creating draft fix PRs or entering the fixer loop automatically.
- Running arbitrary exploratory browser sessions with no incident basis.

## Hard Boundaries

### Trigger boundary

P3 starts only from the GitHub webhook for `pull_request.ready_for_review`.

### Phase-isolation boundary

P3 may live inside the shared Hono + Inngest app shell, but all P3 logic is owned by P3 modules. It does not call P1 or P2 functions and does not rely on P1/P2-specific contracts, prompts, or helper modules.

### External surface boundary

P3 may talk directly to:

- GitHub MCP for PR metadata, diffs, file content, deployment information, and PR comments
- Sentry MCP for incident history and error context
- Linear MCP for searching related bugs and opening or updating investigation tickets

These are direct tool surfaces for P3, not indirect integrations through another phase.

## External And Internal Contracts

### External trigger

GitHub sends a `pull_request` webhook. P3 accepts only the `ready_for_review` action. All other actions are ignored.

### Internal event contract

The webhook adapter emits a repo-owned event:

```ts
{
  prNumber: number;
  repo: string;
  prUrl: string;
  headSha: string;
  baseSha: string;
  previewUrl?: string;
}
```

This event contains only the routing fields needed by the hunter. P3 fetches richer context later through GitHub MCP.

### Scenario contract

The planner returns a ranked list of scenarios:

```ts
{
  id: string;
  summary: string;
  rationale: string;
  targetArea: string;
  routeHint?: string;
  risk: "high" | "medium" | "low";
  mode: "read_safe" | "mutating";
  guardrails: string[];
  expectedEvidence: string[];
}
```

The `mode` field is mandatory. Mutating scenarios are allowed only when the planner explicitly marks them as `mutating` and supplies guardrails.

### Executor result contract

Each executor returns structured output:

```ts
{
  scenarioId: string;
  outcome: "passed" | "failed" | "uncertain";
  summary: string;
  finalUrl?: string;
  consoleSignals: string[];
  networkSignals: string[];
  evidence: string[];
}
```

### Reducer output contract

The reducer returns the actions for the host runtime:

```ts
{
  status: "clean" | "failures" | "partial" | "skipped";
  prComment: string;
  investigationTickets: Array<{
    action: "create" | "update";
    identifier?: string;
    title: string;
    body: string;
  }>;
}
```

## Architecture

P3 is a three-stage durable workflow.

### 1. Planner

The planner:

- reads PR metadata, changed files, unified diff, and deployment information from GitHub MCP
- reads recent or recurring incidents from Sentry MCP
- reads related open or recent bug history from Linear MCP
- ranks the highest-risk scenarios for this PR

The ranking signal is the intersection of:

- what changed in the PR
- where incidents have happened before
- what open or recent bug history suggests is fragile

### 2. Executors

Executors run the top-ranked scenarios against the PR preview environment.

Key rules:

- Executors run with bounded parallelism per PR.
- Each executor gets its own isolated browser session.
- Read-safe and mutating scenarios may both exist in one run.
- Mutating scenarios must follow the scenario guardrails exactly.
- Rich artifacts are collected only for failures or ambiguous results; clean passes stay lightweight.

### 3. Reducer

The reducer:

- consolidates all executor outputs
- separates credible failures from noisy or uncertain outcomes
- writes one advisory PR summary comment
- opens or updates Linear investigation tickets when the failure signal is strong enough

P3 does not open fix PRs and does not automatically hand off into P2.

## Component Layout

Recommended ownership split:

- `src/webhooks/github.ts`
  verifies the GitHub webhook, filters to `ready_for_review`, and emits the normalized event
- `src/inngest/functions/onPrReadyForReview.ts`
  owns the planner step, executor fan-out, reducer step, retries, and concurrency
- `src/prompts/hunterPlanner.ts`
  builds the planner prompt
- `src/prompts/hunterExecutor.ts`
  builds one executor prompt from one scenario
- `src/prompts/hunterReducer.ts`
  builds the reducer prompt
- `src/p3/contracts.ts`
  owns P3-specific event, scenario, executor, and reducer types
- `src/p3/parse.ts`
  parses structured planner, executor, and reducer outputs
- `src/p3/policy.ts`
  owns bounded parallelism, dedupe windows, scenario budgets, and mutating-scenario rules

This keeps P3 understandable and shippable on its own.

## Repo Context Rule

P3 does not load the whole repository by default.

P3 uses progressive repo context through GitHub MCP:

1. Start with:
   - PR metadata
   - changed files
   - unified diff
   - preview or deployment information
2. Expand only when needed:
   - contents of touched files
   - nearby tests
   - route or config files
   - small supporting files that explain ownership or runtime behavior
3. Avoid as the normal path:
   - full-repo scans
   - whole-repo checkout
   - broad dependency on local workspace code

This keeps the hunter focused on signal instead of broad repo ingestion.

## Execution Model

### Trigger policy

In v1, P3 runs on every PR marked `ready_for_review`.

### Parallelism

P3 uses bounded parallelism within one PR so the run stays fast enough to be useful, but low enough to reduce preview-state interference. The exact limit should be configurable, with a low default.

### Preview target

The default target is the PR preview environment, not localhost.

If no preview URL is available, the run should be marked `skipped` and the PR comment should say why.

## Ticketing Policy

When P3 finds a credible failure:

- it posts one consolidated PR comment
- it opens or updates a Linear investigation ticket

The investigation ticket is intentionally lighter than a P2-ready fixer ticket. It records the scenario, evidence, and why the PR appears risky, but it does not claim that the issue has already been reproduced to fixer standards.

P3 should dedupe against recent open investigations before creating a new ticket.

## Error Handling And Guardrails

- Invalid GitHub signature: reject the webhook and emit nothing.
- Non-`ready_for_review` action: return `204`; emit nothing.
- Missing preview URL: mark the hunt `skipped`; post a concise advisory comment.
- Planner cannot produce trustworthy scenarios: stop early with a low-noise advisory comment.
- Executor outcomes are `passed`, `failed`, or `uncertain`.
- Only credible `failed` results may create or update Linear investigation tickets.
- `uncertain` results stay in the PR comment and do not open tickets automatically.
- Mutating scenarios must be explicitly declared in the scenario contract and carry guardrails.
- One hunt run produces one consolidated PR comment.

## Testing Strategy

### Unit tests

- GitHub webhook signature validation and event filtering
- normalized event shape
- planner, executor, and reducer prompt contract tests
- structured output parser tests
- policy tests for scenario mode handling, dedupe, and bounded parallelism

### Workflow tests

- `on-pr-ready-for-review` registration and trigger contract
- planner output handling
- executor fan-out behavior
- reducer consolidation behavior
- skip paths and failure paths

### Manual validation

- send a fake `ready_for_review` webhook
- confirm planner -> executor fan-out -> reducer in Inngest
- confirm one advisory PR comment is produced
- confirm a credible failure creates or updates a Linear investigation ticket
- confirm missing-preview and uncertain-result paths stay low-noise

## Decisions Fixed For V1

- Trigger from GitHub `pull_request.ready_for_review` only.
- Keep P3 self-contained and phase-isolated.
- Use GitHub, Sentry, and Linear MCP directly.
- Rank scenarios from `PR diff + incident history`.
- Hunt against PR preview environments by default.
- Stay advisory only in v1.
- Post one consolidated PR comment.
- Open or update Linear investigation tickets for credible failures.
- Allow both read-safe and mutating scenarios, but require explicit scenario metadata and guardrails.
- Use progressive repo context instead of whole-repo context by default.

## Open Questions Deferred Past V1

- Whether P3 should ever become a required PR check
- Whether trigger policy should move from every ready PR to opt-in or path-based rules
- Whether investigation tickets should ever become directly consumable by P2
- Whether richer artifacts should be collected for all runs instead of failures and ambiguous outcomes only
