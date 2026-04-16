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
  screenshotsDir: string;
  videoPath: string;
}

export function buildReproducerPrompt(input: BuildReproducerPromptInput): string {
  return [
    "You are the incident reproducer.",
    "Inspect this issue with Sentry MCP before taking browser actions.",
    "Drive the target app with Chrome DevTools MCP only.",
    "A browser tab is already open on the target app.",
    "Reuse the existing page instead of opening a new page or tab unless that page is unavailable.",
    "No browser recording is being captured by the agent for this run.",
    "Use take_screenshot with explicit file paths so the run can be turned into a video afterward.",
    `Save screenshots in this directory only: ${input.screenshotsDir}`,
    "Capture at least these moments in order when possible: initial issue context, visible failure state, and final state after filing the ticket.",
    "Use the Sentry issue details to choose what part of the app to exercise.",
    "Start from the culprit, issue title, stack signal, breadcrumbs, request URLs, and other issue evidence.",
    "Do not chase unrelated obvious demo bugs unless the Sentry issue evidence points to them.",
    "If you find a runtime error that plausibly matches the Sentry issue, stop broad exploration and file the ticket.",
    `Target app URL: ${input.targetAppUrl}`,
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
    '    "screenshotPaths": ["absolute/path/to/01-start.png"],',
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
    "Your browser actions must be justified by this issue context.",
  ].join("\n");
}
