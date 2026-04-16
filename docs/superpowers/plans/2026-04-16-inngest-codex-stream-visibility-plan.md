# Inngest Codex Stream Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose live nested Codex stdout and stderr in the Inngest run UI, persist the full raw fixer transcript to disk, and keep the workflow graph readable with explicit transcript and parse steps.

**Architecture:** `src/codex/invoke.ts` gets additive observer hooks and a structured non-zero-exit error so child-process output can be streamed without losing buffered output. `src/codex/fixer.ts` collects chronological transcript data, persists it under `ARTIFACTS_DIR`, and preserves strict `FIXER_RESULT` parsing. `src/inngest/functions/onLinearTicket.ts` logs streamed fixer output through `console`, splits the flow into `run-fixer`, `persist-fixer-transcript`, and `parse-fixer-result`, and persists transcripts before rethrowing execution failures.

**Tech Stack:** TypeScript 5.x, Node child process APIs, Node fs/promises, path, pnpm, Inngest, vitest

**Spec:** `docs/superpowers/specs/2026-04-16-inngest-codex-stream-visibility-design.md`

---

## File Structure

```text
src/
  codex/invoke.ts                    # stream child-process lifecycle and preserve output on failure
  codex/fixer.ts                     # collect transcript, persist transcript, parse FIXER_RESULT
  inngest/functions/onLinearTicket.ts# log streamed fixer output and split post-run phases

tests/
  codex/invoke.test.ts               # observer hooks and structured non-zero-exit error
  codex/fixer.test.ts                # transcript collection, persistence, and parse behavior
  inngest/onLinearTicket.test.ts     # workflow step order, console markers, persistence on failure
  e2e/linearP2Flow.test.ts           # in-process step graph for the localhost webhook flow
```

## Task 1: Stream Child Process Output From `invokeCodex`

**Files:**
- Modify: `src/codex/invoke.ts`
- Modify: `tests/codex/invoke.test.ts`

- [ ] **Step 1: Add the failing observer and error-shape tests**

Append these tests to `tests/codex/invoke.test.ts`:

```ts
  it("streams stdout, stderr, and lifecycle events to an observer while buffering output", async () => {
    const events: Array<
      | { type: "start"; command: string; args: string[]; cwd?: string }
      | { type: "stdout"; chunk: string }
      | { type: "stderr"; chunk: string }
      | { type: "exit"; exitCode: number | null }
    > = [];

    spawnMock.mockReturnValue(
      fakeProc({ stdout: "first line\n", stderr: "warn line\n", exitCode: 0 }),
    );

    const result = await invokeCodex("reproduce issue 123", {
      cwd: "/tmp/repo",
      observer: {
        onStart(meta) {
          events.push({ type: "start", ...meta });
        },
        onStdout(chunk) {
          events.push({ type: "stdout", chunk });
        },
        onStderr(chunk) {
          events.push({ type: "stderr", chunk });
        },
        onExit(meta) {
          events.push({ type: "exit", exitCode: meta.exitCode });
        },
      },
    });

    expect(result).toEqual({
      stdout: "first line\n",
      stderr: "warn line\n",
      exitCode: 0,
    });
    expect(events).toEqual([
      {
        type: "start",
        command: "/usr/local/bin/codex",
        args: ["exec", "--full-auto", "reproduce issue 123"],
        cwd: "/tmp/repo",
      },
      { type: "stdout", chunk: "first line\n" },
      { type: "stderr", chunk: "warn line\n" },
      { type: "exit", exitCode: 0 },
    ]);
  });

  it("rejects with a structured execution error that preserves buffered output", async () => {
    spawnMock.mockReturnValue(
      fakeProc({ stdout: "partial output\n", stderr: "boom", exitCode: 1 }),
    );

    await expect(invokeCodex("hello")).rejects.toMatchObject({
      name: "CodexExecutionError",
      exitCode: 1,
      stdout: "partial output\n",
      stderr: "boom",
    });
  });
```

- [ ] **Step 2: Run the invoke tests to verify they fail**

Run:

```bash
pnpm test -- tests/codex/invoke.test.ts
```

Expected: FAIL because `InvokeOpts` does not accept `observer` and non-zero exits currently reject with a generic `Error`.

- [ ] **Step 3: Add observer hooks and a structured execution error**

Update `src/codex/invoke.ts` to this shape:

