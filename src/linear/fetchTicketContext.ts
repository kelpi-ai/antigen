import { runCodexTask } from "../codex/fixer";
import {
  inspectSentryIssue,
  type SeerInsight,
  type SentryIssueDetails,
} from "../sentry/inspectIssue";

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
  sentryIssue?: SentryIssueDetails;
  seer?: SeerInsight;
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

function getFallbackString(value: unknown, fallback: string): string {
  return isNonEmptyString(value) ? value : fallback;
}

function getOptionalString(value: unknown): string | undefined {
  return isNonEmptyString(value) ? value : undefined;
}

function getBrowserVisible(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") {
      return true;
    }
    if (normalized === "false") {
      return false;
    }
  }

  return false;
}

function parseSentryIssue(value: unknown): SentryIssueDetails | undefined {
  if (!isObject(value)) {
    return undefined;
  }

  const sentryIssue = {
    id: getOptionalString(value.id),
    url: getOptionalString(value.url),
    title: getOptionalString(value.title),
    culprit: getOptionalString(value.culprit),
    environment: getOptionalString(value.environment),
    release: getOptionalString(value.release),
  };

  if (!sentryIssue.id && !sentryIssue.url) {
    return undefined;
  }

  return sentryIssue;
}

function mergeSentryIssue(
  base: SentryIssueDetails,
  inspected: SentryIssueDetails,
): SentryIssueDetails {
  return {
    id: inspected.id ?? base.id,
    url: inspected.url ?? base.url,
    title: inspected.title ?? base.title,
    culprit: inspected.culprit ?? base.culprit,
    environment: inspected.environment ?? base.environment,
    release: inspected.release ?? base.release,
  };
}

function parseTicketContext(payload: unknown, input: TicketSeed): TicketContext {
  if (!isObject(payload)) {
    throw new Error("invalid LINEAR_TICKET_CONTEXT payload: expected JSON object");
  }

  const environmentHints = isObject(payload.environmentHints) ? payload.environmentHints : {};

  return {
    ticketId: getFallbackString(payload.ticketId, input.ticketId),
    identifier: getFallbackString(payload.identifier, input.identifier),
    module: isString(payload.module) ? payload.module : input.module,
    url: getFallbackString(payload.url, input.url),
    title: getFallbackString(payload.title, input.identifier),
    body: getFallbackString(payload.body, "Ticket body unavailable."),
    browserVisible: getBrowserVisible(payload.browserVisible),
    similarIssueContext: getFallbackString(
      payload.similarIssueContext,
      "No similar issue context provided.",
    ),
    sentryIssue: parseSentryIssue(payload.sentryIssue),
    environmentHints: {
      browser: getFallbackString(environmentHints.browser, "unknown"),
      os: getFallbackString(environmentHints.os, "unknown"),
      viewport: getFallbackString(environmentHints.viewport, "unknown"),
    },
  };
}

export async function fetchTicketContext(input: TicketSeed): Promise<TicketContext> {
  const query = `
Fetch Linear ticket context for ${input.identifier} (${input.url}).
Return a single line starting with "LINEAR_TICKET_CONTEXT ".
The suffix must be a JSON payload containing:
- ticketId, identifier, module, url, title, body, browserVisible, similarIssueContext, environmentHints{browser,os,viewport}
- sentryIssue{id,url} when the ticket references a Sentry issue; otherwise sentryIssue: null is acceptable
If any value is unavailable, still include the field using these fallbacks instead of omitting it:
- ticketId => ${input.ticketId}
- identifier => ${input.identifier}
- module => ${input.module}
- url => ${input.url}
- title => ${input.identifier}
- body => Ticket body unavailable.
- browserVisible => false
- similarIssueContext => No similar issue context provided.
- environmentHints.browser/os/viewport => unknown
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

  const ticketContext = {
    ...parseTicketContext(parsed, input),
  };

  ticketContext.module = ticketContext.module || input.module;

  if (!ticketContext.sentryIssue) {
    return ticketContext;
  }

  try {
    const inspection = await inspectSentryIssue(ticketContext.sentryIssue);
    if (!inspection) {
      return ticketContext;
    }

    return {
      ...ticketContext,
      sentryIssue: mergeSentryIssue(ticketContext.sentryIssue, inspection.issue),
      ...(inspection.seer ? { seer: inspection.seer } : {}),
    };
  } catch {
    return ticketContext;
  }
}
