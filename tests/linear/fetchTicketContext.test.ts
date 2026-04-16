import { describe, expect, it, vi, beforeEach } from "vitest";

const { runCodexTaskMock } = vi.hoisted(() => ({
  runCodexTaskMock: vi.fn(),
}));

vi.mock("../../src/codex/fixer", () => ({
  runCodexTask: runCodexTaskMock,
}));

import { fetchTicketContext } from "../../src/linear/fetchTicketContext";

describe("fetchTicketContext", () => {
  beforeEach(() => {
    runCodexTaskMock.mockReset();
  });

  it("parses LINEAR_TICKET_CONTEXT JSON payload", async () => {
    const input = {
      ticketId: "abc-1",
      identifier: "ABC-1",
      module: "billing",
      url: "https://linear.app/org/issue/ABC-1",
    };

    runCodexTaskMock.mockResolvedValue(
      [
        "LOG",
        'LINEAR_TICKET_CONTEXT {"ticketId":"abc-1","identifier":"ABC-1","module":"payments","url":"https://linear.app/org/issue/ABC-1","title":"Fix checkout","body":"Repro fails when cookie is missing","browserVisible":false,"similarIssueContext":"None","environmentHints":{"browser":"Chromium","os":"Linux","viewport":"1280x720"}}',
      ].join("\n"),
    );

    const ticketContext = await fetchTicketContext(input);

    expect(ticketContext).toEqual({
      ...input,
      title: "Fix checkout",
      body: "Repro fails when cookie is missing",
      module: "payments",
      browserVisible: false,
      similarIssueContext: "None",
      environmentHints: {
        browser: "Chromium",
        os: "Linux",
        viewport: "1280x720",
      },
    });
  });

  it("falls back to input.module when parsed module is empty", async () => {
    const input = {
      ticketId: "abc-2",
      identifier: "ABC-2",
      module: "billing",
      url: "https://linear.app/org/issue/ABC-2",
    };

    runCodexTaskMock.mockResolvedValue(
      [
        "LOG",
        'LINEAR_TICKET_CONTEXT {"ticketId":"abc-2","identifier":"ABC-2","module":"","url":"https://linear.app/org/issue/ABC-2","title":"Fix layout","body":"Bug in grid","browserVisible":true,"similarIssueContext":"old ticket","environmentHints":{"browser":"Firefox","os":"macOS","viewport":"1920x1080"}}',
      ].join("\n"),
    );

    const ticketContext = await fetchTicketContext(input);

    expect(ticketContext.module).toBe("billing");
  });

  it("throws when required payload fields are missing or invalid", async () => {
    const input = {
      ticketId: "abc-4",
      identifier: "ABC-4",
      module: "checkout",
      url: "https://linear.app/org/issue/ABC-4",
    };

    runCodexTaskMock.mockResolvedValue(
      [
        "LOG",
        'LINEAR_TICKET_CONTEXT {"ticketId":"abc-4","identifier":"ABC-4","module":"checkout","url":"https://linear.app/org/issue/ABC-4","title":"", "body":"ok","browserVisible":"true","similarIssueContext":"none","environmentHints":{"browser":"Chromium","os":"Linux","viewport":"1280x720"}}',
      ].join("\n"),
    );

    await expect(fetchTicketContext(input)).rejects.toThrow(/invalid LINEAR_TICKET_CONTEXT payload/);
  });

  it("throws when LINEAR_TICKET_CONTEXT line is missing", async () => {
    const input = {
      ticketId: "abc-3",
      identifier: "ABC-3",
      module: "checkout",
      url: "https://linear.app/org/issue/ABC-3",
    };

    runCodexTaskMock.mockResolvedValue("just debug output\nwithout a tagged line");

    await expect(fetchTicketContext(input)).rejects.toThrow(/missing LINEAR_TICKET_CONTEXT line/);
  });
});