```ts
import { spawn } from "node:child_process";

export interface CodexResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export class CodexExecutionError extends Error {
  constructor(
    readonly exitCode: number | null,
    readonly stdout: string,
    readonly stderr: string,
  ) {
    const renderedExitCode = exitCode === null ? "null" : String(exitCode);
    super(`codex exited ${renderedExitCode}: ${stderr.trim() || "no stderr"}`);
    this.name = "CodexExecutionError";
  }
}

export interface InvokeObserver {
  onStart?(meta: { command: string; args: string[]; cwd?: string }): void;
  onStdout?(chunk: string): void;
  onStderr?(chunk: string): void;
  onExit?(meta: { exitCode: number | null }): void;
}

export interface InvokeOpts {
  cwd?: string;
  timeoutMs?: number;
  model?: string;
  reasoningEffort?: string;
  observer?: InvokeObserver;
}

export function invokeCodex(prompt: string, opts: InvokeOpts = {}): Promise<CodexResult> {
  return new Promise((resolve, reject) => {
    const codexBin = process.env.CODEX_BIN || "codex";
    const args = ["exec", "--full-auto"];

    if (opts.model) {
      args.push("--model", opts.model);
    }

    if (opts.reasoningEffort) {
      args.push("-c", `model_reasoning_effort="${opts.reasoningEffort}"`);
    }

    args.push(prompt);
    opts.observer?.onStart?.({ command: codexBin, args, cwd: opts.cwd });

    const proc = spawn(codexBin, args, {
      stdio: ["ignore", "pipe", "pipe"],
      cwd: opts.cwd,
    });

    let stdout = "";
    let stderr = "";

    proc.stdout?.on("data", (c: Buffer) => {
      const chunk = c.toString();
      stdout += chunk;
      opts.observer?.onStdout?.(chunk);
    });

    proc.stderr?.on("data", (c: Buffer) => {
      const chunk = c.toString();
      stderr += chunk;
      opts.observer?.onStderr?.(chunk);
    });

    const timeout = opts.timeoutMs
      ? setTimeout(() => {
          proc.kill("SIGKILL");
          reject(new Error(`codex timed out after ${opts.timeoutMs}ms`));
        }, opts.timeoutMs)
      : null;

    proc.on("close", (code) => {
      if (timeout) clearTimeout(timeout);
      opts.observer?.onExit?.({ exitCode: code });

      if (code === 0) {
        resolve({ stdout, stderr, exitCode: 0 });
        return;
      }

      reject(new CodexExecutionError(code, stdout, stderr));
    });

    proc.on("error", (err) => {
      if (timeout) clearTimeout(timeout);
      reject(err);
    });
  });
}
```

- [ ] **Step 4: Run the invoke tests again**

Run:

```bash
pnpm test -- tests/codex/invoke.test.ts
```

Expected: PASS with the observer and structured error tests green.

- [ ] **Step 5: Commit**

```bash
git add src/codex/invoke.ts tests/codex/invoke.test.ts
git commit -m "feat: stream codex child-process output"
```

## Task 2: Capture And Persist Fixer Transcripts

**Files:**
- Modify: `src/codex/fixer.ts`
- Modify: `tests/codex/fixer.test.ts`

- [ ] **Step 1: Add the failing fixer transcript tests**

Update `tests/codex/fixer.test.ts` to mock the filesystem and add these tests:

```ts
const { invokeCodexMock, mkdirMock, writeFileMock } = vi.hoisted(() => ({
  invokeCodexMock: vi.fn(),
  mkdirMock: vi.fn(),
  writeFileMock: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
  mkdir: (...args: unknown[]) => mkdirMock(...args),
  writeFile: (...args: unknown[]) => writeFileMock(...args),
}));
```

Append these test cases:

