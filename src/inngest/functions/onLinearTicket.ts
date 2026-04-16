import type { FixerResult } from "../../codex/fixer";
import { runFixer } from "../../codex/fixer";
import type { TicketSeed } from "../../linear/fetchTicketContext";
import { fetchTicketContext } from "../../linear/fetchTicketContext";
import { updateCheckout } from "../../git/updateCheckout";
import { createWorktree, removeWorktree } from "../../git/worktree";
import { buildFixerPrompt } from "../../prompts/fixer";
import { env } from "../../config/env";
import { inngest } from "../client";

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
}): Promise<FixerResult> {
  const ticket = await step.run("fetch-ticket-context", () => fetchTicketContext(event.data));

  await step.run("update-checkout", () => updateCheckout());

  const worktree = await step.run("create-worktree", () => createWorktree(ticket.identifier));

  try {
    const prompt = await step.run("build-prompt", () =>
      buildFixerPrompt({
        ticket,
        worktreePath: worktree.path,
        branch: worktree.branch,
        targetAppUrl: env.TARGET_APP_URL,
      }),
    );

    return await step.run("run-fixer", () =>
      runFixer({
        prompt,
        cwd: worktree.path,
      }),
    );
  } finally {
    await step.run("remove-worktree", () => removeWorktree(worktree.path));
  }
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
