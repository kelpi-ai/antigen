# Incident Loop

AI incident-response orchestration for two high-leverage moments in the software lifecycle:

1. A new bug ticket arrives in Linear and should become a verified fix branch.
2. A pull request becomes ready for review and should trigger targeted regression hunting.

The app is built around Inngest, Hono, and Codex. It turns signed webhooks into auditable automation runs with transcripts, artifacts, and deterministic tests.

## Why This Matters

Most teams still handle incidents with disconnected tools:

- Monitoring finds the problem.
- A ticket gets filed.
- Someone manually reproduces it.
- Someone else later reviews the fix.

This project closes that loop.

- `P2` reacts to a Linear bug ticket, builds a disposable worktree, runs Codex against the target repo, requires proof of a regression guard, publishes the fix branch, and cleans up.
- `P3` reacts to a GitHub `ready_for_review` event, gathers PR context, ranks risky scenarios, drives Chrome-backed validation, and leaves structured artifacts for follow-up.

## Judge Walkthrough

If you only have a few minutes, use this path.

### 1. Start the app

```bash
pnpm install
cp .env.example .env
pnpm dev
```

In a second terminal:

```bash
npx inngest-cli@latest dev
```

Useful URLs:

- App health: `http://localhost:3000/health`
- Inngest handler: `http://localhost:3000/api/inngest`
- Inngest UI: `http://localhost:8288`

### 2. Run the end-to-end proofs

These are the fastest judge-friendly validations because they exercise the real orchestration contracts without needing a full external setup.

```bash
pnpm vitest run tests/e2e/linearP2Flow.test.ts
pnpm vitest run tests/e2e/p3Hunter.test.ts
```

### 3. Run the full verification suite

```bash
pnpm typecheck
pnpm test
```

## What The System Does

### P2: Linear Bug Ticket -> Verified Fix Branch

Trigger:

- `POST /webhooks/linear`
- Requires a valid `linear-signature`
- Only handles `Issue.create`
- Only continues for tickets labeled `bug`
- Uses the `module:*` label to shard concurrency

Flow:

1. Fetch richer ticket context from Linear.
2. Verify and update the target repo checkout.
3. Create a disposable worktree for the ticket.
4. Build a Codex fixer prompt using the ticket context and target app URL.
5. Run Codex in the worktree and stream output into logs.
6. Persist the fixer transcript.
7. Parse structured fixer proof:
   - red evidence
   - green evidence
   - regression guard evidence
   - end-to-end validation evidence
8. Commit and push the worktree changes from the host process.
9. Return a GitHub compare URL for review.
10. Remove the worktree.

Why this is useful:

- The fix is not accepted unless the automation returns proof, not just prose.
- Worktree cleanup is built in, so repeated runs do not leave the repo dirty.
- Publish happens in the host flow, which keeps the nested fixer focused on code and tests.

### P3: GitHub PR Ready For Review -> Regression Hunter

Trigger:

- `POST /webhooks/github`
- Requires a valid `x-hub-signature-256`
- Only handles `pull_request` events with `action=ready_for_review`

Flow:

1. Enqueue `github/pr.ready_for_review`.
2. Planner phase:
   - pull PR metadata, changed files, diff, and status context from GitHub
   - optionally enrich with Sentry and Linear context
   - emit exactly ranked scenarios for execution
3. Executor phase:
   - create isolated scenario workspaces
   - launch Chrome with a per-scenario profile
   - connect Codex to Chrome DevTools MCP
   - run the scenario and capture evidence
4. Reducer phase:
   - consolidate executor output
   - produce a PR comment payload
   - produce investigation ticket payloads when failures are credible
5. Persist run metadata and artifacts.

Why this is useful:

- PR review is shifted from generic smoke testing to risk-ranked scenario testing.
- Browser state and screenshots are attached to the run instead of being lost in chat.
- Optional enrichments are allowed to fail without collapsing the GitHub-first workflow.

## Judge-Friendly Repo Map

- `src/server.ts`
  Main Hono app, webhook mounts, and Inngest serve handler.
- `src/webhooks/linear.ts`
  Signed Linear webhook adapter and event filtering.
- `src/webhooks/github.ts`
  Signed GitHub webhook adapter for `ready_for_review`.
- `src/inngest/functions/onLinearTicket.ts`
  P2 orchestration entrypoint.
- `src/inngest/functions/onPrReadyForReview.ts`
  P3 orchestration entrypoint.
- `src/p3/orchestrate.ts`
  Planner / executor / reducer workflow.
- `src/git/worktree.ts`
  Disposable target repo worktree management.
- `src/git/publish.ts`
  Host-side commit / push / compare URL publishing for P2.
- `tests/e2e/linearP2Flow.test.ts`
  End-to-end proof for the Linear fixer loop.
- `tests/e2e/p3Hunter.test.ts`
  End-to-end proof for the PR hunter loop.

## Local Setup

Create `.env` from `.env.example`.

```bash
cp .env.example .env
```

### Base Variables

- `INNGEST_EVENT_KEY`
- `INNGEST_SIGNING_KEY`
- `ARTIFACTS_DIR`
- `PORT`

### P2 Variables

- `OPENAI_API_KEY`
- `TARGET_APP_URL`
- `SENTRY_WEBHOOK_SECRET`
- `LINEAR_API_KEY`
- `LINEAR_WEBHOOK_SECRET`
- `TARGET_REPO_PATH`
- `TARGET_REPO_WORKTREE_ROOT`
- `TARGET_REPO_REMOTE`
- `TARGET_REPO_BASE_BRANCH`
- `FFMPEG_BIN` optional

### P3 Variables

- `CODEX_BIN`
- `GITHUB_WEBHOOK_SECRET`
- `CHROME_PATH`
- `MAX_SCENARIOS_PER_PR`
- `P3_EXECUTOR_CONCURRENCY`

## Common Commands

```bash
pnpm dev
pnpm test
pnpm typecheck
pnpm vitest run tests/e2e/linearP2Flow.test.ts
pnpm vitest run tests/e2e/p3Hunter.test.ts
```

## Artifacts

Artifacts are written under `.incident-loop-artifacts/`.

Important outputs:

- `fixer-transcripts/`
  Raw P2 Codex transcripts for replay and debugging.
- `p3/<runId>/metadata.json`
  High-level hunter run state.
- `p3/<runId>/scenarios/<scenarioId>/profile/`
  Per-scenario Chrome profile.
- `p3/<runId>/scenarios/<scenarioId>/.codex/config.toml`
  Per-scenario Codex MCP config.
- `p3/<runId>/scenarios/<scenarioId>/failure.png`
  Screenshot when a scenario fails.

## Current Constraints

- P2 starts from Linear, not directly from Sentry.
- P2 assumes the target repo already exists locally and is writable.
- P3 is GitHub-first; Sentry and Linear are enrichments, not hard dependencies.
- Real webhook demos need valid secrets and authenticated MCP/tooling.

## What To Highlight In Judging

- Signed webhook intake on both workflows.
- Deterministic orchestration through Inngest.
- Codex output streamed into the run logs.
- Proof-based fix acceptance rather than "LLM says it is fixed".
- Disposable worktrees and scenario-specific browser profiles.
- End-to-end tests that encode the workflow contracts.