```ts
  it("collects a chronological transcript and forwards observer events", async () => {
    const seen: Array<string> = [];
    invokeCodexMock.mockImplementation(async (_prompt: string, opts: { observer: any }) => {
      opts.observer.onStart({ command: "codex", args: ["exec"], cwd: "/tmp/repo" });
      opts.observer.onStdout("alpha\n");
      opts.observer.onStderr("warn\n");
      opts.observer.onExit({ exitCode: 0 });
      return { stdout: "alpha\nFIXER_RESULT {\"status\":\"ok\",\"prUrl\":\"https://example.test/pr/2\",\"testPath\":\"tests/fix2.spec.ts\",\"redEvidence\":\"red\",\"greenEvidence\":\"green\",\"regressionGuardEvidence\":\"guard\",\"e2eValidationEvidence\":\"e2e proof\"}\n", stderr: "warn\n", exitCode: 0 };
    });

    const output = await runCodexTask({
      prompt: "fix this",
      cwd: "/tmp/repo",
      observer: {
        onEvent(event) {
          seen.push(event.type);
        },
      },
    });

    expect(output.transcript).toBe(
      "[stdout]\nalpha\n[stderr]\nwarn\n",
    );
    expect(seen).toEqual(["spawn", "stdout", "stderr", "exit"]);
  });

  it("persists a transcript under ARTIFACTS_DIR/fixer-transcripts", async () => {
    process.env.ARTIFACTS_DIR = "/tmp/artifacts";
    mkdirMock.mockResolvedValue(undefined);
    writeFileMock.mockResolvedValue(undefined);

    const transcriptPath = await persistFixerTranscript({
      identifier: "SID-7",
      branch: "fix/SID-7-7ff6b279",
      transcript: "[stdout]\nalpha\n",
    });

    expect(mkdirMock).toHaveBeenCalledWith(
      "/tmp/artifacts/fixer-transcripts",
      { recursive: true },
    );
    expect(writeFileMock).toHaveBeenCalledWith(
      "/tmp/artifacts/fixer-transcripts/sid-7--fix-sid-7-7ff6b279.log",
      "[stdout]\nalpha\n",
      "utf8",
    );
    expect(transcriptPath).toBe(
      "/tmp/artifacts/fixer-transcripts/sid-7--fix-sid-7-7ff6b279.log",
    );
  });

  it("returns null when transcript persistence fails", async () => {
    process.env.ARTIFACTS_DIR = "/tmp/artifacts";
    mkdirMock.mockResolvedValue(undefined);
    writeFileMock.mockRejectedValue(new Error("disk full"));

    await expect(
      persistFixerTranscript({
        identifier: "SID-7",
        branch: "fix/SID-7-7ff6b279",
        transcript: "[stdout]\nalpha\n",
      }),
    ).resolves.toBeNull();
  });
```

- [ ] **Step 2: Run the fixer tests to verify they fail**

Run:

```bash
pnpm test -- tests/codex/fixer.test.ts
```

Expected: FAIL because `runCodexTask()` still returns only `stdout` and there is no transcript persistence API.

- [ ] **Step 3: Refactor the fixer layer into execution, persistence, and parsing**

Update `src/codex/fixer.ts` to this shape:

```ts
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "../config/env";
import { CodexExecutionError, invokeCodex } from "./invoke";

export interface FixerResult {
  status: "ok";
  prUrl: string;
  testPath: string;
  redEvidence: string;
  greenEvidence: string;
  regressionGuardEvidence: string;
  e2eValidationEvidence: string;
  browserVerificationEvidence?: string;
}

export type FixerObserverEvent =
  | { type: "spawn"; command: string; args: string[]; cwd?: string }
  | { type: "stdout"; chunk: string }
  | { type: "stderr"; chunk: string }
  | { type: "exit"; exitCode: number | null }
  | { type: "persisted"; path: string }
  | { type: "persist-failed"; error: string };

export interface FixerObserver {
  onEvent?(event: FixerObserverEvent): void;
}

export interface CodexTaskOutput {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  transcript: string;
}

export class CodexTaskError extends Error {
  constructor(readonly output: CodexTaskOutput, message: string) {
    super(message);
    this.name = "CodexTaskError";
  }
}

function getOptionalEnv(name: string): string | undefined {
  const value = process.env[name];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function buildTranscript(chunks: Array<{ stream: "stdout" | "stderr"; chunk: string }>): string {
  return chunks
    .map(({ stream, chunk }) => `[${stream}]\n${chunk}`)
    .join("");
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export async function runCodexTask(input: {
  prompt: string;
  cwd?: string;
  observer?: FixerObserver;
}): Promise<CodexTaskOutput> {
  const chunks: Array<{ stream: "stdout" | "stderr"; chunk: string }> = [];

  try {
    const result = await invokeCodex(input.prompt, {
      cwd: input.cwd,
      model: getOptionalEnv("CODEX_MODEL"),
      reasoningEffort: getOptionalEnv("CODEX_REASONING_EFFORT"),
      observer: {
        onStart(meta) {
          input.observer?.onEvent?.({ type: "spawn", ...meta });
        },
        onStdout(chunk) {
          chunks.push({ stream: "stdout", chunk });
          input.observer?.onEvent?.({ type: "stdout", chunk });
        },
        onStderr(chunk) {
          chunks.push({ stream: "stderr", chunk });
          input.observer?.onEvent?.({ type: "stderr", chunk });
        },
        onExit(meta) {
          input.observer?.onEvent?.({ type: "exit", exitCode: meta.exitCode });
        },
      },
    });

    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      transcript: buildTranscript(chunks),
    };
  } catch (error) {
    if (error instanceof CodexExecutionError) {
      throw new CodexTaskError(
        {
          stdout: error.stdout,
          stderr: error.stderr,
          exitCode: error.exitCode,
          transcript: buildTranscript(chunks),
        },
        error.message,
      );
    }

    throw error;
  }
}

export async function persistFixerTranscript(input: {
  identifier: string;
  branch: string;
  transcript: string;
  observer?: FixerObserver;
}): Promise<string | null> {
  const directory = path.join(env.ARTIFACTS_DIR, "fixer-transcripts");
  const filename = `${slugify(input.identifier)}--${slugify(input.branch)}.log`;
  const outputPath = path.join(directory, filename);

  try {
    await mkdir(directory, { recursive: true });
    await writeFile(outputPath, input.transcript, "utf8");
    input.observer?.onEvent?.({ type: "persisted", path: outputPath });
    return outputPath;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    input.observer?.onEvent?.({ type: "persist-failed", error: message });
    return null;
  }
}
```

