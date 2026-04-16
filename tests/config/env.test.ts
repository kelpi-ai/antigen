import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadEnv } from "../../src/config/env";

describe("loadEnv", () => {
  const original = { ...process.env };
  beforeEach(() => { process.env = { ...original }; });
  afterEach(() => { process.env = original; });

  it("parses localhost env values", () => {
    process.env.INNGEST_EVENT_KEY = "test-key";
    process.env.INNGEST_SIGNING_KEY = "signkey_test";
    process.env.OPENAI_API_KEY = "sk-openai";
    process.env.TARGET_APP_URL = "https://app.internal";
    process.env.SENTRY_WEBHOOK_SECRET = "sentry-webhook-secret";
    process.env.LINEAR_API_KEY = "linear-api-key";
    process.env.LINEAR_WEBHOOK_SECRET = "linear-webhook-secret";
    process.env.TARGET_REPO_PATH = "/tmp/target-repo";
    process.env.TARGET_REPO_WORKTREE_ROOT = "/tmp/worktrees";
    process.env.TARGET_REPO_REMOTE = "upstream";
    process.env.TARGET_REPO_BASE_BRANCH = "develop";
    process.env.ARTIFACTS_DIR = "/tmp/artifacts";
    process.env.CHROME_PATH = "/usr/bin/chrome";
    process.env.FFMPEG_BIN = "/usr/bin/ffmpeg";
    process.env.PORT = "3001";

    const env = loadEnv();
    expect(env.INNGEST_EVENT_KEY).toBe("test-key");
    expect(env.INNGEST_SIGNING_KEY).toBe("signkey_test");
    expect(env.OPENAI_API_KEY).toBe("sk-openai");
    expect(env.TARGET_APP_URL).toBe("https://app.internal");
    expect(env.SENTRY_WEBHOOK_SECRET).toBe("sentry-webhook-secret");
    expect(env.LINEAR_API_KEY).toBe("linear-api-key");
    expect(env.LINEAR_WEBHOOK_SECRET).toBe("linear-webhook-secret");
    expect(env.TARGET_REPO_PATH).toBe("/tmp/target-repo");
    expect(env.TARGET_REPO_WORKTREE_ROOT).toBe("/tmp/worktrees");
    expect(env.TARGET_REPO_REMOTE).toBe("upstream");
    expect(env.TARGET_REPO_BASE_BRANCH).toBe("develop");
    expect(env.ARTIFACTS_DIR).toBe("/tmp/artifacts");
    expect(env.CHROME_PATH).toBe("/usr/bin/chrome");
    expect(env.FFMPEG_BIN).toBe("/usr/bin/ffmpeg");
    expect(env.PORT).toBe(3001);
  });

  it("applies localhost defaults", () => {
    process.env.INNGEST_EVENT_KEY = "test-key";
    process.env.INNGEST_SIGNING_KEY = "signkey_test";
    process.env.OPENAI_API_KEY = "sk-openai";
    process.env.TARGET_APP_URL = "https://app.internal";
    process.env.SENTRY_WEBHOOK_SECRET = "sentry-webhook-secret";
    process.env.LINEAR_API_KEY = "linear-api-key";
    process.env.LINEAR_WEBHOOK_SECRET = "linear-webhook-secret";
    process.env.TARGET_REPO_PATH = "/tmp/target-repo";
    process.env.TARGET_REPO_WORKTREE_ROOT = "/tmp/worktrees";
    delete process.env.ARTIFACTS_DIR;
    delete process.env.CHROME_PATH;
    delete process.env.FFMPEG_BIN;
    delete process.env.PORT;
    delete process.env.TARGET_REPO_REMOTE;
    delete process.env.TARGET_REPO_BASE_BRANCH;

    const env = loadEnv();
    expect(env.TARGET_REPO_REMOTE).toBe("origin");
    expect(env.TARGET_REPO_BASE_BRANCH).toBe("main");
    expect(env.ARTIFACTS_DIR).toBe(".incident-loop-artifacts");
    expect(env.PORT).toBe(3000);
    expect(env.CHROME_PATH).toBeUndefined();
    expect(env.FFMPEG_BIN).toBeUndefined();
  });

  it("throws on missing required var", () => {
    delete process.env.INNGEST_EVENT_KEY;
    process.env.INNGEST_SIGNING_KEY = "signkey_test";
    process.env.OPENAI_API_KEY = "sk-openai";
    process.env.TARGET_APP_URL = "https://app.internal";
    process.env.SENTRY_WEBHOOK_SECRET = "sentry-webhook-secret";
    process.env.LINEAR_API_KEY = "linear-api-key";
    process.env.LINEAR_WEBHOOK_SECRET = "linear-webhook-secret";
    process.env.TARGET_REPO_PATH = "/tmp/target-repo";
    process.env.TARGET_REPO_WORKTREE_ROOT = "/tmp/worktrees";

    expect(() => loadEnv()).toThrow(/INNGEST_EVENT_KEY/);
  });

  it("throws when a newly required localhost variable is missing", () => {
    process.env.INNGEST_EVENT_KEY = "test-key";
    process.env.INNGEST_SIGNING_KEY = "signkey_test";
    delete process.env.OPENAI_API_KEY;
    process.env.TARGET_APP_URL = "https://app.internal";
    process.env.SENTRY_WEBHOOK_SECRET = "sentry-webhook-secret";
    process.env.LINEAR_API_KEY = "linear-api-key";
    process.env.LINEAR_WEBHOOK_SECRET = "linear-webhook-secret";
    process.env.TARGET_REPO_PATH = "/tmp/target-repo";
    process.env.TARGET_REPO_WORKTREE_ROOT = "/tmp/worktrees";

    expect(() => loadEnv()).toThrow(/OPENAI_API_KEY/);
  });
});
