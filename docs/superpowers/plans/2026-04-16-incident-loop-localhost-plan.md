# Incident Loop Localhost Demo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the browser-use/cloud reproducer path with a localhost-only demo flow where a Codex reproducer agent uses Chrome DevTools MCP, saves a full browser video to disk, and creates the Linear ticket itself.

**Architecture:** Keep Hono + Inngest as the event shell, but move the reproducer runtime to a run-oriented coordinator: create a run directory, launch a dedicated Chrome instance, start CDP-based recording, invoke the Codex reproducer through the SDK path, stop recording in `finally`, and persist metadata. Codex owns the investigation and ticket creation; Node owns lifecycle and artifacts.

**Tech Stack:** TypeScript 5.x, Node 20+, pnpm, Hono, Inngest, zod, vitest, tsx, `@openai/agents`, `@openai/agents-extensions`, `@openai/codex-sdk`, `chrome-remote-interface`

**Spec:** `docs/superpowers/specs/2026-04-16-incident-loop-localhost-design.md`

**Scope note:** This plan supersedes the old incident-loop P0/P1 path. P2/P3 are intentionally out of scope until they are redesigned against the localhost architecture.

---

## File Structure

```text
package.json                         # add SDK + CDP dependencies
.env.example                         # localhost demo env vars
README.md                            # local prerequisites + manual E2E

src/
  config/env.ts                      # remove CODEX_BIN, add localhost demo env vars
  runs/createRun.ts                  # run ids, artifact dirs, initial metadata
  codex/config.ts                    # writes per-run .codex/config.toml overlay for Chrome DevTools MCP
  codex/reproducer.ts                # runs Codex via SDK and validates structured result
  browser/session.ts                 # launches dedicated Chrome with remote debugging port
  browser/record.ts                  # records full browser session to browser.mp4 via CDP + ffmpeg
  prompts/reproducer.ts              # builds localhost/DevTools/Linear ticket prompt
  webhooks/verify.ts                 # HMAC verification helper
  webhooks/sentry.ts                 # Sentry webhook -> Inngest event
  inngest/functions/onSentryIssue.ts # run coordinator for the repro flow
  inngest/index.ts                   # register on-sentry-issue
  server.ts                          # mount webhook route

tests/
  config/env.test.ts
  runs/createRun.test.ts
  codex/config.test.ts
  codex/reproducer.test.ts
  browser/session.test.ts
  browser/record.test.ts
  prompts/reproducer.test.ts
  webhooks/verify.test.ts
  webhooks/sentry.test.ts
  inngest/onSentryIssue.test.ts
  server.test.ts
```

**Responsibilities**

- `src/runs/createRun.ts` is the only place that decides artifact layout.
- `src/codex/config.ts` is the only place that writes the per-run Codex config overlay.
- `src/browser/session.ts` is the only place that launches Chrome.
- `src/browser/record.ts` is the only place that knows how to capture browser video.
- `src/codex/reproducer.ts` is the only place that invokes the Codex reproducer SDK path.
- `src/inngest/functions/onSentryIssue.ts` coordinates the run lifecycle but does not author the ticket.

## Task 1: Update dependencies and env for the localhost demo

**Files:**
- Modify: `package.json`
- Modify: `.env.example`
- Modify: `src/config/env.ts`
- Modify: `tests/config/env.test.ts`

- [ ] **Step 1: Extend the env test for the new localhost-demo variables**

Append a new test to `tests/config/env.test.ts`:

```ts
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
```

- [ ] **Step 2: Remove `CODEX_BIN` from the env schema and add the new variables**

Update `src/config/env.ts` so the schema becomes:

```ts
const EnvSchema = z.object({
  INNGEST_EVENT_KEY: z.string().min(1),
  INNGEST_SIGNING_KEY: z.string().min(1),
  OPENAI_API_KEY: z.string().min(1),
  TARGET_APP_URL: z.string().url(),
  SENTRY_WEBHOOK_SECRET: z.string().min(1),
  LINEAR_API_KEY: z.string().min(1),
  ARTIFACTS_DIR: z.string().min(1).default(".incident-loop-artifacts"),
  CHROME_PATH: z.string().min(1).optional(),
  FFMPEG_BIN: z.string().min(1).optional(),
  PORT: z.coerce.number().int().positive().default(3000),
});
```

