import { spawn } from "node:child_process";

export interface CodexResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface InvokeOpts {
  cwd?: string;
  timeoutMs?: number;
}

export function invokeCodex(prompt: string, opts: InvokeOpts = {}): Promise<CodexResult> {
  return new Promise((resolve, reject) => {
    const codexBin = process.env.CODEX_BIN || "codex";

    const proc = spawn(
      codexBin,
      ["exec", "--full-auto", prompt],
      { stdio: ["ignore", "pipe", "pipe"], cwd: opts.cwd },
    );

    let stdout = "";
    let stderr = "";
    proc.stdout?.on("data", (c: Buffer) => { stdout += c.toString(); });
    proc.stderr?.on("data", (c: Buffer) => { stderr += c.toString(); });

    const timeout = opts.timeoutMs
      ? setTimeout(() => {
          proc.kill("SIGKILL");
          reject(new Error(`codex timed out after ${opts.timeoutMs}ms`));
        }, opts.timeoutMs)
      : null;

    proc.on("close", (code) => {
      if (timeout) clearTimeout(timeout);
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
