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

    const proc = spawn(
      codexBin,
      args,
      { stdio: ["ignore", "pipe", "pipe"], cwd: opts.cwd },
    );

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
      } else {
        reject(new CodexExecutionError(code, stdout, stderr));
      }
    });

    proc.on("error", (err) => {
      if (timeout) clearTimeout(timeout);
      reject(err);
    });
  });
}