- [ ] **Step 3: Update `.env.example`**

Replace the current incident-loop env block with:

```dotenv
INNGEST_EVENT_KEY=
INNGEST_SIGNING_KEY=
OPENAI_API_KEY=
TARGET_APP_URL=http://localhost:3001
SENTRY_WEBHOOK_SECRET=
LINEAR_API_KEY=
ARTIFACTS_DIR=.incident-loop-artifacts
CHROME_PATH=
FFMPEG_BIN=
PORT=3000
```

- [ ] **Step 4: Add the SDK and CDP dependencies**

Update `package.json` dependencies to add:

```json
{
  "@openai/agents": "^0.1.0",
  "@openai/agents-extensions": "^0.1.0",
  "@openai/codex-sdk": "^0.1.0",
  "chrome-remote-interface": "^0.33.0"
}
```

Keep existing dependencies intact.

- [ ] **Step 5: Install and verify**

Run: `pnpm install && pnpm test tests/config/env.test.ts && pnpm typecheck`

Expected: install succeeds, env test passes, typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml .env.example src/config/env.ts tests/config/env.test.ts
git commit -m "plan task 1: update localhost demo env and dependencies"
```

## Task 2: Add run scaffolding and per-run Codex config overlay

**Files:**
- Create: `src/runs/createRun.ts`
- Create: `src/codex/config.ts`
- Create: `tests/runs/createRun.test.ts`
- Create: `tests/codex/config.test.ts`

- [ ] **Step 1: Write the failing run scaffolding test**

Create `tests/runs/createRun.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRun } from "../../src/runs/createRun";

describe("createRun", () => {
  it("creates a run directory and metadata file path", async () => {
    const root = await mkdtemp(join(tmpdir(), "incident-loop-"));
    const run = await createRun({
      artifactsRoot: root,
      sentryIssueId: "SENTRY-123",
      targetAppUrl: "http://localhost:3001",
    });

    expect(run.runId).toMatch(/^[a-f0-9-]+$/);
    expect(run.runDir).toContain(root);
    expect(run.videoPath.endsWith("browser.mp4")).toBe(true);
    expect(run.metadataPath.endsWith("metadata.json")).toBe(true);

    const metadata = JSON.parse(await readFile(run.metadataPath, "utf8"));
    expect(metadata.status).toBe("created");
    expect(metadata.sentryIssueId).toBe("SENTRY-123");
  });
});
```

- [ ] **Step 2: Implement `src/runs/createRun.ts`**

Use `randomUUID()` and write initial metadata immediately:

```ts
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export interface RunContext {
  runId: string;
  runDir: string;
  videoPath: string;
  metadataPath: string;
  codexDir: string;
}

export async function createRun(input: {
  artifactsRoot: string;
  sentryIssueId: string;
  targetAppUrl: string;
}): Promise<RunContext> {
  const runId = randomUUID();
  const runDir = join(input.artifactsRoot, "runs", runId);
  const codexDir = join(runDir, ".codex");
  const videoPath = join(runDir, "browser.mp4");
  const metadataPath = join(runDir, "metadata.json");

  await mkdir(codexDir, { recursive: true });
  await writeFile(
    metadataPath,
    JSON.stringify(
      {
        runId,
        sentryIssueId: input.sentryIssueId,
        targetAppUrl: input.targetAppUrl,
        status: "created",
        videoPath,
      },
      null,
      2,
    ),
  );

  return { runId, runDir, videoPath, metadataPath, codexDir };
}
```

- [ ] **Step 3: Write the failing Codex config overlay test**

Create `tests/codex/config.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { writeCodexConfig } from "../../src/codex/config";

