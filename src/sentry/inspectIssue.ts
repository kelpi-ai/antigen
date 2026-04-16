export interface SentryIssueDetails {
  id?: string;
  url?: string;
  title?: string;
  culprit?: string;
  environment?: string;
  release?: string;
}

export interface SeerInsight {
  summary: string;
  rootCause: string;
  solution: string;
}

export interface SentryIssueInspection {
  issue: SentryIssueDetails;
  seer?: SeerInsight;
}

// Real Sentry MCP wiring can replace this seam without disturbing the caller contract.
export async function inspectSentryIssue(
  reference: SentryIssueDetails,
): Promise<SentryIssueInspection | null> {
  void reference;
  return null;
}
