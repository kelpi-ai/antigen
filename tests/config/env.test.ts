import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadEnv, loadP2Env, loadP3Env } from "../../src/config/env";

const baseEnv = {
  INNGEST_EVENT_KEY: "test-key",
  INNGEST_SIGNING_KEY: "signkey_test",
};

const p2Env = {
  ...baseEnv,
  OPENAI_API_KEY: "sk-openai",
  TARGET_APP_URL: "https://app.internal",
  SENTRY_WEBHOOK_SECRET: "sentry-webhook-secret",
  LINEAR_API_KEY: "linear-api-key",
  LINEAR_WEBHOOK_SECRET: "linear-webhook-secret",
  TARGET_REPO_PATH: "/tmp/target-repo",
  TARGET_REPO_WORKTREE_ROOT: "/tmp/worktrees",
};

const p3Env = {
  ...baseEnv,
  CODEX_BIN: "/usr/local/bin/codex",
  GITHUB_WEBHOOK_SECRET: "gh-secret",
  CHROME_PATH: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
};

describe("config env loaders", () => {
  const original = { ...process.env };

  beforeEach(() => {
    process.env = { ...original };
  });

  afterEach(() => {
    process.env = original;
  });

  it("loads base env without requiring P2 or P3 values", () => {
    Object.assign(process.env, baseEnv);

    const env = loadEnv();

    expect(env.INNGEST_EVENT_KEY).toBe("test-key");
    expect(env.INNGEST_SIGNING_KEY).toBe("signkey_test");
    expect(env.ARTIFACTS_DIR).toBe(".incident-loop-artifacts");
    expect(env.PORT).toBe(3000);
  });

  it("loads P2 env values with defaults", () => {
    Object.assign(process.env, p2Env);
    process.env.TARGET_REPO_REMOTE = "upstream";
    process.env.TARGET_REPO_BASE_BRANCH = "develop";
    process.env.ARTIFACTS_DIR = "/tmp/artifacts";
    process.env.FFMPEG_BIN = "/usr/bin/ffmpeg";
    process.env.PORT = "3001";

    const env = loadP2Env();

    expect(env.OPENAI_API_KEY).toBe("sk-openai");
    expect(env.TARGET_APP_URL).toBe("https://app.internal");
    expect(env.TARGET_REPO_PATH).toBe("/tmp/target-repo");
    expect(env.TARGET_REPO_WORKTREE_ROOT).toBe("/tmp/worktrees");
    expect(env.TARGET_REPO_REMOTE).toBe("upstream");
    expect(env.TARGET_REPO_BASE_BRANCH).toBe("develop");
    expect(env.ARTIFACTS_DIR).toBe("/tmp/artifacts");
    expect(env.FFMPEG_BIN).toBe("/usr/bin/ffmpeg");
    expect(env.PORT).toBe(3001);
  });

  it("loads P3 env values with defaults", () => {
    Object.assign(process.env, p3Env);
    process.env.ARTIFACTS_DIR = "/tmp/artifacts";
    process.env.MAX_SCENARIOS_PER_PR = "7";
    process.env.P3_EXECUTOR_CONCURRENCY = "3";
    process.env.PORT = "3001";

    const env = loadP3Env();

    expect(env.CODEX_BIN).toBe("/usr/local/bin/codex");
    expect(env.GITHUB_WEBHOOK_SECRET).toBe("gh-secret");
    expect(env.CHROME_PATH).toContain("Google Chrome");
    expect(env.ARTIFACTS_DIR).toBe("/tmp/artifacts");
    expect(env.MAX_SCENARIOS_PER_PR).toBe(7);
    expect(env.P3_EXECUTOR_CONCURRENCY).toBe(3);
    expect(env.PORT).toBe(3001);
  });

  it("throws when a required base value is missing", () => {
    delete process.env.INNGEST_EVENT_KEY;
    process.env.INNGEST_SIGNING_KEY = "signkey_test";

    expect(() => loadEnv()).toThrow(/INNGEST_EVENT_KEY/);
  });

  it("throws when a required P2 value is missing", () => {
    Object.assign(process.env, p2Env);
    delete process.env.OPENAI_API_KEY;

    expect(() => loadP2Env()).toThrow(/OPENAI_API_KEY/);
  });

  it("throws when a required P3 value is missing", () => {
    Object.assign(process.env, p3Env);
    delete process.env.CODEX_BIN;

    expect(() => loadP3Env()).toThrow(/CODEX_BIN/);
  });
});
