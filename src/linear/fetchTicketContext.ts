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
  const parsed = JSON.parse(payload) as TicketContext;

  return {
    ...parsed,
    module: parsed.module ? parsed.module : input.module,
  };
}