describe("writeCodexConfig", () => {
  it("writes a project-scoped config with chrome-devtools wsEndpoint", async () => {
    const root = await mkdtemp(join(tmpdir(), "codex-config-"));
    const configPath = await writeCodexConfig({
      codexDir: join(root, ".codex"),
      wsEndpoint: "ws://127.0.0.1:9222/devtools/browser/test",
    });

    const text = await readFile(configPath, "utf8");
    expect(text).toContain("[mcp_servers.chrome-devtools]");
    expect(text).toContain("--wsEndpoint=ws://127.0.0.1:9222/devtools/browser/test");
  });
});
```

- [ ] **Step 4: Implement `src/codex/config.ts`**

Write a per-run `.codex/config.toml` overlay:

```ts
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function writeCodexConfig(input: {
  codexDir: string;
  wsEndpoint: string;
}): Promise<string> {
  await mkdir(input.codexDir, { recursive: true });
  const configPath = join(input.codexDir, "config.toml");
  const text = `[mcp_servers.chrome-devtools]
command = "npx"
args = ["chrome-devtools-mcp@latest", "--wsEndpoint=${input.wsEndpoint}"]
`;
  await writeFile(configPath, text);
  return configPath;
}
```

This overlay is intentionally narrow: Chrome DevTools MCP is run-scoped; authenticated Sentry and Linear access still come from the user-level Codex config.

- [ ] **Step 5: Verify**

Run: `pnpm test tests/runs/createRun.test.ts tests/codex/config.test.ts`

Expected: both tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/runs/createRun.ts src/codex/config.ts tests/runs/createRun.test.ts tests/codex/config.test.ts
git commit -m "plan task 2: add run scaffolding and codex config overlay"
```

## Task 3: Launch a dedicated Chrome session for each run

**Files:**
- Create: `src/browser/session.ts`
- Create: `tests/browser/session.test.ts`

- [ ] **Step 1: Write the failing browser session test**

Create `tests/browser/session.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";

const spawnMock = vi.fn();
vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

import { launchChromeSession } from "../../src/browser/session";

describe("launchChromeSession", () => {
  beforeEach(() => {
    spawnMock.mockReset();
  });

  it("spawns chrome with remote debugging and isolated profile args", async () => {
    const proc = new EventEmitter() as unknown as ChildProcess;
    spawnMock.mockReturnValue(proc);

    await launchChromeSession({
      chromePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      userDataDir: "/tmp/run-profile",
      debuggingPort: 9222,
    });

    expect(spawnMock).toHaveBeenCalledWith(
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      expect.arrayContaining([
        "--remote-debugging-port=9222",
        "--user-data-dir=/tmp/run-profile",
        "--no-first-run",
        "--no-default-browser-check",
        "about:blank",
      ]),
      expect.any(Object),
    );
  });
});
```

- [ ] **Step 2: Implement `src/browser/session.ts`**

Use a small return shape:

```ts
import { spawn } from "node:child_process";

export interface ChromeSession {
  process: ReturnType<typeof spawn>;
  debuggingPort: number;
  wsEndpoint: string;
}

export async function launchChromeSession(input: {
  chromePath: string;
  userDataDir: string;
  debuggingPort: number;
}): Promise<ChromeSession> {
  const proc = spawn(
    input.chromePath,
    [
      `--remote-debugging-port=${input.debuggingPort}`,
      `--user-data-dir=${input.userDataDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "about:blank",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );

  return {
    process: proc,
    debuggingPort: input.debuggingPort,
    wsEndpoint: `ws://127.0.0.1:${input.debuggingPort}/devtools/browser`,
  };
}
```

The actual implementation should poll Chrome's `/json/version` endpoint before returning so the `wsEndpoint` is real, not guessed.

- [ ] **Step 3: Verify**

Run: `pnpm test tests/browser/session.test.ts`

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/browser/session.ts tests/browser/session.test.ts
git commit -m "plan task 3: add dedicated chrome session launcher"
```

## Task 4: Add CDP-based full-session browser recording

