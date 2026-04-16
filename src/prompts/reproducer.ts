export interface ReproducerIssueContext {
  id: string;
  title: string;
  permalink: string;
  culprit: string;
  environment: string;
  release: string;
}

export interface BuildReproducerPromptInput {
  issue: ReproducerIssueContext;
  targetAppUrl: string;
  videoPath: string;
}

export function buildReproducerPrompt(input: BuildReproducerPromptInput): string {
  return [
    "You are the incident reproducer.",
    "Inspect this issue with Sentry MCP before taking browser actions.",
    "Drive the target app with Chrome DevTools MCP only.",
    `Target app URL: ${input.targetAppUrl}`,
    `Saved browser video path: ${input.videoPath}`,
    "Do not write or modify repository files.",
    "Do not open or propose pull requests.",
    "Create exactly one Linear ticket yourself with clear reproduction details.",
    "Return JSON only. No markdown and no additional text.",
    "Use this JSON result schema:",
    "{",
    '  "status": "string",',
    '  "reproduced": true,',
    '  "ticketUrl": "https://linear.app/...",',
    '  "summary": "string",',
    '  "finalUrl": "https://...",',
    '  "steps": ["string"],',
    '  "expected": "string",',
    '  "actual": "string",',
    '  "evidence": {',
    `    "videoPath": "${input.videoPath}",`,
    '    "consoleErrors": 0,',
    '    "failedRequests": 0',
    "  }",
    "}",
    "Issue context:",
    `- id: ${input.issue.id}`,
    `- title: ${input.issue.title}`,
    `- permalink: ${input.issue.permalink}`,
    `- culprit: ${input.issue.culprit}`,
    `- environment: ${input.issue.environment}`,
    `- release: ${input.issue.release}`,
  ].join("\n");
}
