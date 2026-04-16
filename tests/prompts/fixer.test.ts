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
    expect(prompt).toContain("regression guard");
    expect(prompt).toContain("GitHub MCP");
    expect(prompt).toContain("systematic-debugging");
    expect(prompt).toContain('FIXER_RESULT {"status":"ok","prUrl":');
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
  });
});
