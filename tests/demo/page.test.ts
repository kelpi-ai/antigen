import { describe, expect, it } from "vitest";
import { renderRunDetailPage } from "../../src/demo/page";
import type { RunDetailViewModel } from "../../src/demo/runDetails";

const sampleModel: RunDetailViewModel = {
  summary: {
    runId: "run-123",
    status: "reproduced",
    sentryIssueId: "7416598214",
    sentryIssueUrl: "https://shipfast-qa.sentry.io/issues/7416598214/",
    ticketUrl: "https://linear.app/example/ENG-1",
    finalUrl: "file:///tmp/index.html",
    expected: "Checkout succeeds",
    actual: "PaymentProcessingError shown",
    targetAppUrl: "file:///tmp/index.html",
  },
  flow: [
    {
      key: "linear-ticket",
      title: "Linear ticket created",
      status: "completed",
      summary: "Codex filed the reproduction in Linear.",
      detail: "https://linear.app/example/ENG-1",
    },
  ],
  timeline: [
    {
      step: "codex-browser-reproduction",
      status: "completed",
      startedAt: "",
      endedAt: "",
      summary: "Codex replayed the issue in the browser",
      payload: {},
    },
  ],
  evidence: {
    videoUrl: "/demo/media/runs/run-123/browser.mp4",
    videoAvailable: true,
    videoLabel: "Run video available",
    steps: ["Open ticket", "Trigger failure"],
    consoleErrors: 2,
    failedRequests: 1,
    summary: "Reproduced issue",
  },
  sentry: {
    title: "PaymentProcessingError",
    culprit: "triggerError(index.html)",
    permalink: "https://shipfast-qa.sentry.io/issues/7416598214/",
    breadcrumbs: [],
    stackSnippet: "",
  },
  codex: {
    milestones: [
      {
        step: "codex-linear-ticket",
        summary: "Codex created the Linear ticket",
        raw: {
          type: "item.completed",
          item: { type: "mcp_tool_call", server: "linear", tool: "save_issue" },
        },
      },
    ],
    rawEvents: [
      {
        type: "item.completed",
        item: { type: "mcp_tool_call", server: "linear", tool: "save_issue" },
      },
    ],
  },
};

describe("renderRunDetailPage", () => {
  it("renders the flow, evidence, and codex sections", () => {
    const html = renderRunDetailPage(sampleModel);

    expect(html).toContain("Latest Run");
    expect(html).toContain("What the loop has done");
    expect(html).toContain("Evidence trail");
    expect(html).toContain("Collapsed raw codex events");
    expect(html).toContain("/demo/data");
    expect(html).toContain("browser.mp4");
  });
});
