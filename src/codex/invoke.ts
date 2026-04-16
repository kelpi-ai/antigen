import { spawn } from "node:child_process";
import { env } from "../config/env";

export interface CodexResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface InvokeOpts {
  cwd?: string;
  timeoutMs?: number;
  onStdoutChunk?: (chunk: string) => void;
  onStderrChunk?: (chunk: string) => void;
}

export function invokeCodex(prompt: string, opts: InvokeOpts = {}): Promise<CodexResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      env.CODEX_BIN,
      ["exec", "--full-auto", prompt],
      { stdio: ["ignore", "pipe", "pipe"], cwd: opts.cwd },
    );

    let stdout = "";
    let stderr = "";
    const forwardStdout = createChunkForwarder(opts.onStdoutChunk);
    const forwardStderr = createChunkForwarder(opts.onStderrChunk);
    proc.stdout?.on("data", (c: Buffer) => {
      const text = c.toString();
      stdout += text;
      forwardStdout.push(text);
    });
    proc.stderr?.on("data", (c: Buffer) => {
      const text = c.toString();
      stderr += text;
      forwardStderr.push(text);
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
      if (code === 0) {
        resolve({ stdout, stderr, exitCode: 0 });
      } else {
        const exitCode = code === null ? "null" : code;
        reject(new Error(`codex exited ${exitCode}: ${stderr.trim() || "no stderr"}`));
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
