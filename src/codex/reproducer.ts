import { appendFile, writeFile } from "node:fs/promises";
import { Codex, type ThreadEvent } from "@openai/codex-sdk";
import { z } from "zod";

const ReproducerResultSchema = z.object({
  status: z.string(),
  reproduced: z.boolean(),
  ticketUrl: z.string().url(),
  summary: z.string(),
  finalUrl: z.string().url(),
  steps: z.array(z.string()),
  expected: z.string(),
  actual: z.string(),
  evidence: z.object({
    videoPath: z.string(),
    screenshotPaths: z.array(z.string()).optional().default([]),
    consoleErrors: z.number().int().nonnegative(),
    failedRequests: z.number().int().nonnegative(),
  }),
});

const reproducerOutputSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "status",
    "reproduced",
    "ticketUrl",
    "summary",
    "finalUrl",
    "steps",
    "expected",
    "actual",
    "evidence",
  ],
  properties: {
    status: { type: "string" },
    reproduced: { type: "boolean" },
    ticketUrl: { type: "string" },
    summary: { type: "string" },
    finalUrl: { type: "string" },
    steps: {
      type: "array",
      items: { type: "string" },
    },
    expected: { type: "string" },
    actual: { type: "string" },
    evidence: {
      type: "object",
      additionalProperties: false,
      required: ["videoPath", "consoleErrors", "failedRequests"],
      properties: {
        videoPath: { type: "string" },
        screenshotPaths: {
          type: "array",
          items: { type: "string" },
        },
        consoleErrors: { type: "integer", minimum: 0 },
        failedRequests: { type: "integer", minimum: 0 },
      },
    },
  },
} as const;

export type ReproducerResult = z.infer<typeof ReproducerResultSchema>;

export interface CodexMilestone {
  stepName: string;
  summary: string;
  server: string;
  tool: string;
  details?: string;
}

export interface RecordingAssessment {
  status: "pending" | "verified" | "suspect";
  reason: string;
  openedNewPage: boolean;
}

export type ReproducerRunResult = ReproducerResult & {
  milestones: CodexMilestone[];
  recordingAssessment: RecordingAssessment;
};

interface CompletedItemEvent {
  type: "item.completed" | "item.updated";
  item: {
    type?: string;
    status?: string;
    server?: string;
    tool?: string;
    arguments?: Record<string, unknown>;
    result?: {
      content?: Array<{
        type?: string;
        text?: string;
      }>;
    } | null;
    text?: string;
  };
}

function getEventItem(event: ThreadEvent): CompletedItemEvent["item"] | null {
  if (event.type !== "item.completed" && event.type !== "item.updated") {
    return null;
  }

  const candidate = (event as CompletedItemEvent).item;
  return candidate ?? null;
}

function getItemResultText(item: CompletedItemEvent["item"]): string {
  const content = item.result?.content;
  if (!Array.isArray(content)) {
    return typeof item.text === "string" ? item.text : "";
  }

  return content
    .filter((entry): entry is { text: string } => typeof entry?.text === "string")
    .map((entry) => entry.text)
    .join("\n");
}

function pushMilestone(
  milestones: CodexMilestone[],
  seen: Set<string>,
  milestone: CodexMilestone,
): void {
  if (seen.has(milestone.stepName)) {
    return;
  }
  seen.add(milestone.stepName);
  milestones.push(milestone);
}

