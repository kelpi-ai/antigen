import { beforeEach, describe, expect, it, vi } from "vitest";

const { runCodexTaskMock, inspectSentryIssueMock } = vi.hoisted(() => ({
  runCodexTaskMock: vi.fn(),
  inspectSentryIssueMock: vi.fn(),
}));

vi.mock("../../src/codex/fixer", () => ({
  runCodexTask: runCodexTaskMock,
}));

vi.mock("../../src/sentry/inspectIssue", () => ({
  inspectSentryIssue: inspectSentryIssueMock,
}));

import { fetchTicketContext } from "../../src/linear/fetchTicketContext";

describe("fetchTicketContext", () => {
  beforeEach(() => {
    runCodexTaskMock.mockReset();
    inspectSentryIssueMock.mockReset();
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

  it("fills safe defaults when Codex returns a weaker ticket payload", async () => {
    const input = {
      ticketId: "abc-4",
      identifier: "ABC-4",
      module: "checkout",
      url: "https://linear.app/org/issue/ABC-4",
    };

    runCodexTaskMock.mockResolvedValue(
      [
        "LOG",
        'LINEAR_TICKET_CONTEXT {"ticketId":"abc-4","identifier":"ABC-4","module":"","url":"https://linear.app/org/issue/ABC-4","title":"","body":"","browserVisible":"true","similarIssueContext":"","environmentHints":{"browser":"","os":"Linux"}}',
      ].join("\n"),
    );

    const ticketContext = await fetchTicketContext(input);

    expect(ticketContext).toEqual({
      ...input,
      title: "ABC-4",
      body: "Ticket body unavailable.",
      browserVisible: true,
      similarIssueContext: "No similar issue context provided.",
      environmentHints: {
        browser: "unknown",
        os: "Linux",
        viewport: "unknown",
      },
    });
  });

  it("enriches ticket context with Sentry Seer analysis when a Sentry issue reference is present", async () => {
    const input = {
      ticketId: "abc-6",
      identifier: "ABC-6",
      module: "checkout",
      url: "https://linear.app/org/issue/ABC-6",
    };

    runCodexTaskMock.mockResolvedValue(
      [
        "LOG",
        'LINEAR_TICKET_CONTEXT {"ticketId":"abc-6","identifier":"ABC-6","module":"checkout","url":"https://linear.app/org/issue/ABC-6","title":"Checkout crash","body":"See linked Sentry issue","browserVisible":true,"similarIssueContext":"Prior checkout crash","environmentHints":{"browser":"Safari","os":"macOS","viewport":"1440x900"},"sentryIssue":{"id":"SENTRY-123","url":"https://sentry.io/issues/123/"}}',
      ].join("\n"),
    );
    inspectSentryIssueMock.mockResolvedValue({
      issue: {
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
    });

    const ticketContext = await fetchTicketContext(input);

    expect(inspectSentryIssueMock).toHaveBeenCalledWith({
      id: "SENTRY-123",
      url: "https://sentry.io/issues/123/",
    });
    expect(ticketContext).toMatchObject({
      ...input,
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
    });
  });

  it("keeps the existing ticket context when Sentry enrichment fails", async () => {
    const input = {
      ticketId: "abc-7",
      identifier: "ABC-7",
      module: "checkout",
      url: "https://linear.app/org/issue/ABC-7",
    };

    runCodexTaskMock.mockResolvedValue(
      [
        "LOG",
        'LINEAR_TICKET_CONTEXT {"ticketId":"abc-7","identifier":"ABC-7","module":"checkout","url":"https://linear.app/org/issue/ABC-7","title":"Checkout crash","body":"See linked Sentry issue","browserVisible":true,"similarIssueContext":"Prior checkout crash","environmentHints":{"browser":"Safari","os":"macOS","viewport":"1440x900"},"sentryIssue":{"id":"SENTRY-456","url":"https://sentry.io/issues/456/"}}',
      ].join("\n"),
    );
    inspectSentryIssueMock.mockRejectedValue(new Error("Sentry MCP unavailable"));

    const ticketContext = await fetchTicketContext(input);

    expect(ticketContext).toMatchObject({
      ...input,
      title: "Checkout crash",
      sentryIssue: {
        id: "SENTRY-456",
        url: "https://sentry.io/issues/456/",
      },
    });
    expect(ticketContext.seer).toBeUndefined();
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

  it("throws when the tagged payload is not a JSON object", async () => {
    const input = {
      ticketId: "abc-5",
      identifier: "ABC-5",
      module: "checkout",
      url: "https://linear.app/org/issue/ABC-5",
    };

    runCodexTaskMock.mockResolvedValue('LINEAR_TICKET_CONTEXT "not-an-object"');

    await expect(fetchTicketContext(input)).rejects.toThrow(/expected JSON object/);
  });
});