**Files:**
- Create: `src/browser/record.ts`
- Create: `tests/browser/record.test.ts`

- [ ] **Step 1: Write the failing recorder lifecycle test**

Create `tests/browser/record.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";

const CDPMock = vi.fn();
const spawnMock = vi.fn();

vi.mock("chrome-remote-interface", () => ({ default: (...args: unknown[]) => CDPMock(...args) }));
vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");
  return { ...actual, spawn: (...args: unknown[]) => spawnMock(...args) };
});

import { startBrowserRecording } from "../../src/browser/record";

describe("startBrowserRecording", () => {
  it("starts Page screencast and returns a stop function", async () => {
    const page = { startScreencast: vi.fn(), stopScreencast: vi.fn(), screencastFrameAck: vi.fn() };
    const client = { Page: page, Runtime: { enable: vi.fn() }, close: vi.fn() };
    CDPMock.mockResolvedValue(client);

    const ffmpeg = new EventEmitter() as EventEmitter & { stdin: EventEmitter };
    ffmpeg.stdin = new EventEmitter();
    spawnMock.mockReturnValue(ffmpeg);

    const recording = await startBrowserRecording({
      port: 9222,
      outputPath: "/tmp/browser.mp4",
      ffmpegBin: "/opt/homebrew/bin/ffmpeg",
    });

    expect(page.startScreencast).toHaveBeenCalled();
    expect(typeof recording.stop).toBe("function");
  });
});
```

- [ ] **Step 2: Implement `src/browser/record.ts`**

The concrete implementation should:

- connect to Chrome via `chrome-remote-interface`
- call `Page.startScreencast`
- forward base64 PNG/JPEG frames into `ffmpeg`
- ack each screencast frame
- expose `stop()` that calls `Page.stopScreencast`, ends ffmpeg stdin, and closes the CDP client

Use a shape like:

```ts
export interface BrowserRecording {
  stop(): Promise<void>;
}

export async function startBrowserRecording(input: {
  port: number;
  outputPath: string;
  ffmpegBin: string;
}): Promise<BrowserRecording> {
  // connect CDP, spawn ffmpeg, start screencast, wire frames
}
```

- [ ] **Step 3: Verify**

Run: `pnpm test tests/browser/record.test.ts`

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/browser/record.ts tests/browser/record.test.ts
git commit -m "plan task 4: add cdp browser recorder"
```

## Task 5: Replace the subprocess invoker with a Codex reproducer runner

**Files:**
- Delete: `src/codex/invoke.ts`
- Delete: `tests/codex/invoke.test.ts`
- Create: `src/prompts/reproducer.ts`
- Create: `src/codex/reproducer.ts`
- Create: `tests/prompts/reproducer.test.ts`
- Create: `tests/codex/reproducer.test.ts`

- [ ] **Step 1: Write the failing prompt test**

Create `tests/prompts/reproducer.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildReproducerPrompt } from "../../src/prompts/reproducer";

describe("buildReproducerPrompt", () => {
  it("requires DevTools MCP, localhost target, and Linear ticket creation", () => {
    const prompt = buildReproducerPrompt({
      issue: {
        id: "SENTRY-123",
        title: "TypeError",
        permalink: "https://sentry.io/issues/123/",
        culprit: "checkout.applyCoupon",
        environment: "production",
        release: "app@1.4.2",
      },
      targetAppUrl: "http://localhost:3001",
      videoPath: ".incident-loop-artifacts/runs/abc/browser.mp4",
    });

    expect(prompt).toContain("Chrome DevTools MCP");
    expect(prompt).toContain("http://localhost:3001");
    expect(prompt).toMatch(/create exactly one Linear ticket/i);
    expect(prompt).toMatch(/return JSON only/i);
  });
});
```

- [ ] **Step 2: Implement `src/prompts/reproducer.ts`**

The prompt should explicitly instruct Codex to:

- inspect the issue with Sentry MCP
- drive the browser with Chrome DevTools MCP
- create the Linear ticket itself
- not write repo files or open PRs
- return JSON only following the agreed result schema

- [ ] **Step 3: Write the failing Codex runner test**

Create `tests/codex/reproducer.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";

