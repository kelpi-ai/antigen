import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadEnv } from "../../src/config/env";

describe("loadEnv", () => {
  const original = { ...process.env };
  beforeEach(() => { process.env = { ...original }; });
  afterEach(() => { process.env = original; });

  it("parses valid env", () => {
    process.env.INNGEST_EVENT_KEY = "test-key";
    process.env.INNGEST_SIGNING_KEY = "signkey_test";
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.TARGET_APP_URL = "http://localhost:3001";
    process.env.SENTRY_WEBHOOK_SECRET = "sentry-secret";
    process.env.LINEAR_API_KEY = "lin_api_xxx";
    process.env.PORT = "3000";

    const env = loadEnv();
    expect(env.INNGEST_EVENT_KEY).toBe("test-key");
    expect(env.OPENAI_API_KEY).toBe("sk-test");
    expect(env.TARGET_APP_URL).toBe("http://localhost:3001");
    expect(env.SENTRY_WEBHOOK_SECRET).toBe("sentry-secret");
    expect(env.LINEAR_API_KEY).toBe("lin_api_xxx");
    expect(env.PORT).toBe(3000);
  });

  it("defaults PORT to 3000", () => {
    process.env.INNGEST_EVENT_KEY = "test-key";
    process.env.INNGEST_SIGNING_KEY = "signkey_test";
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.TARGET_APP_URL = "http://localhost:3001";
    process.env.SENTRY_WEBHOOK_SECRET = "sentry-secret";
    process.env.LINEAR_API_KEY = "lin_api_xxx";
    delete process.env.PORT;
    expect(loadEnv().PORT).toBe(3000);
  });

  it("throws on missing required var", () => {
    delete process.env.INNGEST_EVENT_KEY;
    process.env.INNGEST_SIGNING_KEY = "signkey_test";
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.TARGET_APP_URL = "http://localhost:3001";
    process.env.SENTRY_WEBHOOK_SECRET = "sentry-secret";
    process.env.LINEAR_API_KEY = "lin_api_xxx";
    expect(() => loadEnv()).toThrow(/INNGEST_EVENT_KEY/);
  });

  it("parses localhost demo env vars", () => {
    process.env.INNGEST_EVENT_KEY = "x";
    process.env.INNGEST_SIGNING_KEY = "x";
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.TARGET_APP_URL = "http://localhost:3001";
    process.env.SENTRY_WEBHOOK_SECRET = "sentry-secret";
    process.env.LINEAR_API_KEY = "lin_api_xxx";
    process.env.ARTIFACTS_DIR = ".incident-loop-artifacts";
    process.env.CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
    process.env.FFMPEG_BIN = "/opt/homebrew/bin/ffmpeg";

    const env = loadEnv();
    expect(env.OPENAI_API_KEY).toBe("sk-test");
    expect(env.TARGET_APP_URL).toBe("http://localhost:3001");
    expect(env.ARTIFACTS_DIR).toBe(".incident-loop-artifacts");
  });
});
