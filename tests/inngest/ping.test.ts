import { describe, it, expect } from "vitest";
import { ping } from "../../src/inngest/functions/ping";
import { functions } from "../../src/inngest";

describe("ping function", () => {
  it("has id 'ping'", () => {
    expect(ping.id()).toBe("ping");
  });

  it("is registered in the barrel", () => {
    expect(functions).toContain(ping);
  });
});
