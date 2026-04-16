import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadEnv } from "../../src/config/env";

describe("loadEnv", () => {
  const original = { ...process.env };
  beforeEach(() => { process.env = { ...original }; });
  afterEach(() => { process.env = original; });

  it("parses valid env", () => {
    process.env.INNGEST_EVENT_KEY = "test-key";
    process.env.INNGEST_SIGNING_KEY = "signkey_test";
    process.env.CODEX_BIN = "/usr/local/bin/codex";
    process.env.PORT = "3000";

    const env = loadEnv();
    expect(env.INNGEST_EVENT_KEY).toBe("test-key");
    expect(env.CODEX_BIN).toBe("/usr/local/bin/codex");
    expect(env.PORT).toBe(3000);
  });

  it("defaults PORT to 3000", () => {
    process.env.INNGEST_EVENT_KEY = "test-key";
    process.env.INNGEST_SIGNING_KEY = "signkey_test";
    process.env.CODEX_BIN = "/usr/local/bin/codex";
    delete process.env.PORT;
    expect(loadEnv().PORT).toBe(3000);
  });

  it("throws on missing required var", () => {
    delete process.env.INNGEST_EVENT_KEY;
    process.env.INNGEST_SIGNING_KEY = "signkey_test";
    process.env.CODEX_BIN = "/usr/local/bin/codex";
    expect(() => loadEnv()).toThrow(/INNGEST_EVENT_KEY/);
  });
});
