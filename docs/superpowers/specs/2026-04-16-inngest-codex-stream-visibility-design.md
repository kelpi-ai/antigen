# Inngest Codex Stream Visibility Design

**Date:** 2026-04-16
**Status:** Draft for review
**Depends on:** `docs/superpowers/specs/2026-04-16-p2-fixer-design.md`

## Summary

This design improves live visibility for the P2 localhost fixer flow by surfacing nested Codex execution output inside the Inngest run UI. Today the run graph shows `run-fixer` as one opaque step until the child `codex exec` process exits. After this change, the run should show live stdout and stderr from Codex while preserving explicit phase boundaries around transcript persistence and result parsing.

The change is intentionally operational rather than architectural. It does not change the Linear webhook contract, the fixer prompt contract, or the success criteria for the P2 flow. It adds a streaming and logging layer around the existing fixer execution path so operators can observe progress and diagnose stalls in real time.

## Goals

- Show live Codex stdout and stderr inside the Inngest run for `on-linear-ticket`.
- Preserve a readable run graph with explicit phase boundaries before and after the nested fixer execution.
- Keep the full raw transcript available outside the UI in a persisted artifact for later debugging.
- Avoid breaking already-correct fixer behavior or relaxing `FIXER_RESULT` parsing.
- Keep the solution compatible with real local runs, Inngest dev server runs, and future production-style execution.

## Non-goals

- Changing the fixer prompt to require a new progress protocol.
- Replacing the strict `FIXER_RESULT` contract.
- Building a separate transcript viewer UI outside Inngest.
- Persisting unbounded raw logs directly into step return payloads.
- Depending on extra fetches from external systems to render progress.

## Problem Statement

The current flow emits these visible checkpoints:

- `fetch-ticket-context`
- `verify-target-checkout`
- `fetch-target-remote`
- `pull-target-base-branch`
- `create-worktree`
- `build-prompt`
- `run-fixer`
- `remove-worktree`

The most important operational step, `run-fixer`, is opaque for most of its lifetime. When nested Codex work is slow, blocked on dependency setup, or drifting, the run UI does not show enough information to explain whether the run is healthy. The only complete transcript is the child process output captured after exit, which is too late for live debugging.

## Recommended Approach

Use live process-stream logging plus explicit phase steps:

1. Stream child `codex exec` stdout and stderr into Inngest logs while the process is running.
2. Keep `run-fixer` as the live execution phase.
3. Add explicit follow-up steps for transcript persistence and result parsing.
4. Persist the full raw transcript to disk as best-effort evidence.

This approach is safer than introducing a new prompt-side progress protocol because it observes the existing child process directly and does not depend on model compliance for basic visibility.

## Architecture

### `src/codex/invoke.ts`

Responsibilities after this change:

- spawn the child `codex exec` process
- continue buffering full stdout and stderr for the final return value
- optionally notify observers as stdout and stderr chunks arrive
- optionally notify observers when the process starts and exits

Proposed interface shape:

```ts
export interface InvokeObserver {
  onStart?(meta: { command: string; args: string[]; cwd?: string }): void;
  onStdout?(chunk: string): void;
  onStderr?(chunk: string): void;
  onExit?(meta: { exitCode: number }): void;
}
```

`invokeCodex()` remains the only place that touches `child_process.spawn`. The streaming callbacks are additive and must not change its buffered return contract.

### `src/codex/fixer.ts`

Responsibilities after this change:

- separate execution, transcript persistence, and result parsing into distinct operations
- expose a fixer-level observer that can receive structured lifecycle markers and raw stream chunks
- write the full transcript to `ARTIFACTS_DIR` on a best-effort basis
- keep `parseFixerResult()` strict and unchanged in spirit

The fixer layer should expose three operations:

- run Codex and collect transcript
- persist transcript
- parse final `FIXER_RESULT`

This keeps the Inngest function in control of workflow boundaries while preserving a cohesive fixer module.

### `src/inngest/functions/onLinearTicket.ts`

Responsibilities after this change:

- pass an Inngest-aware logger into the fixer observer
- emit structured markers around nested execution
- keep explicit workflow steps for scanability in the run graph

The revised phase order becomes:

- `fetch-ticket-context`
- `verify-target-checkout`
- `fetch-target-remote`
- `pull-target-base-branch`
- `create-worktree`
- `build-prompt`
- `run-fixer`
- `persist-fixer-transcript`
- `parse-fixer-result`
- `remove-worktree`

`run-fixer` remains the live phase where stdout and stderr are streamed. The following two steps separate post-run evidence handling from contract validation.

## Logging Model

The Inngest UI should show two kinds of visibility during fixer execution:

- raw chunks from stdout and stderr
- structured lifecycle markers

Recommended structured markers:

- `fixer.spawn`
- `fixer.stdout`
- `fixer.stderr`
- `fixer.exit`
- `fixer.persisted`
- `fixer.parse.start`
- `fixer.parse.ok`

The structured markers should contain compact metadata only. They should not repeat the entire prompt, environment, or transcript.

## Transcript Retention

The UI view should be rolling and truncated for readability. The full transcript should be persisted to disk outside the step payload.

Recommended artifact behavior:

- store one raw transcript file per fixer run under `ARTIFACTS_DIR`
- include stdout and stderr in chronological order
- record enough metadata to link the file back to the ticket identifier and worktree

Transcript persistence is best-effort:

- if writing the transcript fails, log the failure
- do not fail a fixer run solely because transcript persistence failed
- still fail the run if `FIXER_RESULT` is missing or invalid

## Safety Constraints

- Do not log secrets, tokens, or full environment dumps.
- Do not log the full prompt body by default.
- Do not change the child process command semantics beyond adding observers.
- Do not make working code fail because Inngest logging or transcript persistence is unavailable.
- Do not let transcript persistence hide or overwrite the primary fixer failure.

## Error Handling

### Child process failure

If `codex exec` exits non-zero:

- log `fixer.exit` with the exit code
- persist whatever transcript was captured so far if possible
- propagate the original execution failure

### Transcript persistence failure

If transcript writing fails:

- log a persistence failure marker
- continue to result parsing if the execution itself succeeded

### Invalid fixer result

If stdout does not contain a valid `FIXER_RESULT` line:

- keep the transcript artifact for debugging
- fail in `parse-fixer-result`
- preserve the strict missing-proof behavior already used by the fixer

## Testing Strategy

### Unit tests

`tests/codex/invoke.test.ts`

- streams stdout chunks to an observer while still returning the full buffered stdout
- streams stderr chunks to an observer while still returning the full buffered stderr
- reports start and exit lifecycle metadata

`tests/codex/fixer.test.ts`

- persists transcript on successful execution
- does not fail the fixer when transcript persistence fails
- still fails when `FIXER_RESULT` is missing
- preserves model and reasoning overrides during streamed execution

### Workflow tests

`tests/inngest/onLinearTicket.test.ts`

- includes `persist-fixer-transcript` and `parse-fixer-result` in step order
- forwards streamed fixer output through the logger path
- preserves cleanup behavior when execution or parsing fails

### End-to-end verification

Run the real localhost flow with:

- real Linear webhook delivery through the cloudflared tunnel
- real Inngest dev server UI
- real nested Codex execution

Success criteria:

- the run UI shows live Codex output during `run-fixer`
- the run graph shows the new explicit post-run steps
- the final transcript artifact is written
- the change does not introduce errors into previously working flow paths

## Open Questions Resolved

- Show raw output or milestones only: use both.
- Show stream only inside `run-fixer` or also split surrounding phases: use both.
- Persist all raw output in the UI or truncate there and keep the full transcript elsewhere: truncate in UI, persist full transcript to disk.

## Implementation Notes

- Start with tests for streamed observer callbacks and step order before production code changes.
- Keep all new behavior additive to the current buffered execution path.
- Prefer line-batched or size-capped logging so a noisy child process does not overwhelm the UI.