Keep the existing `parseFixerResult()` implementation in the same file. Do not weaken the required proof fields.

- [ ] **Step 4: Update the wrapper test and compatibility wrapper**

Keep a compatibility wrapper at the bottom of `src/codex/fixer.ts`:

```ts
export async function runFixer(input: { prompt: string; cwd: string }): Promise<FixerResult> {
  const output = await runCodexTask({
    prompt: input.prompt,
    cwd: input.cwd,
  });
  return parseFixerResult(output.stdout);
}
```

Update the `runFixer` test in `tests/codex/fixer.test.ts` to call the new object-based `runCodexTask()` contract indirectly through `runFixer()` and assert that parsing still works.

- [ ] **Step 5: Run the fixer tests again**

Run:

```bash
pnpm test -- tests/codex/fixer.test.ts
```

Expected: PASS with transcript collection, persistence, and strict parse behavior green.

- [ ] **Step 6: Commit**

```bash
git add src/codex/fixer.ts tests/codex/fixer.test.ts
git commit -m "feat: persist fixer transcripts"
```

## Task 3: Surface Stream Visibility In `on-linear-ticket`

**Files:**
- Modify: `src/inngest/functions/onLinearTicket.ts`
- Modify: `tests/inngest/onLinearTicket.test.ts`
- Modify: `tests/e2e/linearP2Flow.test.ts`

- [ ] **Step 1: Replace the old fixer mocks with split-phase mocks**

In `tests/inngest/onLinearTicket.test.ts`, replace the hoisted fixer mock with:

```ts
const {
  buildFixerPromptMock,
  fetchTicketContextMock,
  verifyCheckoutMock,
  fetchCheckoutRemoteMock,
  pullCheckoutBaseBranchMock,
  createWorktreeMock,
  removeWorktreeMock,
  runCodexTaskMock,
  persistFixerTranscriptMock,
  parseFixerResultMock,
  CodexTaskErrorMock,
} = vi.hoisted(() => ({
  buildFixerPromptMock: vi.fn(),
  fetchTicketContextMock: vi.fn(),
  verifyCheckoutMock: vi.fn(),
  fetchCheckoutRemoteMock: vi.fn(),
  pullCheckoutBaseBranchMock: vi.fn(),
  createWorktreeMock: vi.fn(),
  removeWorktreeMock: vi.fn(),
  runCodexTaskMock: vi.fn(),
  persistFixerTranscriptMock: vi.fn(),
  parseFixerResultMock: vi.fn(),
  CodexTaskErrorMock: class CodexTaskError extends Error {
    constructor(public output: unknown, message: string) {
      super(message);
      this.name = "CodexTaskError";
    }
  },
}));

vi.mock("../../src/codex/fixer", () => ({
  runCodexTask: runCodexTaskMock,
  persistFixerTranscript: persistFixerTranscriptMock,
  parseFixerResult: parseFixerResultMock,
  CodexTaskError: CodexTaskErrorMock,
}));
```

