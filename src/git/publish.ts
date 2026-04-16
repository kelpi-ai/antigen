import { spawn } from "node:child_process";

import { p2Env } from "../config/env";

interface GitResult {
  stdout: string;
  stderr: string;
}

export interface PublishWorktreeResult {
  publishUrl: string;
}

function runGit(cwd: string, args: string[]): Promise<GitResult> {
  return new Promise((resolve, reject) => {
    const command = `git ${args.join(" ")}`;

    let proc: ReturnType<typeof spawn>;
    try {
      proc = spawn("git", args, {
        stdio: ["ignore", "pipe", "pipe"],
        cwd,
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

function normalizeTitle(title: string): string {
  return title.replace(/\s+/g, " ").trim();
}

function buildCommitMessage(identifier: string, title: string): string {
  const normalizedTitle = normalizeTitle(title);
  if (normalizedTitle.length === 0) {
    return `Fix ${identifier}`;
  }

  return `Fix ${identifier}: ${normalizedTitle}`;
}

function toGitHubRepoUrl(remoteUrl: string): string | null {
  const trimmed = remoteUrl.trim();

  const sshMatch = trimmed.match(/^git@github\.com:(.+?)(?:\.git)?$/);
  if (sshMatch) {
    return `https://github.com/${sshMatch[1]}`;
  }

  const httpsMatch = trimmed.match(/^https:\/\/github\.com\/(.+?)(?:\.git)?$/);
  if (httpsMatch) {
    return `https://github.com/${httpsMatch[1]}`;
  }

  const sshProtocolMatch = trimmed.match(/^ssh:\/\/git@github\.com\/(.+?)(?:\.git)?$/);
  if (sshProtocolMatch) {
    return `https://github.com/${sshProtocolMatch[1]}`;
  }

  return null;
}

function buildPublishUrl(remoteUrl: string, branch: string): string {
  const repoUrl = toGitHubRepoUrl(remoteUrl);
  if (!repoUrl) {
    return `${p2Env.TARGET_REPO_REMOTE}/${branch}`;
  }

  return `${repoUrl}/compare/${p2Env.TARGET_REPO_BASE_BRANCH}...${branch}?expand=1`;
}

export async function publishWorktreeFix(input: {
  worktreePath: string;
  branch: string;
  ticketIdentifier: string;
  ticketTitle: string;
}): Promise<PublishWorktreeResult> {
  const status = await runGit(input.worktreePath, ["status", "--short"]);
  if (status.stdout.trim().length === 0) {
    throw new Error("worktree has no changes to publish");
  }

  await runGit(input.worktreePath, ["add", "-A"]);
  await runGit(input.worktreePath, [
    "commit",
    "-m",
    buildCommitMessage(input.ticketIdentifier, input.ticketTitle),
  ]);
  await runGit(input.worktreePath, ["push", "--set-upstream", p2Env.TARGET_REPO_REMOTE, input.branch]);

  const remote = await runGit(input.worktreePath, ["remote", "get-url", p2Env.TARGET_REPO_REMOTE]);

  return {
    publishUrl: buildPublishUrl(remote.stdout, input.branch),
  };
}
