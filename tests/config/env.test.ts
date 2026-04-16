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
    process.env.GITHUB_WEBHOOK_SECRET = "gh-secret";
    process.env.CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
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
    process.env.GITHUB_WEBHOOK_SECRET = "gh-secret";
    process.env.CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
    delete process.env.PORT;
    expect(loadEnv().PORT).toBe(3000);
  });

  it("throws on missing required var", () => {
    delete process.env.INNGEST_EVENT_KEY;
    process.env.INNGEST_SIGNING_KEY = "signkey_test";
    process.env.CODEX_BIN = "/usr/local/bin/codex";
    expect(() => loadEnv()).toThrow(/INNGEST_EVENT_KEY/);
  });

  it("parses GitHub webhook and P3 runtime vars", () => {
    process.env.INNGEST_EVENT_KEY = "x";
    process.env.INNGEST_SIGNING_KEY = "x";
    process.env.CODEX_BIN = "/usr/local/bin/codex";
    process.env.GITHUB_WEBHOOK_SECRET = "gh-secret";
    process.env.CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
    process.env.ARTIFACTS_DIR = ".incident-loop-artifacts";
    process.env.MAX_SCENARIOS_PER_PR = "5";
    process.env.P3_EXECUTOR_CONCURRENCY = "2";

    const env = loadEnv();
    expect(env.GITHUB_WEBHOOK_SECRET).toBe("gh-secret");
    expect(env.CHROME_PATH).toContain("Google Chrome");
    expect(env.ARTIFACTS_DIR).toBe(".incident-loop-artifacts");
    expect(env.MAX_SCENARIOS_PER_PR).toBe(5);
    expect(env.P3_EXECUTOR_CONCURRENCY).toBe(2);
  });
});