- [ ] **Step 2: Add the failing workflow visibility test**

Append this test to `tests/inngest/onLinearTicket.test.ts`:

```ts
  it("streams fixer output, persists the transcript, and parses in separate steps", async () => {
    const { steps, step } = createStepRecorder();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = {
      status: "ok" as const,
      prUrl: "https://example.test/pr/1",
      testPath: "tests/fix.spec.ts",
      redEvidence: "red",
      greenEvidence: "green",
      regressionGuardEvidence: "guard",
      e2eValidationEvidence: "e2e proof",
    };

    fetchTicketContextMock.mockResolvedValue(ticketContext);
    verifyCheckoutMock.mockResolvedValue(undefined);
    fetchCheckoutRemoteMock.mockResolvedValue(undefined);
    pullCheckoutBaseBranchMock.mockResolvedValue(undefined);
    createWorktreeMock.mockResolvedValue({
      path: "/tmp/wt/ABC-1-abcd",
      branch: "fix/ABC-1-abcd",
    });
    buildFixerPromptMock.mockReturnValue("prompt-body");
    runCodexTaskMock.mockImplementation(async ({ observer }: { observer?: { onEvent?: (event: any) => void } }) => {
      observer?.onEvent?.({ type: "spawn", command: "codex", args: ["exec"], cwd: "/tmp/wt/ABC-1-abcd" });
      observer?.onEvent?.({ type: "stdout", chunk: "installing dependencies\n" });
      observer?.onEvent?.({ type: "stderr", chunk: "warn line\n" });
      observer?.onEvent?.({ type: "exit", exitCode: 0 });

      return {
        stdout: "LOG\nFIXER_RESULT {\"status\":\"ok\",\"prUrl\":\"https://example.test/pr/1\",\"testPath\":\"tests/fix.spec.ts\",\"redEvidence\":\"red\",\"greenEvidence\":\"green\",\"regressionGuardEvidence\":\"guard\",\"e2eValidationEvidence\":\"e2e proof\"}\n",
        stderr: "warn line\n",
        exitCode: 0,
        transcript: "[stdout]\ninstalling dependencies\n[stderr]\nwarn line\n",
      };
    });
    persistFixerTranscriptMock.mockResolvedValue("/tmp/artifacts/fixer-transcripts/abc-1.log");
    parseFixerResultMock.mockReturnValue(result);

    const actual = await runLinearTicketFlow({
      event: { data: ticket },
      step,
    });

    expect(actual).toEqual(result);
    expect(steps).toEqual([
      "fetch-ticket-context",
      "verify-target-checkout",
      "fetch-target-remote",
      "pull-target-base-branch",
      "create-worktree",
      "build-prompt",
      "run-fixer",
      "persist-fixer-transcript",
      "parse-fixer-result",
      "remove-worktree",
    ]);
    expect(logSpy).toHaveBeenCalledWith("fixer.spawn", expect.objectContaining({ cwd: "/tmp/wt/ABC-1-abcd" }));
    expect(logSpy).toHaveBeenCalledWith("fixer.stdout", "installing dependencies\n");
    expect(errorSpy).toHaveBeenCalledWith("fixer.stderr", "warn line\n");
    expect(logSpy).toHaveBeenCalledWith("fixer.persisted", "/tmp/artifacts/fixer-transcripts/abc-1.log");
    expect(logSpy).toHaveBeenCalledWith("fixer.parse.start", "ABC-1");
    expect(logSpy).toHaveBeenCalledWith("fixer.parse.ok", "https://example.test/pr/1");
  });
```

- [ ] **Step 3: Add the failing persistence-on-error test**

Append this test to `tests/inngest/onLinearTicket.test.ts`:

