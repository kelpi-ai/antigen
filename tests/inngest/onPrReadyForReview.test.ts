import { describe, expect, it, vi } from "vitest";
import type { ReducerResult } from "../../src/p3/contracts";

vi.mock("../../src/p3/orchestrate", () => ({
  runPrHunter: vi.fn(),
}));

import { functions } from "../../src/inngest";
import { onPrReadyForReview } from "../../src/inngest/functions/onPrReadyForReview";
import { runPrHunter } from "../../src/p3/orchestrate";

describe("on-pr-ready-for-review", () => {
  it("registers id and trigger", () => {
    expect(onPrReadyForReview.id()).toBe("on-pr-ready-for-review");
    expect(onPrReadyForReview.opts).toMatchObject({
      id: "on-pr-ready-for-review",
      triggers: [{ event: "github/pr.ready_for_review" }],
      retries: 1,
      concurrency: { limit: 1, key: "event.data.prNumber" },
    });
  });

  it("is registered in the barrel", () => {
    expect(functions).toContain(onPrReadyForReview);
  });

  it("delegates event payload to runPrHunter", async () => {
    const step = {
      run: vi.fn(async (_name: string, fn: () => unknown) => fn()),
    };

    const result: ReducerResult = {
      status: "clean",
      prComment: "No risk found",
      investigationTickets: [],
    } as const;
    vi.mocked(runPrHunter).mockResolvedValueOnce(result);

    const event = {
      name: "github/pr.ready_for_review",
      data: {
        prNumber: 123,
        repo: "acme/app",
        prUrl: "https://github.com/acme/app/pull/123",
        headSha: "head-sha",
      baseSha: "base-sha",
      },
    };
    const returned = await (onPrReadyForReview as unknown as { [key: string]: (...args: any[]) => Promise<ReducerResult> })["fn"]({
      event,
      step,
    } as any);

    expect(runPrHunter).toHaveBeenCalledWith({ event: event.data, step });
    expect(returned).toEqual(result);
  });
});
  
