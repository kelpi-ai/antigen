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

export async function runStructuredCodexTask(input: {
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

export function runCodexTask(prompt: string, cwd?: string): Promise<string>;
export function runCodexTask(
  input: { prompt: string; cwd?: string; observer?: FixerObserver },
): Promise<CodexTaskOutput>;
export async function runCodexTask(
  inputOrPrompt: string | { prompt: string; cwd?: string; observer?: FixerObserver },
  cwd?: string,
): Promise<string | CodexTaskOutput> {
  if (typeof inputOrPrompt === "string") {
    const result = await runStructuredCodexTask({ prompt: inputOrPrompt, cwd });
    return result.stdout;
  }

  return runStructuredCodexTask(inputOrPrompt);
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

const RESULT_PREFIX = "FIXER_RESULT ";
const REQUIRED_FIELDS: (keyof FixerResult)[] = [
  "status",
  "prUrl",
  "testPath",
  "redEvidence",
  "greenEvidence",
  "regressionGuardEvidence",
  "e2eValidationEvidence",
];

function isPresentString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function parseFixerResult(stdout: string): FixerResult {
  const resultLine = stdout.split(/\r?\n/).find((line) => line.startsWith(RESULT_PREFIX));
  if (!resultLine) {
    throw new Error("missing FIXER_RESULT line");
  }

  const payload = resultLine.slice(RESULT_PREFIX.length);
  const parsed = JSON.parse(payload) as Partial<FixerResult>;

  const missing = REQUIRED_FIELDS.filter((field) => {
    if (field === "status") {
      return parsed.status !== "ok";
    }
    return !isPresentString(parsed[field]);
  });

  if (missing.length > 0) {
    throw new Error(`missing required proof field(s): ${missing.join(", ")}`);
  }

  return {
    status: "ok",
    prUrl: parsed.prUrl!,
    testPath: parsed.testPath!,
    redEvidence: parsed.redEvidence!,
    greenEvidence: parsed.greenEvidence!,
    regressionGuardEvidence: parsed.regressionGuardEvidence!,
    e2eValidationEvidence: parsed.e2eValidationEvidence!,
    browserVerificationEvidence: parsed.browserVerificationEvidence,
  };
}

export async function runFixer(input: { prompt: string; cwd: string }): Promise<FixerResult> {
  const output = await runStructuredCodexTask({
    prompt: input.prompt,
    cwd: input.cwd,
  });
  return parseFixerResult(output.stdout);
}