```ts
  it("persists the transcript before rethrowing a fixer execution failure", async () => {
    const { steps, step } = createStepRecorder();

    fetchTicketContextMock.mockResolvedValue(ticketContext);
    verifyCheckoutMock.mockResolvedValue(undefined);
    fetchCheckoutRemoteMock.mockResolvedValue(undefined);
    pullCheckoutBaseBranchMock.mockResolvedValue(undefined);
    createWorktreeMock.mockResolvedValue({
      path: "/tmp/wt/ABC-1-fail",
      branch: "fix/ABC-1-fail",
    });
    buildFixerPromptMock.mockReturnValue("prompt-body");
    runCodexTaskMock.mockRejectedValue(
      new CodexTaskErrorMock(
        {
          stdout: "partial output\n",
          stderr: "boom\n",
          exitCode: 1,
          transcript: "[stdout]\npartial output\n[stderr]\nboom\n",
        },
        "codex exited 1: boom",
      ),
    );
    persistFixerTranscriptMock.mockResolvedValue("/tmp/artifacts/fixer-transcripts/abc-1-fail.log");

    await expect(
      runLinearTicketFlow({ event: { data: ticket }, step }),
    ).rejects.toThrow(/codex exited 1: boom/);

    expect(steps).toEqual([
      "fetch-ticket-context",
      "verify-target-checkout",
      "fetch-target-remote",
      "pull-target-base-branch",
      "create-worktree",
      "build-prompt",
      "run-fixer",
      "persist-fixer-transcript",
      "remove-worktree",
    ]);
    expect(persistFixerTranscriptMock).toHaveBeenCalledWith({
      identifier: "ABC-1",
      branch: "fix/ABC-1-fail",
      transcript: "[stdout]\npartial output\n[stderr]\nboom\n",
      observer: expect.any(Object),
    });
  });
```

- [ ] **Step 4: Run the workflow tests to verify they fail**

Run:

```bash
pnpm test -- tests/inngest/onLinearTicket.test.ts tests/e2e/linearP2Flow.test.ts
```

Expected: FAIL because the flow still uses one `run-fixer` step and does not log streamed output.

- [ ] **Step 5: Split the flow and log streamed fixer output**

Update `src/inngest/functions/onLinearTicket.ts` with these helpers and flow changes:

```ts
import {
  CodexTaskError,
  parseFixerResult,
  persistFixerTranscript,
  runCodexTask,
  type FixerObserver,
  type FixerResult,
  type CodexTaskOutput,
} from "../../codex/fixer";

function truncateChunk(chunk: string, maxLength = 400): string {
  if (chunk.length <= maxLength) {
    return chunk;
  }

  return `${chunk.slice(0, maxLength)}...[truncated ${chunk.length - maxLength} chars]`;
}

function createFixerConsoleObserver(): FixerObserver {
  return {
    onEvent(event) {
      switch (event.type) {
        case "spawn":
          console.log("fixer.spawn", {
            command: event.command,
            args: event.args,
            cwd: event.cwd,
          });
          break;
        case "stdout":
          console.log("fixer.stdout", truncateChunk(event.chunk));
          break;
        case "stderr":
          console.error("fixer.stderr", truncateChunk(event.chunk));
          break;
        case "exit":
          console.log("fixer.exit", event.exitCode);
          break;
        case "persisted":
          console.log("fixer.persisted", event.path);
          break;
        case "persist-failed":
          console.error("fixer.persist-failed", event.error);
          break;
      }
    },
  };
}
```

Replace the existing fixer section inside `runLinearTicketFlow()` with:

```ts
    const fixerObserver = createFixerConsoleObserver();
    let fixerOutput: CodexTaskOutput | undefined;
    let fixerFailure: unknown;

    await step.run("run-fixer", async () => {
      try {
        fixerOutput = await runCodexTask({
          prompt,
          cwd: worktree.path,
          observer: fixerObserver,
        });
        return fixerOutput;
      } catch (error) {
        if (error instanceof CodexTaskError) {
          fixerOutput = error.output;
          fixerFailure = error;
          return fixerOutput;
        }

        throw error;
      }
    });

    await step.run("persist-fixer-transcript", async () => {
      if (!fixerOutput) {
        return null;
      }

      return persistFixerTranscript({
        identifier: ticket.identifier,
        branch: worktree.branch,
        transcript: fixerOutput.transcript,
        observer: fixerObserver,
      });
    });

    if (fixerFailure) {
      throw fixerFailure;
    }

    return await step.run("parse-fixer-result", async () => {
      console.log("fixer.parse.start", ticket.identifier);
      const parsed = parseFixerResult(fixerOutput!.stdout);
      console.log("fixer.parse.ok", parsed.prUrl);
      return parsed;
    });
```

