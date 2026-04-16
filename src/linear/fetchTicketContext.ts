import { runCodexTask } from "../codex/fixer";

export interface TicketSeed {
  ticketId: string;
  identifier: string;
  module: string;
  url: string;
}

export interface TicketContext extends TicketSeed {
  title: string;
  body: string;
  browserVisible: boolean;
  similarIssueContext: string;
  environmentHints: {
    browser: string;
    os: string;
    viewport: string;
  };
}

const RESULT_PREFIX = "LINEAR_TICKET_CONTEXT ";

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseAndValidateTicketContext(payload: unknown): TicketContext {
  if (!isObject(payload)) {
    throw new Error("invalid LINEAR_TICKET_CONTEXT payload: expected JSON object");
  }

  const environmentHints = payload.environmentHints;
  if (!isObject(environmentHints)) {
    throw new Error("invalid LINEAR_TICKET_CONTEXT payload: missing environmentHints");
  }

  if (
    !isNonEmptyString(payload.ticketId) ||
    !isNonEmptyString(payload.identifier) ||
    !isString(payload.module) ||
    !isNonEmptyString(payload.url) ||
    !isNonEmptyString(payload.title) ||
    !isNonEmptyString(payload.body) ||
    !isNonEmptyString(payload.similarIssueContext) ||
    typeof payload.browserVisible !== "boolean" ||
    !isNonEmptyString(environmentHints.browser) ||
    !isNonEmptyString(environmentHints.os) ||
    !isNonEmptyString(environmentHints.viewport)
  ) {
    throw new Error(
      "invalid LINEAR_TICKET_CONTEXT payload: ticketId, identifier, url, title, body, similarIssueContext, browserVisible, environmentHints.browser, environmentHints.os, environmentHints.viewport must be present and valid; module must be a string",
    );
  }

  return {
    ticketId: payload.ticketId,
    identifier: payload.identifier,
    module: payload.module,
    url: payload.url,
    title: payload.title,
    body: payload.body,
    browserVisible: payload.browserVisible,
    similarIssueContext: payload.similarIssueContext,
    environmentHints: {
      browser: environmentHints.browser,
      os: environmentHints.os,
      viewport: environmentHints.viewport,
    },
  };
}

export async function fetchTicketContext(input: TicketSeed): Promise<TicketContext> {
  const query = `
Fetch Linear ticket context for ${input.identifier} (${input.url}).
Return a single line starting with "LINEAR_TICKET_CONTEXT ".
The suffix must be a JSON payload containing:
- ticketId, identifier, module, url, title, body, browserVisible, similarIssueContext, environmentHints{browser,os,viewport}
Do not include any extra lines.
`;

  const output = await runCodexTask(query);
  const tagged = output.split(/\r?\n/).find((line) => line.startsWith(RESULT_PREFIX));
  if (!tagged) {
    throw new Error("missing LINEAR_TICKET_CONTEXT line");
  }

  const payload = tagged.slice(RESULT_PREFIX.length);
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    throw new Error("invalid LINEAR_TICKET_CONTEXT payload JSON");
  }

  const validated = parseAndValidateTicketContext(parsed);

  return {
    ...validated,
    module: validated.module || input.module,
  };
}