const runMock = vi.fn();
const codexToolMock = vi.fn(() => ({ name: "codex" }));

vi.mock("@openai/agents", () => ({
  Agent: class Agent { constructor(public opts: unknown) {} },
  run: (...args: unknown[]) => runMock(...args),
}));

vi.mock("@openai/agents-extensions", () => ({
  codexTool: (...args: unknown[]) => codexToolMock(...args),
}));

import { runCodexReproducer } from "../../src/codex/reproducer";

describe("runCodexReproducer", () => {
  it("validates structured JSON output from Codex", async () => {
    runMock.mockResolvedValue({
      finalOutput: JSON.stringify({
        status: "reproduced",
        reproduced: true,
        ticketUrl: "https://linear.app/example/ENG-1",
        summary: "example",
        finalUrl: "http://localhost:3001/checkout",
        steps: ["one"],
        expected: "expected",
        actual: "actual",
        evidence: { videoPath: ".incident-loop-artifacts/runs/abc/browser.mp4", consoleErrors: 1, failedRequests: 0 },
      }),
    });

    const result = await runCodexReproducer({
      prompt: "hello",
      workingDirectory: "/tmp/run",
    });

    expect(result.ticketUrl).toContain("linear.app");
    expect(codexToolMock).toHaveBeenCalled();
  });
});
```

- [ ] **Step 4: Implement `src/codex/reproducer.ts`**

Use the SDK path instead of subprocess spawning. The implementation should:

- define a zod schema for the JSON result
- create a focused agent
- attach the experimental Codex tool
- run the prompt
- parse `result.finalOutput` as JSON

Representative shape:

```ts
import { Agent, run } from "@openai/agents";
import { codexTool } from "@openai/agents-extensions";
import { z } from "zod";

const ReproducerResultSchema = z.object({
  status: z.string(),
  reproduced: z.boolean(),
  ticketUrl: z.string().url(),
  summary: z.string(),
  finalUrl: z.string().url(),
  steps: z.array(z.string()),
  expected: z.string(),
  actual: z.string(),
  evidence: z.object({
    videoPath: z.string(),
    consoleErrors: z.number().int().nonnegative(),
    failedRequests: z.number().int().nonnegative(),
  }),
});

export async function runCodexReproducer(input: {
  prompt: string;
  workingDirectory: string;
}) {
  const agent = new Agent({
    name: "Incident Reproducer",
    instructions: "Delegate the full reproduction task to Codex and return JSON only.",
    tools: [
      codexTool({
        workingDirectory: input.workingDirectory,
        skipGitRepoCheck: true,
        model: "gpt-5.4",
      }),
    ],
  });

  const result = await run(agent, input.prompt);
  return ReproducerResultSchema.parse(JSON.parse(result.finalOutput));
}
```

- [ ] **Step 5: Verify**

Run: `pnpm test tests/prompts/reproducer.test.ts tests/codex/reproducer.test.ts`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/prompts/reproducer.ts src/codex/reproducer.ts tests/prompts/reproducer.test.ts tests/codex/reproducer.test.ts
git rm src/codex/invoke.ts tests/codex/invoke.test.ts
git commit -m "plan task 5: replace subprocess codex runner with sdk reproducer"
```

## Task 6: Add webhook verification and Sentry webhook ingestion

**Files:**
- Create: `src/webhooks/verify.ts`
- Create: `src/webhooks/sentry.ts`
- Create: `tests/webhooks/verify.test.ts`
- Create: `tests/webhooks/sentry.test.ts`
- Modify: `src/server.ts`

- [ ] **Step 1: Add the failing verify helper test**

Reuse the same HMAC contract as the old plan:

```ts
import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { verifyHmacSha256 } from "../../src/webhooks/verify";

function sign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

describe("verifyHmacSha256", () => {
  it("returns true for a valid signature", () => {
    expect(verifyHmacSha256({ body: '{"ok":true}', signature: sign('{"ok":true}', "topsecret"), secret: "topsecret" })).toBe(true);
  });
});
```

