import {
  CodexTaskError,
  type CodexTaskOutput,
  type FixerObserver,
  parseFixerResult,
  persistFixerTranscript,
  runCodexTask,
  type PublishedFixerResult,
} from "../../codex/fixer";
import type { TicketSeed } from "../../linear/fetchTicketContext";
import { fetchTicketContext } from "../../linear/fetchTicketContext";
import {
  fetchCheckoutRemote,
  pullCheckoutBaseBranch,
  verifyCheckout,
} from "../../git/updateCheckout";
import { createWorktree, removeWorktree } from "../../git/worktree";
import { publishWorktreeFix } from "../../git/publish";
import { buildFixerPrompt } from "../../prompts/fixer";
import { p2Env } from "../../config/env";
import { inngest } from "../client";

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

export interface StepLike {
  run<T>(id: string, fn: () => Promise<T> | T): Promise<T>;
}

export interface LinearTicketCreatedEvent {
  data: TicketSeed;
}

export async function runLinearTicketFlow({
  event,
  step,
}: {
  event: LinearTicketCreatedEvent;
  step: StepLike;
}): Promise<PublishedFixerResult> {
  const ticket = await step.run("fetch-ticket-context", () => fetchTicketContext(event.data));

  await step.run("verify-target-checkout", () => verifyCheckout());
  await step.run("fetch-target-remote", () => fetchCheckoutRemote());
  await step.run("pull-target-base-branch", () => pullCheckoutBaseBranch());

  const worktree = await step.run("create-worktree", () => createWorktree(ticket.identifier));
  let primaryError: unknown;

  try {
    const prompt = await step.run("build-prompt", () =>
      buildFixerPrompt({
        ticket,
        worktreePath: worktree.path,
        branch: worktree.branch,
        targetAppUrl: p2Env.TARGET_APP_URL,
      }),
    );

    const fixerObserver = createFixerConsoleObserver();

    const fixerRun = await step.run("run-fixer", async () => {
      type FixerRunResult = { output?: CodexTaskOutput; failure?: unknown };
      let output: CodexTaskOutput | undefined;
      let failure: unknown;

      try {
        output = await runCodexTask({
          prompt,
          cwd: worktree.path,
          observer: fixerObserver,
        });
        return { output } as FixerRunResult;
      } catch (error) {
        if (error instanceof CodexTaskError) {
          output = error.output;
          failure = error;
          return { output, failure } as FixerRunResult;
        }

        throw error;
      }
    });

    const fixerOutput = fixerRun.output;

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

    if (fixerRun.failure) {
      throw fixerRun.failure;
    }

    const parsed = await step.run("parse-fixer-result", async () => {
      console.log("fixer.parse.start", ticket.identifier);
      const proof = parseFixerResult(fixerOutput!.stdout);
      console.log("fixer.parse.ok", proof.testPath);
      return proof;
    });

    const published = await step.run("publish-fix", async () => {
      const result = await publishWorktreeFix({
        worktreePath: worktree.path,
        branch: worktree.branch,
        ticketIdentifier: ticket.identifier,
        ticketTitle: ticket.title,
      });
      console.log("fixer.publish.ok", result.publishUrl);
      return result;
    });

    return {
      ...parsed,
      publishUrl: published.publishUrl,
    };
  } catch (error) {
    primaryError = error;
  } finally {
    try {
      await step.run("remove-worktree", () => removeWorktree(worktree.path));
    } catch (cleanupError) {
      if (primaryError) {
        throw new AggregateError([primaryError as Error, cleanupError as Error], "flow failed and cleanup failed");
      }
      throw cleanupError;
    }
  }

  if (primaryError) {
    throw primaryError;
  }

  throw new Error("linear ticket flow exited without result");
}

export const onLinearTicket = inngest.createFunction(
  {
    id: "on-linear-ticket",
    retries: 1,
    concurrency: [
      { key: "event.data.module", limit: 1 },
      { limit: 5 },
    ],
  },
  { event: "linear/ticket.created" },
  runLinearTicketFlow,
);