- [ ] **Step 6: Update the in-process E2E step order**

In `tests/e2e/linearP2Flow.test.ts`, replace the fixer mock with split mocks:

```ts
const {
  fetchTicketContextMock,
  verifyCheckoutMock,
  fetchCheckoutRemoteMock,
  pullCheckoutBaseBranchMock,
  createWorktreeMock,
  removeWorktreeMock,
  buildFixerPromptMock,
  runCodexTaskMock,
  persistFixerTranscriptMock,
  parseFixerResultMock,
} = vi.hoisted(() => ({
  fetchTicketContextMock: vi.fn(),
  verifyCheckoutMock: vi.fn(),
  fetchCheckoutRemoteMock: vi.fn(),
  pullCheckoutBaseBranchMock: vi.fn(),
  createWorktreeMock: vi.fn(),
  removeWorktreeMock: vi.fn(),
  buildFixerPromptMock: vi.fn(),
  runCodexTaskMock: vi.fn(),
  persistFixerTranscriptMock: vi.fn(),
  parseFixerResultMock: vi.fn(),
}));

vi.mock("../../src/codex/fixer", () => ({
  runCodexTask: runCodexTaskMock,
  persistFixerTranscript: persistFixerTranscriptMock,
  parseFixerResult: parseFixerResultMock,
}));
```

Replace the old single-phase fixer setup:

```ts
    runFixerMock.mockResolvedValue({
      status: "ok",
      prUrl: "https://example.test/pull/1",
      testPath: "tests/fixes/bug-999.spec.ts",
      redEvidence: "red proof",
      greenEvidence: "green proof",
      regressionGuardEvidence: "guard proof",
      e2eValidationEvidence: "e2e proof",
    });
```

with:

```ts
    runCodexTaskMock.mockResolvedValue({
      stdout: "LOG\nFIXER_RESULT {\"status\":\"ok\",\"prUrl\":\"https://example.test/pull/1\",\"testPath\":\"tests/fixes/bug-999.spec.ts\",\"redEvidence\":\"red proof\",\"greenEvidence\":\"green proof\",\"regressionGuardEvidence\":\"guard proof\",\"e2eValidationEvidence\":\"e2e proof\"}\n",
      stderr: "",
      exitCode: 0,
      transcript: "[stdout]\ninstalling dependencies\n",
    });
    persistFixerTranscriptMock.mockResolvedValue(
      "/tmp/artifacts/fixer-transcripts/bug-999.log",
    );
    parseFixerResultMock.mockReturnValue({
      status: "ok",
      prUrl: "https://example.test/pull/1",
      testPath: "tests/fixes/bug-999.spec.ts",
      redEvidence: "red proof",
      greenEvidence: "green proof",
      regressionGuardEvidence: "guard proof",
      e2eValidationEvidence: "e2e proof",
    });
```

Replace the expected step order with:

```ts
    expect(stepOrder).toEqual([
      "fetch-ticket-context",
      "verify-target-checkout",
      "fetch-target-remote",
      "pull-target-base-branch",
      "create-worktree",
      "build-prompt",
      "run-fixer",
      "persist-fixer-transcript",
      "parse-fixer-result",
      "remove-worktree",
    ]);
```

Also replace the fixer invocation assertions with:

```ts
    expect(runCodexTaskMock).toHaveBeenCalledWith({
      prompt: "run final automated e2e validation and fix",
      cwd: "/tmp/worktrees/BUG-999-abc",
      observer: expect.any(Object),
    });
    expect(persistFixerTranscriptMock).toHaveBeenCalledWith({
      identifier: "BUG-999",
      branch: "fix/BUG-999-abc",
      transcript: "[stdout]\ninstalling dependencies\n",
      observer: expect.any(Object),
    });
    expect(parseFixerResultMock).toHaveBeenCalledWith(
      "LOG\nFIXER_RESULT {\"status\":\"ok\",\"prUrl\":\"https://example.test/pull/1\",\"testPath\":\"tests/fixes/bug-999.spec.ts\",\"redEvidence\":\"red proof\",\"greenEvidence\":\"green proof\",\"regressionGuardEvidence\":\"guard proof\",\"e2eValidationEvidence\":\"e2e proof\"}\n",
    );
```

- [ ] **Step 7: Run the workflow tests again**

Run:

```bash
pnpm test -- tests/inngest/onLinearTicket.test.ts tests/e2e/linearP2Flow.test.ts
```

