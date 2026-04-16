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
  skipGitRepoCheck?: boolean;
  observer?: InvokeObserver;
  onStdoutChunk?: (chunk: string) => void;
  onStderrChunk?: (chunk: string) => void;
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

    if (opts.skipGitRepoCheck) {
      args.push("--skip-git-repo-check");
    }

    args.push(prompt);

    const safeObserver = {
      onStart(meta: { command: string; args: string[]; cwd?: string }): void {
        try {
          opts.observer?.onStart?.(meta);
        } catch {}
      },
      onStdout(chunk: string): void {
        try {
          opts.observer?.onStdout?.(chunk);
        } catch {}
      },
      onStderr(chunk: string): void {
        try {
          opts.observer?.onStderr?.(chunk);
        } catch {}
      },
      onExit(meta: { exitCode: number | null }): void {
        try {
          opts.observer?.onExit?.(meta);
        } catch {}
      },
    };

    let proc;

    try {
      proc = spawn(codexBin, args, {
        stdio: ["ignore", "pipe", "pipe"],
        cwd: opts.cwd,
      });
    } catch (error) {
      reject(error);
      return;
    }

    safeObserver.onStart({ command: codexBin, args, cwd: opts.cwd });

    let stdout = "";
    let stderr = "";
    const forwardStdout = createChunkForwarder(opts.onStdoutChunk);
    const forwardStderr = createChunkForwarder(opts.onStderrChunk);

    proc.stdout?.on("data", (c: Buffer) => {
      const chunk = c.toString();
      stdout += chunk;
      safeObserver.onStdout(chunk);
      forwardStdout.push(chunk);
    });

    proc.stderr?.on("data", (c: Buffer) => {
      const chunk = c.toString();
      stderr += chunk;
      safeObserver.onStderr(chunk);
      forwardStderr.push(chunk);
    });

    const timeout = opts.timeoutMs
      ? setTimeout(() => {
          proc.kill("SIGKILL");
          reject(new Error(`codex timed out after ${opts.timeoutMs}ms`));
        }, opts.timeoutMs)
      : null;

    proc.on("close", (code) => {
      if (timeout) clearTimeout(timeout);
      forwardStdout.flush();
      forwardStderr.flush();
      safeObserver.onExit({ exitCode: code });

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

function createChunkForwarder(
  onChunk?: (chunk: string) => void,
): { push: (chunk: string) => void; flush: () => void } {
  let pending = "";

  return {
    push(chunk: string) {
      if (!onChunk) {
        return;
      }

      pending += chunk;

      while (true) {
        const newlineIndex = pending.indexOf("\n");
        if (newlineIndex === -1) {
          break;
        }

        const line = pending.slice(0, newlineIndex).replace(/\r$/, "");
        pending = pending.slice(newlineIndex + 1);
        if (line.length > 0) {
          onChunk(line);
        }
      }
    },
    flush() {
      if (!onChunk || pending.length === 0) {
        return;
      }

      const remainder = pending.replace(/\r$/, "");
      pending = "";
      if (remainder.length > 0) {
        onChunk(remainder);
      }
    },
  };
}