- [ ] **Step 2: Implement `src/webhooks/verify.ts`**

Use the existing HMAC implementation from the old plan.

- [ ] **Step 3: Add the failing Sentry webhook test**

Create `tests/webhooks/sentry.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHmac } from "node:crypto";
import { Hono } from "hono";

const sendMock = vi.fn();
vi.mock("../../src/inngest/client", () => ({
  inngest: { send: (...args: unknown[]) => sendMock(...args) },
}));

import { mountSentryWebhook } from "../../src/webhooks/sentry";

function sign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

describe("mountSentryWebhook", () => {
  beforeEach(() => {
    sendMock.mockReset();
    process.env.INNGEST_EVENT_KEY = "x";
    process.env.INNGEST_SIGNING_KEY = "x";
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.TARGET_APP_URL = "http://localhost:3001";
    process.env.SENTRY_WEBHOOK_SECRET = "test-secret";
    process.env.LINEAR_API_KEY = "lin-api";
  });

  it("emits sentry/issue.created when signature and payload are valid", async () => {
    const body = JSON.stringify({
      action: "created",
      data: { issue: { id: "SENTRY-999", title: "TypeError", web_url: "https://sentry.io/issues/999/", culprit: "checkout" } },
    });
    const app = new Hono();
    mountSentryWebhook(app);

    const res = await app.request("/webhooks/sentry", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "sentry-hook-resource": "issue",
        "sentry-hook-signature": sign(body, "test-secret"),
      },
      body,
    });

    expect(res.status).toBe(202);
    expect(sendMock).toHaveBeenCalledWith({
      name: "sentry/issue.created",
      data: expect.objectContaining({ issue: expect.objectContaining({ id: "SENTRY-999" }) }),
    });
  });
});
```

- [ ] **Step 4: Implement `src/webhooks/sentry.ts` and mount it in `src/server.ts`**

Use the same route shape as the old plan, but make sure the tests use the new env variables.

- [ ] **Step 5: Verify**

Run: `pnpm test tests/webhooks/verify.test.ts tests/webhooks/sentry.test.ts tests/server.test.ts`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/webhooks/verify.ts src/webhooks/sentry.ts tests/webhooks/verify.test.ts tests/webhooks/sentry.test.ts src/server.ts
git commit -m "plan task 6: add sentry webhook ingestion"
```

## Task 7: Coordinate the full repro run in `onSentryIssue`

**Files:**
- Create: `src/inngest/functions/onSentryIssue.ts`
- Modify: `src/inngest/index.ts`
- Create: `tests/inngest/onSentryIssue.test.ts`

- [ ] **Step 1: Write the failing coordinator test**

Create `tests/inngest/onSentryIssue.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";

vi.mock("../../src/runs/createRun", () => ({
  createRun: vi.fn().mockResolvedValue({
    runId: "run-1",
    runDir: "/tmp/run-1",
    codexDir: "/tmp/run-1/.codex",
    videoPath: "/tmp/run-1/browser.mp4",
    metadataPath: "/tmp/run-1/metadata.json",
  }),
}));

vi.mock("../../src/browser/session", () => ({
  launchChromeSession: vi.fn().mockResolvedValue({
    process: { kill: vi.fn() },
    debuggingPort: 9222,
    wsEndpoint: "ws://127.0.0.1:9222/devtools/browser/test",
  }),
}));

