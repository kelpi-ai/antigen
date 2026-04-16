import { spawn } from "node:child_process";
import { env } from "../config/env";

interface GitResult {
  stdout: string;
  stderr: string;
}

function runGit(args: string[]): Promise<GitResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn("git", args, {
      stdio: ["ignore", "pipe", "pipe"],
      cwd: env.TARGET_REPO_PATH,
    });

    let stdout = "";
    let stderr = "";

    proc.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    proc.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on("error", (error) => {
      reject(error);
    });

    proc.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(
          new Error(
            `git ${args.join(" ")} failed: ${stderr.trim() || "no stderr"}`,
          ),
        );
      }
    });
  });
}

export async function updateCheckout(): Promise<void> {
  await runGit(["rev-parse", "--is-inside-work-tree"]);
  await runGit(["fetch", env.TARGET_REPO_REMOTE]);
  await runGit(["pull", "--ff-only", env.TARGET_REPO_REMOTE, env.TARGET_REPO_BASE_BRANCH]);
}
