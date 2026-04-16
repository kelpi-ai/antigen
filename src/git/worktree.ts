import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { join } from "node:path";

import { p2Env } from "../config/env";

interface GitResult {
  stdout: string;
  stderr: string;
}

function runGit(args: string[]): Promise<GitResult> {
  return new Promise((resolve, reject) => {
    const command = `git ${args.join(" ")}`;

    let proc: ReturnType<typeof spawn>;
    try {
      proc = spawn("git", args, {
        stdio: ["ignore", "pipe", "pipe"],
        cwd: p2Env.TARGET_REPO_PATH,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      reject(new Error(`${command} failed: ${message}`));
      return;
    }

    let stdout = "";
    let stderr = "";

    proc.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    proc.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on("error", (error) => {
      const message = error instanceof Error ? error.message : String(error);
      reject(new Error(`${command} failed: ${message}`));
    });

    proc.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`${command} failed: ${stderr.trim() || "no stderr"}`));
      }
    });
  });
}

export async function createWorktree(
  ticketId: string,
): Promise<{ path: string; branch: string }> {
  const suffix = randomBytes(4).toString("hex");
  const branch = `fix/${ticketId}-${suffix}`;
  const path = join(p2Env.TARGET_REPO_WORKTREE_ROOT, `${ticketId}-${suffix}`);
  await runGit(["worktree", "add", "-b", branch, path, p2Env.TARGET_REPO_BASE_BRANCH]);
  return { path, branch };
}

export async function removeWorktree(path: string): Promise<void> {
  await runGit(["worktree", "remove", "--force", path]);
}
