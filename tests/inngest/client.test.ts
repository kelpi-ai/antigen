import { describe, it, expect } from "vitest";
import { inngest } from "../../src/inngest/client";

describe("inngest client", () => {
  it("exports a singleton with the expected id", () => {
    expect(inngest).toBeDefined();
    expect(inngest.id).toBe("incident-loop");
  });
});
