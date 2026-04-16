import { describe, it, expect, vi, beforeEach } from "vitest";

const startThreadMock = vi.fn();
const runMock = vi.fn();

vi.mock("@openai/codex-sdk", () => ({
  Codex: class Codex {
    startThread(options: unknown) {
      startThreadMock(options);
      return { run: (...args: unknown[]) => runMock(...args) };
    }
  },
}));

import { runCodexReproducer } from "../../src/codex/reproducer";

describe("runCodexReproducer", () => {
  beforeEach(() => {
    startThreadMock.mockReset();
    runMock.mockReset();
  });

  it("runs Codex with structured output and parses the JSON result", async () => {
    runMock.mockResolvedValue({
      finalResponse: JSON.stringify({
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
    });

    const result = await runCodexReproducer({
      prompt: "hello",
      workingDirectory: "/tmp/run",
    });

    expect(startThreadMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gpt-5.4",
        workingDirectory: "/tmp/run",
        skipGitRepoCheck: true,
        approvalPolicy: "never",
        sandboxMode: "danger-full-access",
      }),
    );
    expect(runMock).toHaveBeenCalledWith(
      "hello",
      expect.objectContaining({ outputSchema: expect.any(Object) }),
    );
    expect(result.ticketUrl).toContain("linear.app");
  });

  it("rejects invalid structured output using zod validation", async () => {
    runMock.mockResolvedValue({
      finalResponse: JSON.stringify({
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
    });

    await expect(
      runCodexReproducer({
        prompt: "hello",
        workingDirectory: "/tmp/run",
      }),
    ).rejects.toThrow();
  });
});
