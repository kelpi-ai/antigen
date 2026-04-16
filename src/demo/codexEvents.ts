const KNOWN_MILESTONES = [
  {
    match: (event: CodexEvent): boolean =>
      event.item?.server === "sentry-bubble-reel" &&
      event.item?.tool === "get_sentry_resource" &&
      event.item?.arguments?.resourceType === "breadcrumbs",
    step: "codex-sentry-breadcrumbs",
    summary: "Codex inspected Sentry breadcrumbs",
  },
  {
    match: (event: CodexEvent): boolean =>
      event.item?.server === "sentry-bubble-reel" &&
      event.item?.tool === "get_sentry_resource" &&
      event.item?.arguments?.resourceType !== "breadcrumbs",
    step: "codex-sentry-issue",
    summary: "Codex inspected the Sentry issue",
  },
  {
    match: (event: CodexEvent): boolean =>
      event.item?.server === "sentry-bubble-reel" && event.item?.tool === "search_issue_events",
    step: "codex-sentry-validation",
    summary: "Codex validated issue context in Sentry",
  },
  {
    match: (event: CodexEvent): boolean => event.item?.server === "chrome-devtools",
    step: "codex-browser-reproduction",
    summary: "Codex drove the browser to reproduce the issue",
  },
  {
    match: (event: CodexEvent): boolean =>
      event.item?.server === "linear" && event.item?.tool === "save_issue",
    step: "codex-linear-ticket",
    summary: "Codex created the Linear ticket",
  },
  {
    match: (event: CodexEvent): boolean =>
      event.item?.type === "agent_message" && typeof event.item?.text === "string",
    step: "codex-final-output",
    summary: "Codex produced a structured run summary",
  },
] as const;

export interface CodexEvent {
  type?: string;
  item?: {
    type?: string;
    server?: string;
    tool?: string;
    text?: string;
    arguments?: Record<string, unknown>;
    result?: {
      content?: Array<{
        type?: string;
        text?: string;
      }>;
    } | null;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface CodexMilestone {
  step: string;
  summary: string;
  raw: CodexEvent;
}

export interface ParsedCodexFinalResult {
  status: string;
  reproduced: boolean;
  ticketUrl: string;
  summary: string;
  finalUrl: string;
  steps: string[];
  expected: string;
  actual: string;
  evidence: {
    videoPath: string;
    screenshotPaths?: string[];
    consoleErrors: number;
    failedRequests: number;
  };
}

export function parseCodexMilestones(events: CodexEvent[]): CodexMilestone[] {
  const seen = new Set<string>();

  return events.flatMap((event) => {
    if (event.type !== "item.completed") {
      return [];
    }

    const match = KNOWN_MILESTONES.find((candidate) => candidate.match(event));
    if (!match || seen.has(match.step)) {
      return [];
    }

    seen.add(match.step);
    return [{ step: match.step, summary: match.summary, raw: event }];
  });
}

export function parseCodexEvents(raw: string): CodexEvent[] {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as CodexEvent;
      } catch {
        return null;
      }
    })
    .filter((event): event is CodexEvent => event !== null);
}

function normalizeResultText(event: CodexEvent): string {
  const content = event.item?.result?.content;
  if (Array.isArray(content)) {
    return content
      .filter((entry): entry is { text: string } => typeof entry?.text === "string")
      .map((entry) => entry.text)
      .join("\n");
  }
  return typeof event.item?.text === "string" ? event.item.text : "";
}

export function parseCodexFinalResult(events: CodexEvent[]): ParsedCodexFinalResult | null {
  const messages = events
    .filter(
      (event) =>
        (event.type === "item.completed" || event.type === "item.updated") &&
        event.item?.type === "agent_message" &&
        typeof event.item?.text === "string",
    )
    .map((event) => event.item?.text ?? "");

  for (const candidate of messages.reverse()) {
    try {
      const parsed = JSON.parse(candidate) as ParsedCodexFinalResult;
      if (parsed && typeof parsed.status === "string" && Array.isArray(parsed.steps)) {
        return parsed;
      }
    } catch {
      // Keep scanning older agent messages.
    }
  }

  return null;
}

export function findSuccessfulToolText(
  events: CodexEvent[],
  input: { server: string; tool: string; resourceType?: string },
): string {
  const match = events.find(
    (event) =>
      event.type === "item.completed" &&
      event.item?.server === input.server &&
      event.item?.tool === input.tool &&
      (!input.resourceType || event.item?.arguments?.resourceType === input.resourceType),
  );

  return match ? normalizeResultText(match) : "";
}
