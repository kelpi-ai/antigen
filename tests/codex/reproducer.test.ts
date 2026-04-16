import { describe, it, expect, vi, beforeEach } from "vitest";

const startThreadMock = vi.fn();
const runStreamedMock = vi.fn();
const writeFileMock = vi.fn();
const appendFileMock = vi.fn();

vi.mock("@openai/codex-sdk", () => ({
  Codex: class Codex {
    startThread(options: unknown) {
      startThreadMock(options);
      return { runStreamed: (...args: unknown[]) => runStreamedMock(...args) };
    }
  },
}));

vi.mock("node:fs/promises", async () => {
  const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  return {
    ...actual,
    writeFile: (...args: unknown[]) => writeFileMock(...args),
    appendFile: (...args: unknown[]) => appendFileMock(...args),
  };
});

import {
  extractCodexMilestones,
  extractRecordingAssessment,
  runCodexReproducer,
} from "../../src/codex/reproducer";

describe("runCodexReproducer", () => {
  beforeEach(() => {
    startThreadMock.mockReset();
    runStreamedMock.mockReset();
    writeFileMock.mockReset();
    appendFileMock.mockReset();
  });

  it("runs Codex with structured output and parses the JSON result", async () => {
    runStreamedMock.mockResolvedValue({
      events: (async function* () {
        yield { type: "thread.started", thread_id: "thread-1" };
        yield {
          type: "item.completed",
          item: {
            id: "item-1",
            type: "agent_message",
            text: JSON.stringify({
              status: "reproduced",
              reproduced: true,
              ticketUrl: "https://linear.app/example/ENG-1",
              summary: "example",
              finalUrl: "http://localhost:3001/checkout",
              steps: ["one"],
              expected: "expected",
              actual: "actual",
              evidence: {
                videoPath: ".incident-loop-artifacts/runs/abc/browser.mp4",
                consoleErrors: 1,
                failedRequests: 0,
              },
            }),
          },
        };
        yield { type: "turn.completed", usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1 } };
      })(),
    });

    const result = await runCodexReproducer({
      prompt: "hello",
      workingDirectory: "/tmp/run",
      eventsPath: "/tmp/run/codex-events.jsonl",
    });

    expect(startThreadMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gpt-5.3-codex-spark",
        workingDirectory: "/tmp/run",
        skipGitRepoCheck: true,
        approvalPolicy: "never",
        sandboxMode: "danger-full-access",
      }),
    );
    expect(runStreamedMock).toHaveBeenCalledWith(
      "hello",
      expect.objectContaining({
        outputSchema: expect.objectContaining({
          properties: expect.objectContaining({
            ticketUrl: expect.objectContaining({ type: "string" }),
            finalUrl: expect.objectContaining({ type: "string" }),
          }),
        }),
      }),
    );
    expect(writeFileMock).toHaveBeenCalledWith("/tmp/run/codex-events.jsonl", "");
    expect(appendFileMock).toHaveBeenCalled();
    expect(result.ticketUrl).toContain("linear.app");
  });

  it("extracts user-visible milestones from completed MCP tool calls", () => {
    const milestones = extractCodexMilestones([
      {
        type: "item.completed",
        item: {
          type: "mcp_tool_call",
          status: "completed",
          server: "sentry-bubble-reel",
          tool: "get_sentry_resource",
          arguments: { url: "https://example.sentry.io/issues/123/" },
          result: { content: [{ type: "text", text: "issue details" }] },
        },
      },
      {
        type: "item.completed",
        item: {
          type: "mcp_tool_call",
          status: "completed",
          server: "sentry-bubble-reel",
          tool: "get_sentry_resource",
          arguments: { url: "https://example.sentry.io/issues/ABC", resourceType: "breadcrumbs" },
          result: { content: [{ type: "text", text: "breadcrumbs" }] },
        },
      },
      {
        type: "item.completed",
        item: {
          type: "mcp_tool_call",
          status: "completed",
          server: "chrome-devtools",
          tool: "take_snapshot",
          result: { content: [{ type: "text", text: "Error: Payment Processing Failed\n500 Internal Server Error" }] },
        },
      },
      {
        type: "item.completed",
        item: {
          type: "mcp_tool_call",
          status: "completed",
          server: "linear",
          tool: "save_issue",
          result: { content: [{ type: "text", text: "{\"id\":\"UNF-18\"}" }] },
        },
      },
    ] as never[]);

    expect(milestones.map((milestone) => milestone.stepName)).toEqual([
      "codex-sentry-issue",
      "codex-sentry-breadcrumbs",
      "codex-browser-reproduction",
      "codex-browser-error-state",
      "codex-linear-ticket",
    ]);
  });

  it("marks recording as suspect when Codex opens a new page", () => {
    const assessment = extractRecordingAssessment([
      {
        type: "item.completed",
        item: {
          type: "mcp_tool_call",
          status: "completed",
          server: "chrome-devtools",
          tool: "new_page",
          arguments: { url: "file:///tmp/index.html" },
        },
      },
    ] as never[]);

    expect(assessment).toEqual({
      status: "suspect",
      reason: "Codex opened a new page, so the saved video may not include the full reproduction.",
      openedNewPage: true,
    });
  });

  it("rejects invalid structured output using zod validation", async () => {
    runStreamedMock.mockResolvedValue({
      events: (async function* () {
        yield {
          type: "item.completed",
          item: {
            id: "item-1",
            type: "agent_message",
            text: JSON.stringify({
              status: "reproduced",
              reproduced: true,
              ticketUrl: "not-a-url",
              summary: "example",
              finalUrl: "http://localhost:3001/checkout",
              steps: ["one"],
              expected: "expected",
              actual: "actual",
              evidence: {
                videoPath: ".incident-loop-artifacts/runs/abc/browser.mp4",
                consoleErrors: 1,
                failedRequests: 0,
              },
            }),
          },
        };
      })(),
    });

    await expect(
      runCodexReproducer({
        prompt: "hello",
        workingDirectory: "/tmp/run",
        eventsPath: "/tmp/run/codex-events.jsonl",
      }),
    ).rejects.toThrow();
  });

  it("rejects malformed JSON from Codex", async () => {
    runStreamedMock.mockResolvedValue({
      events: (async function* () {
        yield {
          type: "item.completed",
          item: {
            id: "item-1",
            type: "agent_message",
            text: "not-json",
          },
        };
      })(),
    });

    await expect(
      runCodexReproducer({
        prompt: "hello",
        workingDirectory: "/tmp/run",
        eventsPath: "/tmp/run/codex-events.jsonl",
      }),
    ).rejects.toThrow(/invalid JSON/i);
  });

  it("rejects when Codex never returns a final agent message", async () => {
    runStreamedMock.mockResolvedValue({
      events: (async function* () {
        yield { type: "thread.started", thread_id: "thread-1" };
        yield { type: "turn.completed", usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1 } };
      })(),
    });

    await expect(
      runCodexReproducer({
        prompt: "hello",
        workingDirectory: "/tmp/run",
        eventsPath: "/tmp/run/codex-events.jsonl",
      }),
    ).rejects.toThrow(/did not return a final response/i);
  });

  it("returns after turn completion even if the event stream stays open", async () => {
    runStreamedMock.mockResolvedValue({
      events: (async function* () {
        yield { type: "thread.started", thread_id: "thread-1" };
        yield {
          type: "item.completed",
          item: {
            id: "item-1",
            type: "agent_message",
            text: JSON.stringify({
              status: "reproduced",
              reproduced: true,
              ticketUrl: "https://linear.app/example/ENG-2",
              summary: "example",
              finalUrl: "file:///tmp/index.html",
              steps: ["one"],
              expected: "expected",
              actual: "actual",
              evidence: {
                videoPath: ".incident-loop-artifacts/runs/abc/browser.mp4",
                consoleErrors: 0,
                failedRequests: 0,
              },
            }),
          },
        };
        yield {
          type: "turn.completed",
          usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1 },
        };
        await new Promise(() => {});
      })(),
    });

    await expect(
      Promise.race([
        runCodexReproducer({
          prompt: "hello",
          workingDirectory: "/tmp/run",
          eventsPath: "/tmp/run/codex-events.jsonl",
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error("timed out")), 50)),
      ]),
    ).resolves.toMatchObject({
      status: "reproduced",
      reproduced: true,
      ticketUrl: "https://linear.app/example/ENG-2",
    });
  });
});
