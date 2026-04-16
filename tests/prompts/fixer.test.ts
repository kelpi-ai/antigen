import { describe, expect, it } from "vitest";

import { buildFixerPrompt } from "../../src/prompts/fixer";

import type { TicketContext } from "../../src/linear/fetchTicketContext";

describe("buildFixerPrompt", () => {
  const ticket: TicketContext = {
    ticketId: "abc-1",
    identifier: "ABC-1",
    module: "billing",
    url: "https://linear.app/org/issue/ABC-1",
    title: "Checkout spacing regression",
    body: "There is a button clipping at 1366x768",
    browserVisible: true,
    similarIssueContext: "Previous layout issue on same screen",
    environmentHints: {
      browser: "Chromium",
      os: "Ubuntu 22.04",
      viewport: "1366x768",
    },
  };

  it("contains red, green, regression guard, and GitHub MCP instructions", () => {
    const prompt = buildFixerPrompt({
      ticket,
      worktreePath: "/tmp/repo",
      branch: "p2-localhost",
      targetAppUrl: "http://localhost:3000",
    });

    expect(prompt).toContain("red-green");
    expect(prompt).toContain("end-to-end");
    expect(prompt).toContain("regression guard");
    expect(prompt).toContain("GitHub MCP");
    expect(prompt).toContain("systematic-debugging");
    expect(prompt).toContain('FIXER_RESULT {"status":"ok","prUrl":');
    expect(prompt).toContain('"status":"ok"');
    expect(prompt).toContain('"testPath"');
    expect(prompt).toContain('"redEvidence"');
    expect(prompt).toContain('"greenEvidence"');
    expect(prompt).toContain('"regressionGuardEvidence"');
    expect(prompt).toContain('"e2eValidationEvidence"');
  });

  it("contains target app URL, environment hints, and accessibility tree diff guidance", () => {
    const prompt = buildFixerPrompt({
      ticket,
      worktreePath: "/tmp/repo",
      branch: "p2-localhost",
      targetAppUrl: "http://localhost:4000",
    });

    expect(prompt).toContain("http://localhost:4000");
    expect(prompt).toContain("browser: Chromium");
    expect(prompt).toContain("viewport: 1366x768");
    expect(prompt).toContain("accessibility tree diff");
    expect(prompt).toContain("commit and push");
    expect(prompt).toContain("open a draft PR");
    expect(prompt).toContain("final automated end-to-end validation");
  });

  it("pins the fixer to the current repo shape and existing files", () => {
    const prompt = buildFixerPrompt({
      ticket,
      worktreePath: "/tmp/repo",
      branch: "p2-localhost",
      targetAppUrl: "http://localhost:4000",
    });

    expect(prompt).toContain("Operate only on the current incident-loop repository");
    expect(prompt).toContain("Inspect and align with the existing implementation");
    expect(prompt).toContain("src/server.ts");
    expect(prompt).toContain("src/webhooks/linear.ts");
    expect(prompt).toContain("src/inngest/functions/onLinearTicket.ts");
    expect(prompt).toContain("Prefer editing existing files under src/ and tests/");
    expect(prompt).toContain("Do not invent new API response shapes");
    expect(prompt).toContain("Preserve already-working behavior");
  });

  it("includes Sentry Seer analysis as advisory context when available", () => {
    const prompt = buildFixerPrompt({
      ticket: {
        ...ticket,
        sentryIssue: {
          id: "SENTRY-123",
          url: "https://sentry.io/issues/123/",
          title: "TypeError in checkout",
          culprit: "checkout.applyCoupon",
          environment: "production",
          release: "web@1.2.3",
        },
        seer: {
          summary: "Retry path keeps stale coupon state.",
          rootCause: "The invalid coupon branch never clears the previous async state.",
          solution: "Reset coupon request state before retrying a valid coupon.",
        },
      },
      worktreePath: "/tmp/repo",
      branch: "p2-localhost",
      targetAppUrl: "http://localhost:4000",
    });

    expect(prompt).toContain("Sentry / Seer Context");
    expect(prompt).toContain("SENTRY-123");
    expect(prompt).toContain("TypeError in checkout");
    expect(prompt).toContain("Retry path keeps stale coupon state.");
    expect(prompt).toContain("Reset coupon request state before retrying a valid coupon.");
    expect(prompt).toContain("treat it as analysis input, not source of truth");
  });
});