vi.mock("../../src/browser/record", () => ({
  startBrowserRecording: vi.fn().mockResolvedValue({
    stop: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock("../../src/codex/config", () => ({
  writeCodexConfig: vi.fn().mockResolvedValue("/tmp/run-1/.codex/config.toml"),
}));

vi.mock("../../src/codex/reproducer", () => ({
  runCodexReproducer: vi.fn().mockResolvedValue({
    status: "reproduced",
    reproduced: true,
    ticketUrl: "https://linear.app/example/ENG-1",
    summary: "example",
    finalUrl: "http://localhost:3001/checkout",
    steps: ["one"],
    expected: "expected",
    actual: "actual",
    evidence: { videoPath: "/tmp/run-1/browser.mp4", consoleErrors: 1, failedRequests: 0 },
  }),
}));

import { onSentryIssue } from "../../src/inngest/functions/onSentryIssue";
import { functions } from "../../src/inngest";

describe("onSentryIssue", () => {
  it("is registered in the barrel", () => {
    expect(functions).toContain(onSentryIssue);
  });
});
```

- [ ] **Step 2: Implement `src/inngest/functions/onSentryIssue.ts`**

The flow inside the function should be:

```ts
const run = await step.run("create-run", () => createRun(...));
const chrome = await step.run("launch-chrome", () => launchChromeSession(...));
await step.run("write-codex-config", () => writeCodexConfig(...));
const recording = await startBrowserRecording(...);

try {
  return await step.run("run-codex", () => runCodexReproducer(...));
} finally {
  await recording.stop();
}
```

After stopping recording, update `metadata.json` with:

- run status
- ticket URL
- final URL
- saved video path

- [ ] **Step 3: Register the function**

Update `src/inngest/index.ts`:

```ts
import { ping } from "./functions/ping";
import { onSentryIssue } from "./functions/onSentryIssue";

export const functions = [ping, onSentryIssue] as const;
```

- [ ] **Step 4: Verify**

Run: `pnpm test tests/inngest/onSentryIssue.test.ts tests/inngest/ping.test.ts && pnpm typecheck`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/inngest/functions/onSentryIssue.ts src/inngest/index.ts tests/inngest/onSentryIssue.test.ts
git commit -m "plan task 7: coordinate localhost repro runs in inngest"
```

## Task 8: Update docs and manual end-to-end verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update local dev instructions**

Revise `README.md` to document:

- target app must already be running on localhost
- Codex must have authenticated Sentry and Linear MCP access in the user-level config
- the run writes artifacts to `.incident-loop-artifacts/runs/<runId>/`
- the run-specific `.codex/config.toml` only adds the Chrome DevTools MCP binding

- [ ] **Step 2: Add the manual repro walkthrough**

Document:

```bash
pnpm install
cp .env.example .env
npx inngest-cli@latest dev
pnpm dev
```

Then send a fake webhook:

```bash
BODY='{"action":"created","data":{"issue":{"id":"SENTRY-TEST-1","title":"TypeError","web_url":"https://sentry.io/issues/test/","culprit":"checkout.applyCoupon","environment":"staging","release":"app@0.0.1"}}}'
SIG=$(node -e "process.stdout.write(require('crypto').createHmac('sha256',process.env.S).update(process.env.B).digest('hex'))" S="<your secret>" B="$BODY")
curl -X POST http://localhost:3000/webhooks/sentry \
  -H "content-type: application/json" \
  -H "sentry-hook-resource: issue" \
  -H "sentry-hook-signature: $SIG" \
  -d "$BODY"
```

Expected manual checks:

- Inngest receives `sentry/issue.created`
- a run directory is created under `.incident-loop-artifacts/runs/<runId>/`
- `browser.mp4` exists
- `metadata.json` contains the Linear ticket URL

- [ ] **Step 3: Verify**

Run: `pnpm test && pnpm typecheck`

Expected: all tests pass and typecheck is clean.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "plan task 8: document localhost demo flow"
```

## Done Criteria

- [ ] `CODEX_BIN` and browser-use assumptions are gone from the code path
- [ ] localhost demo env vars are validated
- [ ] each run creates a stable artifact directory
- [ ] each run launches a dedicated Chrome instance
- [ ] each run attempts to save a full browser video to disk
- [ ] Codex creates the Linear ticket itself
- [ ] `on-sentry-issue` coordinates the run lifecycle and persists metadata
- [ ] manual E2E produces a saved `browser.mp4`