Expected: PASS with the new step split and log markers green.

- [ ] **Step 8: Commit**

```bash
git add src/inngest/functions/onLinearTicket.ts tests/inngest/onLinearTicket.test.ts tests/e2e/linearP2Flow.test.ts
git commit -m "feat: show live fixer output in inngest"
```

## Task 4: Verify The Change End To End

**Files:**
- Test: `tests/codex/invoke.test.ts`
- Test: `tests/codex/fixer.test.ts`
- Test: `tests/inngest/onLinearTicket.test.ts`
- Test: `tests/e2e/linearP2Flow.test.ts`

- [ ] **Step 1: Run the focused regression suite**

Run:

```bash
pnpm test -- tests/codex/invoke.test.ts tests/codex/fixer.test.ts tests/inngest/onLinearTicket.test.ts tests/e2e/linearP2Flow.test.ts
```

Expected: PASS with all four files green.

- [ ] **Step 2: Run the full test suite**

Run:

```bash
pnpm test
```

Expected: PASS with the full repository test suite green.

- [ ] **Step 3: Run typecheck**

Run:

```bash
pnpm typecheck
```

Expected: PASS with `TypeScript compilation completed`.

- [ ] **Step 4: Start the local app and Inngest dev server**

Run the app in one terminal:

```bash
CODEX_BIN=/opt/homebrew/bin/codex \
CODEX_MODEL=gpt-5.4 \
CODEX_REASONING_EFFORT=medium \
INNGEST_DEV=1 \
INNGEST_BASE_URL=http://127.0.0.1:8288 \
INNGEST_EVENT_KEY=live-event-key \
INNGEST_SIGNING_KEY=live-signing-key \
LINEAR_WEBHOOK_SECRET=live-linear-secret \
TARGET_REPO_PATH=/tmp/incident-loop-target-clone-sid7 \
TARGET_REPO_WORKTREE_ROOT=/tmp/incident-loop-full-worktrees \
TARGET_REPO_REMOTE=origin \
TARGET_REPO_BASE_BRANCH=main \
TARGET_APP_URL=http://127.0.0.1:3900 \
ARTIFACTS_DIR=/tmp/incident-loop-full-artifacts \
PORT=3401 \
pnpm dev
```

Run the Inngest dev server in a second terminal:

```bash
npx --yes --ignore-scripts=false inngest-cli@latest dev -u http://127.0.0.1:3401/api/inngest --no-discovery
```

Expected: the Inngest UI is available at `http://localhost:8288`.

- [ ] **Step 5: Expose the webhook and trigger a real run**

Run the tunnel in a third terminal:

```bash
cloudflared tunnel --url http://127.0.0.1:3401 2>&1 | tee /tmp/incident-loop-cloudflared.log
```

Expected: `cloudflared` prints one public `https://...trycloudflare.com` URL and writes it to `/tmp/incident-loop-cloudflared.log`.

Extract the public URL and send the webhook:

```bash
public_url=$(rg -o 'https://[-0-9a-z]+\.trycloudflare\.com' /tmp/incident-loop-cloudflared.log -m 1)
body='{"action":"create","type":"Issue","data":{"id":"lin-123","identifier":"SID-7","url":"https://linear.app/unfolded/issue/SID-7/p2-live-verification-webhook-smoke-against-antigen-repo","labels":[{"name":"Bug"},{"name":"module:checkout"}]}}'
signature=$(printf %s "$body" | openssl dgst -sha256 -hmac live-linear-secret | awk '{print $2}')
curl -i \
  -X POST "$public_url/webhooks/linear" \
  -H 'content-type: application/json' \
  -H "linear-signature: sha256=$signature" \
  --data "$body"
```

Expected: `HTTP/1.1 202 Accepted`.

- [ ] **Step 6: Verify the Inngest UI shows the stream**

Open `http://localhost:8288` in a browser and inspect the latest `on-linear-ticket` run.

Verify all of these are visible:

- `run-fixer`
- `persist-fixer-transcript`
- `parse-fixer-result`
- at least one `fixer.stdout` log line during `run-fixer`
- a `fixer.persisted` log line after execution

Also verify the transcript artifact exists:

```bash
ls -la /tmp/incident-loop-full-artifacts/fixer-transcripts
```

Expected: one `.log` file for the live fixer run.