export function extractCodexMilestones(events: ThreadEvent[]): CodexMilestone[] {
  const milestones: CodexMilestone[] = [];
  const seen = new Set<string>();

  for (const event of events) {
    const item = getEventItem(event);
    if (!item || item.type !== "mcp_tool_call" || item.status === "failed") {
      continue;
    }

    const server = item.server ?? "";
    const tool = item.tool ?? "";
    const resultText = getItemResultText(item);

    if (server === "sentry-bubble-reel") {
      const resourceType = item.arguments?.resourceType;
      if (tool === "get_sentry_resource" && resourceType === "breadcrumbs") {
        pushMilestone(milestones, seen, {
          stepName: "codex-sentry-breadcrumbs",
          summary: "Codex fetched Sentry breadcrumbs",
          server,
          tool,
        });
        continue;
      }

      if (tool === "get_sentry_resource") {
        pushMilestone(milestones, seen, {
          stepName: "codex-sentry-issue",
          summary: "Codex fetched Sentry issue details",
          server,
          tool,
        });
        continue;
      }

      if (tool === "search_issue_events" || tool === "get_issue_tag_values") {
        pushMilestone(milestones, seen, {
          stepName: "codex-sentry-validation",
          summary: "Codex validated additional Sentry context",
          server,
          tool,
        });
        continue;
      }
    }

    if (server === "chrome-devtools") {
      if (
        tool === "click" ||
        tool === "fill" ||
        tool === "take_snapshot" ||
        tool === "evaluate_script" ||
        tool === "list_network_requests" ||
        tool === "list_console_messages"
      ) {
        pushMilestone(milestones, seen, {
          stepName: "codex-browser-reproduction",
          summary: "Codex replayed the browser flow in Chrome DevTools",
          server,
          tool,
        });
      }

      const lowerResult = resultText.toLowerCase();
      if (
        lowerResult.includes("internal server error") ||
        lowerResult.includes("payment processing failed") ||
        lowerResult.includes("uncaught") ||
        lowerResult.includes("typeerror")
      ) {
        pushMilestone(milestones, seen, {
          stepName: "codex-browser-error-state",
          summary: "Codex observed the in-app failure state in the browser",
          server,
          tool,
        });
      }
      continue;
    }

    if (server === "linear") {
      if (tool === "list_teams" || tool === "list_projects") {
        pushMilestone(milestones, seen, {
          stepName: "codex-linear-context",
          summary: "Codex looked up Linear team or project context",
          server,
          tool,
        });
        continue;
      }

      if (tool === "save_issue") {
        pushMilestone(milestones, seen, {
          stepName: "codex-linear-ticket",
          summary: "Codex created a Linear issue",
          server,
          tool,
          details: resultText.slice(0, 240),
        });
      }
    }
  }

  return milestones;
}

export function extractRecordingAssessment(events: ThreadEvent[]): RecordingAssessment {
  for (const event of events) {
    const item = getEventItem(event);
    if (
      item?.type === "mcp_tool_call" &&
      item.status !== "failed" &&
      item.server === "chrome-devtools" &&
      item.tool === "new_page"
    ) {
      return {
        status: "suspect",
        reason: "Codex opened a new page, so the saved video may not include the full reproduction.",
        openedNewPage: true,
      };
    }
  }

  return {
    status: "verified",
    reason: "Codex stayed on the recorded page.",
    openedNewPage: false,
  };
}

async function appendCodexEvent(input: {
  eventsPath: string;
  event: ThreadEvent;
}): Promise<void> {
  await appendFile(input.eventsPath, `${JSON.stringify(input.event)}\n`);
}

export async function runCodexReproducer(input: {
  prompt: string;
  workingDirectory: string;
  eventsPath: string;
}): Promise<ReproducerRunResult> {
  const codex = new Codex();
  const thread = codex.startThread({
    model: "gpt-5.3-codex-spark",
    workingDirectory: input.workingDirectory,
    skipGitRepoCheck: true,
    approvalPolicy: "never",
    sandboxMode: "danger-full-access",
  });

  await writeFile(input.eventsPath, "");

  const { events } = await thread.runStreamed(input.prompt, {
    outputSchema: reproducerOutputSchema,
  });

  let finalResponse: string | null = null;
  const recordedEvents: ThreadEvent[] = [];
  for await (const event of events) {
    recordedEvents.push(event);
    await appendCodexEvent({ eventsPath: input.eventsPath, event });

    if (
      (event.type === "item.completed" || event.type === "item.updated") &&
      event.item.type === "agent_message"
    ) {
      finalResponse = event.item.text;
    }

    if (event.type === "turn.completed") {
      break;
    }
  }

  if (!finalResponse) {
    throw new Error("Codex did not return a final response");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(finalResponse);
  } catch (error) {
    throw new Error(
      `Codex returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return {
    ...ReproducerResultSchema.parse(parsed),
    milestones: extractCodexMilestones(recordedEvents),
    recordingAssessment: extractRecordingAssessment(recordedEvents),
  };
}
