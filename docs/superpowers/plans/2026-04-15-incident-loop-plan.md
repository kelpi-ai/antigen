# Incident Loop — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-04-15-incident-loop-design.md`

**Goal:** Ship the incident loop in four phases. P0 is foundation. P1–P3 add the three flows from the spec. Each phase ships working software on its own and can be reviewed independently.

| Phase | Ships | Depends on |
|---|---|---|
| **P0 — Foundation** | Deployable Inngest orchestrator with ping + Codex invoker | nothing |
| **P1 — Reproducer (Flow 1)** | Sentry webhook → reproduction → Linear ticket with structured scenario | P0 |
| **P2 — Fixer (Flow 2)** | Linear ticket.created → draft PR with red-green test + fix | P0, P1 |
| **P3 — Hunter (Flow 3)** | PR ready-for-review → incident-aware regression hunt with fan-out | P0, P1 |

**Tech Stack:** TypeScript 5.x, Node 20+, pnpm, Inngest SDK, Hono, zod, vitest, tsx. The Codex CLI (`codex exec --full-auto`) is invoked as a subprocess and does the actual reasoning via its MCP tools (Sentry, Linear, GitHub, browser-use). Node code handles orchestration, prompt building, event plumbing, and concurrency keys.

**Non-goals:** deployment to Inngest Cloud, CI pipelines beyond the existing Playwright suite, observability dashboards. Everything runs locally against the Inngest dev server for v1.

---

# P0 — Foundation

**Goal:** A deployable Inngest orchestrator in TypeScript that can receive events, invoke the Codex CLI as a subprocess, and expose a local dev endpoint. The foundation every later phase imports from.

## P0 File Structure

```
package.json                    # dependencies + scripts
tsconfig.json                   # strict TS config
vitest.config.ts                # test runner config
.env.example                    # documented env vars
.gitignore                      # node_modules, .env, dist
README.md                       # local dev instructions

src/
  config/env.ts                 # zod-validated env loader (single source of truth)
  codex/invoke.ts               # wraps `codex exec --full-auto` as a subprocess
  inngest/
    client.ts                   # Inngest client singleton
    functions/ping.ts           # hello-world Inngest function
    index.ts                    # re-exports all functions for server registration
  server.ts                     # Hono server exposing /api/inngest

tests/
  config/env.test.ts
  codex/invoke.test.ts
  inngest/ping.test.ts
  server.test.ts
  smoke.test.ts
```

**Responsibilities**
- `src/config/env.ts` — only place that reads `process.env`. Exports a typed `env` object.
- `src/codex/invoke.ts` — only place that spawns subprocesses. `invokeCodex(prompt, opts): Promise<CodexResult>`.
- `src/inngest/client.ts` — singleton `inngest` client used by every function.
- `src/inngest/functions/*.ts` — one file per function.
- `src/inngest/index.ts` — barrel re-exporting all functions as an array for `serve()`.
- `src/server.ts` — Hono app mounting Inngest at `/api/inngest`. No business logic.

## P0 Task 1 — Project scaffold + smoke test

**Files:** Create `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `tests/smoke.test.ts`.

- [ ] **Step 1: Create `tests/smoke.test.ts`**

```ts
import { describe, it, expect } from "vitest";

describe("smoke", () => {
  it("runs the test runner", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 2: Create `package.json`**

```json
{
  "name": "incident-loop",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "hono": "^4.6.0",
    "@hono/node-server": "^1.13.0",
    "inngest": "^3.27.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  },
  "packageManager": "pnpm@9.0.0"
}
```

- [ ] **Step 3: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "types": ["node", "vitest/globals"]
  },
  "include": ["src/**/*", "tests/**/*"]
}
```

- [ ] **Step 4: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
```

- [ ] **Step 5: Create `.gitignore`**

```
node_modules
dist
.env
.env.local
*.log
.DS_Store
```

- [ ] **Step 6: Install and verify**

Run: `pnpm install && pnpm test && pnpm typecheck`
Expected: install succeeds, smoke test passes, typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add package.json tsconfig.json vitest.config.ts .gitignore tests/smoke.test.ts pnpm-lock.yaml
git commit -m "P0 task 1: project scaffold with vitest smoke test"
```

## P0 Task 2 — Typed env loader

**Files:** Create `src/config/env.ts`, `tests/config/env.test.ts`, `.env.example`.

- [ ] **Step 1: Write the failing test**

Create `tests/config/env.test.ts`:

```ts
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
```

- [ ] **Step 2: Verify failing**

Run: `pnpm test tests/config/env.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/config/env.ts`**

```ts
import { z } from "zod";

const EnvSchema = z.object({
  INNGEST_EVENT_KEY: z.string().min(1),
  INNGEST_SIGNING_KEY: z.string().min(1),
  CODEX_BIN: z.string().min(1),
  PORT: z.coerce.number().int().positive().default(3000),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(): Env {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const missing = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(`Invalid environment: ${missing}`);
  }
  return parsed.data;
}

export const env = new Proxy({} as Env, {
  get(_t, prop) {
    return loadEnv()[prop as keyof Env];
  },
});
```

- [ ] **Step 4: Create `.env.example`**

```
INNGEST_EVENT_KEY=
INNGEST_SIGNING_KEY=
CODEX_BIN=/usr/local/bin/codex
PORT=3000
```

- [ ] **Step 5: Verify passing**

Run: `pnpm test tests/config/env.test.ts`
Expected: 3 passed.

- [ ] **Step 6: Commit**

```bash
git add src/config/env.ts tests/config/env.test.ts .env.example
git commit -m "P0 task 2: zod-validated env loader"
```

## P0 Task 3 — Inngest client singleton

**Files:** Create `src/inngest/client.ts`, `tests/inngest/client.test.ts`.

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect } from "vitest";
import { inngest } from "../../src/inngest/client";

describe("inngest client", () => {
  it("exports a singleton with the expected id", () => {
    expect(inngest).toBeDefined();
    expect(inngest.id).toBe("incident-loop");
  });
});
```

- [ ] **Step 2: Implement `src/inngest/client.ts`**

```ts
import { Inngest } from "inngest";

export const inngest = new Inngest({ id: "incident-loop" });
```

- [ ] **Step 3: Verify + commit**

```bash
pnpm test tests/inngest/client.test.ts
git add src/inngest/client.ts tests/inngest/client.test.ts
git commit -m "P0 task 3: Inngest client singleton"
```

## P0 Task 4 — Ping Inngest function

**Files:** Create `src/inngest/functions/ping.ts`, `src/inngest/index.ts`, `tests/inngest/ping.test.ts`.

- [ ] **Step 1: Write failing test**

```ts
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
```

- [ ] **Step 2: Implement `src/inngest/functions/ping.ts`**

```ts
import { inngest } from "../client";

export const ping = inngest.createFunction(
  { id: "ping" },
  { event: "test/ping" },
  async ({ event, step }) => {
    await step.run("log", () => {
      console.log("ping received", event.data);
      return { ok: true, receivedAt: new Date().toISOString() };
    });
    return { status: "pong" };
  },
);
```

- [ ] **Step 3: Implement `src/inngest/index.ts`**

```ts
import { ping } from "./functions/ping";

export const functions = [ping] as const;
```

- [ ] **Step 4: Verify + commit**

```bash
pnpm test tests/inngest/ping.test.ts
git add src/inngest/functions/ping.ts src/inngest/index.ts tests/inngest/ping.test.ts
git commit -m "P0 task 4: ping Inngest function"
```

## P0 Task 5 — Codex subprocess invoker

The single integration point every later flow uses to run reasoning + MCP tools.

**Files:** Create `src/codex/invoke.ts`, `tests/codex/invoke.test.ts`.

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";

const spawnMock = vi.fn();
vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

import { invokeCodex } from "../../src/codex/invoke";

function fakeProc(opts: { stdout?: string; stderr?: string; exitCode: number }): ChildProcess {
  const proc = new EventEmitter() as unknown as ChildProcess;
  (proc as unknown as { stdout: EventEmitter }).stdout = new EventEmitter();
  (proc as unknown as { stderr: EventEmitter }).stderr = new EventEmitter();
  setImmediate(() => {
    if (opts.stdout) (proc as any).stdout.emit("data", Buffer.from(opts.stdout));
    if (opts.stderr) (proc as any).stderr.emit("data", Buffer.from(opts.stderr));
    proc.emit("close", opts.exitCode);
  });
  return proc;
}

describe("invokeCodex", () => {
  beforeEach(() => {
    spawnMock.mockReset();
    process.env.CODEX_BIN = "/usr/local/bin/codex";
    process.env.INNGEST_EVENT_KEY = "x";
    process.env.INNGEST_SIGNING_KEY = "x";
  });

  it("spawns codex with --full-auto and the prompt", async () => {
    spawnMock.mockReturnValue(fakeProc({ stdout: "done", exitCode: 0 }));
    await invokeCodex("reproduce issue 123");
    expect(spawnMock).toHaveBeenCalledWith(
      "/usr/local/bin/codex",
      ["exec", "--full-auto", "reproduce issue 123"],
      expect.objectContaining({ stdio: ["ignore", "pipe", "pipe"] }),
    );
  });

  it("resolves with stdout on exit 0", async () => {
    spawnMock.mockReturnValue(fakeProc({ stdout: "ok-output", exitCode: 0 }));
    const result = await invokeCodex("hello");
    expect(result.stdout).toBe("ok-output");
    expect(result.exitCode).toBe(0);
  });

  it("rejects with stderr on non-zero exit", async () => {
    spawnMock.mockReturnValue(fakeProc({ stderr: "boom", exitCode: 1 }));
    await expect(invokeCodex("hello")).rejects.toThrow(/codex exited 1.*boom/);
  });
});
```

- [ ] **Step 2: Implement `src/codex/invoke.ts`**

```ts
import { spawn } from "node:child_process";
import { env } from "../config/env";

export interface CodexResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface InvokeOpts {
  cwd?: string;
  timeoutMs?: number;
}

export function invokeCodex(prompt: string, opts: InvokeOpts = {}): Promise<CodexResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      env.CODEX_BIN,
      ["exec", "--full-auto", prompt],
      { stdio: ["ignore", "pipe", "pipe"], cwd: opts.cwd },
    );

    let stdout = "";
    let stderr = "";
    proc.stdout?.on("data", (c: Buffer) => { stdout += c.toString(); });
    proc.stderr?.on("data", (c: Buffer) => { stderr += c.toString(); });

    const timeout = opts.timeoutMs
      ? setTimeout(() => {
          proc.kill("SIGKILL");
          reject(new Error(`codex timed out after ${opts.timeoutMs}ms`));
        }, opts.timeoutMs)
      : null;

    proc.on("close", (code) => {
      if (timeout) clearTimeout(timeout);
      const exitCode = code ?? 0;
      if (exitCode === 0) {
        resolve({ stdout, stderr, exitCode });
      } else {
        reject(new Error(`codex exited ${exitCode}: ${stderr.trim() || "no stderr"}`));
      }
    });

    proc.on("error", (err) => {
      if (timeout) clearTimeout(timeout);
      reject(err);
    });
  });
}
```

- [ ] **Step 3: Verify + commit**

```bash
pnpm test tests/codex/invoke.test.ts
git add src/codex/invoke.ts tests/codex/invoke.test.ts
git commit -m "P0 task 5: codex subprocess invoker with timeout + error handling"
```

## P0 Task 6 — Hono server

**Files:** Create `src/server.ts`, `tests/server.test.ts`.

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { buildApp } from "../src/server";

describe("server", () => {
  beforeEach(() => {
    process.env.INNGEST_EVENT_KEY = "test";
    process.env.INNGEST_SIGNING_KEY = "test";
    process.env.CODEX_BIN = "/usr/local/bin/codex";
  });

  it("responds 200 on GET /health", async () => {
    const app = buildApp();
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
```

- [ ] **Step 2: Implement `src/server.ts`**

```ts
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { serve as inngestServe } from "inngest/hono";
import { inngest } from "./inngest/client";
import { functions } from "./inngest";
import { env } from "./config/env";

export function buildApp(): Hono {
  const app = new Hono();
  app.get("/health", (c) => c.json({ ok: true }));
  app.on(
    ["GET", "POST", "PUT"],
    "/api/inngest",
    inngestServe({ client: inngest, functions: [...functions] }),
  );
  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const app = buildApp();
  serve({ fetch: app.fetch, port: env.PORT }, (info) => {
    console.log(`Server on http://localhost:${info.port}`);
    console.log(`Inngest: http://localhost:${info.port}/api/inngest`);
  });
}
```

- [ ] **Step 3: Verify + commit**

```bash
pnpm test && pnpm typecheck
git add src/server.ts tests/server.test.ts
git commit -m "P0 task 6: Hono server with /health and Inngest mount"
```

## P0 Task 7 — Manual end-to-end + README

- [ ] **Step 1:** `cp .env.example .env` and fill in values (any non-empty strings work for dev).
- [ ] **Step 2:** Terminal A: `npx inngest-cli@latest dev`.
- [ ] **Step 3:** Terminal B: `pnpm dev`. Expect server listening on 3000.
- [ ] **Step 4:** Open http://localhost:8288. Confirm `ping` appears under Functions.
- [ ] **Step 5:** Send event `{"name":"test/ping","data":{"hello":"world"}}` from the dev UI. Expect run succeeds, output `{status:"pong"}`.
- [ ] **Step 6:** Create `README.md`:

```markdown
# incident-loop

Orchestrator for the Sentry → Linear → PR incident loop. See
`docs/superpowers/specs/2026-04-15-incident-loop-design.md`.

## Local dev
1. `pnpm install`
2. `cp .env.example .env` and fill in
3. Terminal A: `npx inngest-cli@latest dev`
4. Terminal B: `pnpm dev`
5. Open http://localhost:8288 and send `test/ping`

## Commands
- `pnpm test` — unit tests
- `pnpm typecheck` — TypeScript check
- `pnpm dev` — run the server
```

- [ ] **Step 7: Commit**

```bash
git add README.md
git commit -m "P0 task 7: README with local dev instructions"
```

## P0 Done Criteria

- [ ] `pnpm test` all green
- [ ] `pnpm typecheck` clean
- [ ] Ping function visible in Inngest dev UI
- [ ] `test/ping` event runs end-to-end

---

# P1 — Reproducer (Flow 1)

**Goal:** Sentry webhook → Codex reproduces via browser-use → Linear ticket with structured scenario. No test commits (that's P2).

**Architecture:** A Sentry webhook hits `/webhooks/sentry`, signature-verified, emits `sentry/issue.created` Inngest event. The `on-sentry-issue` function builds a reproduction prompt and hands it to `invokeCodex`. Codex uses its MCP tools to fetch context, drive reproduction, and file the Linear ticket. Node code only handles the prompt template and orchestration.

## P1 File Structure (additions)

```
src/
  webhooks/
    sentry.ts                   # Sentry webhook handler
    verify.ts                   # HMAC helper (reused by P2 + P3)
  prompts/
    reproducer.ts               # pure: (SentryIssue) => prompt
  inngest/functions/
    onSentryIssue.ts            # event → invokeCodex

tests/
  webhooks/{sentry,verify}.test.ts
  prompts/reproducer.test.ts
  inngest/onSentryIssue.test.ts
```

**Modified:** `src/config/env.ts` (+3 vars), `src/inngest/index.ts` (add function), `src/server.ts` (mount webhook), `.env.example`.

## P1 Task 1 — Extend env schema

**Files:** Modify `src/config/env.ts`, `tests/config/env.test.ts`, `.env.example`.

- [ ] **Step 1: Add failing test** (append to existing `describe` in `tests/config/env.test.ts`):

```ts
it("parses Sentry, Linear, browser-use vars", () => {
  process.env.INNGEST_EVENT_KEY = "x";
  process.env.INNGEST_SIGNING_KEY = "x";
  process.env.CODEX_BIN = "/usr/local/bin/codex";
  process.env.SENTRY_WEBHOOK_SECRET = "sentry-secret";
  process.env.LINEAR_API_KEY = "lin_api_xxx";
  process.env.BROWSER_USE_API_KEY = "bu_xxx";

  const env = loadEnv();
  expect(env.SENTRY_WEBHOOK_SECRET).toBe("sentry-secret");
  expect(env.LINEAR_API_KEY).toBe("lin_api_xxx");
  expect(env.BROWSER_USE_API_KEY).toBe("bu_xxx");
});
```

- [ ] **Step 2: Extend `EnvSchema` in `src/config/env.ts`**

```ts
const EnvSchema = z.object({
  INNGEST_EVENT_KEY: z.string().min(1),
  INNGEST_SIGNING_KEY: z.string().min(1),
  CODEX_BIN: z.string().min(1),
  PORT: z.coerce.number().int().positive().default(3000),
  SENTRY_WEBHOOK_SECRET: z.string().min(1),
  LINEAR_API_KEY: z.string().min(1),
  BROWSER_USE_API_KEY: z.string().min(1),
});
```

- [ ] **Step 3: Append to `.env.example`**

```
SENTRY_WEBHOOK_SECRET=
LINEAR_API_KEY=
BROWSER_USE_API_KEY=
```

- [ ] **Step 4: Verify + commit**

```bash
pnpm test tests/config/env.test.ts
git add src/config/env.ts tests/config/env.test.ts .env.example
git commit -m "P1 task 1: extend env for Sentry, Linear, browser-use"
```

## P1 Task 2 — HMAC signature verification helper

**Files:** Create `src/webhooks/verify.ts`, `tests/webhooks/verify.test.ts`.

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { verifyHmacSha256 } from "../../src/webhooks/verify";

function sign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

describe("verifyHmacSha256", () => {
  const secret = "topsecret";
  const body = '{"hello":"world"}';

  it("returns true for a valid signature", () => {
    expect(verifyHmacSha256({ body, signature: sign(body, secret), secret })).toBe(true);
  });

  it("accepts a 'sha256=' prefix", () => {
    const sig = `sha256=${sign(body, secret)}`;
    expect(verifyHmacSha256({ body, signature: sig, secret })).toBe(true);
  });

  it("returns false for a wrong signature", () => {
    expect(verifyHmacSha256({ body, signature: "deadbeef", secret })).toBe(false);
  });

  it("returns false for a tampered body", () => {
    expect(verifyHmacSha256({
      body: body + "x", signature: sign(body, secret), secret,
    })).toBe(false);
  });
});
```

- [ ] **Step 2: Implement `src/webhooks/verify.ts`**

```ts
import { createHmac, timingSafeEqual } from "node:crypto";

export interface VerifyInput {
  body: string;
  signature: string;
  secret: string;
}

export function verifyHmacSha256({ body, signature, secret }: VerifyInput): boolean {
  const stripped = signature.startsWith("sha256=")
    ? signature.slice("sha256=".length)
    : signature;
  const expected = createHmac("sha256", secret).update(body).digest("hex");
  if (stripped.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(stripped, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}
```

- [ ] **Step 3: Verify + commit**

```bash
pnpm test tests/webhooks/verify.test.ts
git add src/webhooks/verify.ts tests/webhooks/verify.test.ts
git commit -m "P1 task 2: HMAC-SHA256 signature verifier"
```

## P1 Task 3 — Reproducer prompt builder

**Files:** Create `src/prompts/reproducer.ts`, `tests/prompts/reproducer.test.ts`.

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect } from "vitest";
import { buildReproducerPrompt } from "../../src/prompts/reproducer";

describe("buildReproducerPrompt", () => {
  const issue = {
    id: "SENTRY-123",
    title: "TypeError",
    permalink: "https://sentry.io/issues/123/",
    culprit: "checkout.applyCoupon",
    environment: "production",
    release: "app@1.4.2",
  };

  it("includes the Sentry issue id + permalink", () => {
    const p = buildReproducerPrompt(issue);
    expect(p).toContain("SENTRY-123");
    expect(p).toContain(issue.permalink);
  });

  it("forbids committing tests", () => {
    const p = buildReproducerPrompt(issue);
    expect(p).toMatch(/do not.*commit.*test/i);
  });

  it("requests a structured scenario format", () => {
    const p = buildReproducerPrompt(issue);
    expect(p).toMatch(/steps/i);
    expect(p).toMatch(/expected/i);
    expect(p).toMatch(/actual/i);
  });

  it("mentions browser-use for reproduction", () => {
    expect(buildReproducerPrompt(issue)).toMatch(/browser-use/i);
  });
});
```

- [ ] **Step 2: Implement `src/prompts/reproducer.ts`**

```ts
export interface SentryIssue {
  id: string;
  title: string;
  permalink: string;
  culprit: string;
  environment: string;
  release: string;
}

export function buildReproducerPrompt(issue: SentryIssue): string {
  return `You are the Incident Reproducer for the incident-loop system.

A new Sentry issue has fired. Your job is to reproduce it and file a Linear ticket with a structured scenario. You MUST NOT commit any test files — that is the Fixer's job.

## Sentry issue
- ID: ${issue.id}
- Title: ${issue.title}
- Permalink: ${issue.permalink}
- Culprit: ${issue.culprit}
- Environment: ${issue.environment}
- Release: ${issue.release}

## MCP tools
- Sentry MCP: fetch trace, breadcrumbs, user context
- browser-use MCP: drive a real browser on staging
- Linear MCP: create the ticket

## Procedure
1. Fetch full issue context via Sentry MCP (breadcrumbs, stack trace, tags).
2. Form a hypothesis about user actions that trigger the bug.
3. Drive browser-use on staging. Capture session replay URL.
4. If reproduced, file a Linear ticket with this structured body:
   - **Summary:** one sentence
   - **Sentry issue ID:** ${issue.id}
   - **Sentry permalink:** ${issue.permalink}
   - **Reproduction steps:** numbered list with selectors/URLs/inputs
   - **Expected behavior:** what should have happened
   - **Actual behavior:** what actually happened (with the error)
   - **Session replay:** browser-use replay URL
   - **Error signature:** sha256 of "\${route}:\${errorClass}:\${topStackFrame}"
   Label with \`bug\` and \`source:reproducer\`.
5. If not reproduced, file with label \`needs-human-repro\` and everything you tried.

## Hard constraints
- Do NOT commit any files to the repo.
- Do NOT open any PRs.
- Do NOT write any test code.
- Output one Linear ticket. Nothing else.

When done, print: REPRODUCER_DONE <linear_ticket_url>
`;
}
```

- [ ] **Step 3: Verify + commit**

```bash
pnpm test tests/prompts/reproducer.test.ts
git add src/prompts/reproducer.ts tests/prompts/reproducer.test.ts
git commit -m "P1 task 3: reproducer prompt builder"
```

## P1 Task 4 — Sentry webhook endpoint

**Files:** Create `src/webhooks/sentry.ts`, `tests/webhooks/sentry.test.ts`, modify `src/server.ts`.

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHmac } from "node:crypto";
import { Hono } from "hono";

const sendMock = vi.fn();
vi.mock("../../src/inngest/client", () => ({
  inngest: { send: (...a: unknown[]) => sendMock(...a) },
}));

import { mountSentryWebhook } from "../../src/webhooks/sentry";

function sign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

describe("POST /webhooks/sentry", () => {
  const secret = "test-sentry-secret";
  const issueBody = JSON.stringify({
    action: "created",
    data: { issue: { id: "SENTRY-999", title: "TypeError", web_url: "https://sentry.io/issues/999/", culprit: "checkout" } },
  });

  beforeEach(() => {
    sendMock.mockReset();
    process.env.INNGEST_EVENT_KEY = "x";
    process.env.INNGEST_SIGNING_KEY = "x";
    process.env.CODEX_BIN = "/usr/local/bin/codex";
    process.env.SENTRY_WEBHOOK_SECRET = secret;
    process.env.LINEAR_API_KEY = "x";
    process.env.BROWSER_USE_API_KEY = "x";
  });

  it("rejects bad signatures", async () => {
    const app = new Hono();
    mountSentryWebhook(app);
    const res = await app.request("/webhooks/sentry", {
      method: "POST",
      headers: { "content-type": "application/json", "sentry-hook-signature": "deadbeef", "sentry-hook-resource": "issue" },
      body: issueBody,
    });
    expect(res.status).toBe(401);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("emits Inngest event on valid issue.created", async () => {
    const app = new Hono();
    mountSentryWebhook(app);
    const res = await app.request("/webhooks/sentry", {
      method: "POST",
      headers: { "content-type": "application/json", "sentry-hook-signature": sign(issueBody, secret), "sentry-hook-resource": "issue" },
      body: issueBody,
    });
    expect(res.status).toBe(202);
    expect(sendMock).toHaveBeenCalledWith({
      name: "sentry/issue.created",
      data: expect.objectContaining({ issue: expect.objectContaining({ id: "SENTRY-999" }) }),
    });
  });

  it("ignores non-issue resources", async () => {
    const app = new Hono();
    mountSentryWebhook(app);
    const body = JSON.stringify({ action: "created", data: {} });
    const res = await app.request("/webhooks/sentry", {
      method: "POST",
      headers: { "content-type": "application/json", "sentry-hook-signature": sign(body, secret), "sentry-hook-resource": "event_alert" },
      body,
    });
    expect(res.status).toBe(204);
    expect(sendMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Implement `src/webhooks/sentry.ts`**

```ts
import type { Hono } from "hono";
import { env } from "../config/env";
import { inngest } from "../inngest/client";
import { verifyHmacSha256 } from "./verify";

export function mountSentryWebhook(app: Hono): void {
  app.post("/webhooks/sentry", async (c) => {
    const signature = c.req.header("sentry-hook-signature") ?? "";
    const resource = c.req.header("sentry-hook-resource") ?? "";
    const body = await c.req.text();

    if (!verifyHmacSha256({ body, signature, secret: env.SENTRY_WEBHOOK_SECRET })) {
      return c.json({ error: "invalid signature" }, 401);
    }

    if (resource !== "issue") return c.body(null, 204);

    const parsed = JSON.parse(body) as { action: string; data: { issue: Record<string, unknown> } };
    if (parsed.action !== "created") return c.body(null, 204);

    await inngest.send({
      name: "sentry/issue.created",
      data: { issue: parsed.data.issue },
    });

    return c.json({ accepted: true }, 202);
  });
}
```

- [ ] **Step 3: Mount in `src/server.ts`**

Add import at top:
```ts
import { mountSentryWebhook } from "./webhooks/sentry";
```
Add inside `buildApp` before `return app`:
```ts
mountSentryWebhook(app);
```

- [ ] **Step 4: Verify + commit**

```bash
pnpm test tests/webhooks/sentry.test.ts tests/server.test.ts
git add src/webhooks/sentry.ts tests/webhooks/sentry.test.ts src/server.ts
git commit -m "P1 task 4: Sentry webhook endpoint"
```

## P1 Task 5 — `on-sentry-issue` Inngest function

**Files:** Create `src/inngest/functions/onSentryIssue.ts`, `tests/inngest/onSentryIssue.test.ts`, modify `src/inngest/index.ts`.

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/codex/invoke", () => ({
  invokeCodex: vi.fn(),
}));

import { onSentryIssue } from "../../src/inngest/functions/onSentryIssue";
import { functions } from "../../src/inngest";

describe("onSentryIssue", () => {
  beforeEach(() => {
    process.env.INNGEST_EVENT_KEY = "x";
    process.env.INNGEST_SIGNING_KEY = "x";
    process.env.CODEX_BIN = "/usr/local/bin/codex";
    process.env.SENTRY_WEBHOOK_SECRET = "x";
    process.env.LINEAR_API_KEY = "x";
    process.env.BROWSER_USE_API_KEY = "x";
  });

  it("has id 'on-sentry-issue'", () => {
    expect(onSentryIssue.id()).toBe("on-sentry-issue");
  });

  it("is registered in the barrel", () => {
    expect(functions).toContain(onSentryIssue);
  });
});
```

- [ ] **Step 2: Implement `src/inngest/functions/onSentryIssue.ts`**

```ts
import { inngest } from "../client";
import { invokeCodex } from "../../codex/invoke";
import { buildReproducerPrompt, type SentryIssue } from "../../prompts/reproducer";

interface SentryIssueEvent {
  data: {
    issue: {
      id: string;
      title: string;
      web_url: string;
      culprit: string;
      environment?: string;
      release?: string;
    };
  };
}

export const onSentryIssue = inngest.createFunction(
  { id: "on-sentry-issue", concurrency: { limit: 5 }, retries: 2 },
  { event: "sentry/issue.created" },
  async ({ event, step }) => {
    const raw = (event as unknown as SentryIssueEvent).data.issue;
    const issue: SentryIssue = {
      id: raw.id,
      title: raw.title,
      permalink: raw.web_url,
      culprit: raw.culprit,
      environment: raw.environment ?? "production",
      release: raw.release ?? "unknown",
    };

    const prompt = await step.run("build-prompt", () => buildReproducerPrompt(issue));

    const result = await step.run("invoke-codex", async () => {
      const { stdout } = await invokeCodex(prompt, { timeoutMs: 15 * 60 * 1000 });
      return { stdout };
    });

    const ticketUrlMatch = result.stdout.match(/REPRODUCER_DONE\s+(\S+)/);
    return {
      ticketUrl: ticketUrlMatch?.[1] ?? null,
      status: ticketUrlMatch ? "ok" : "no-ticket-url",
    };
  },
);
```

- [ ] **Step 3: Register in `src/inngest/index.ts`**

```ts
import { ping } from "./functions/ping";
import { onSentryIssue } from "./functions/onSentryIssue";

export const functions = [ping, onSentryIssue] as const;
```

- [ ] **Step 4: Verify + commit**

```bash
pnpm test && pnpm typecheck
git add src/inngest/functions/onSentryIssue.ts src/inngest/index.ts tests/inngest/onSentryIssue.test.ts
git commit -m "P1 task 5: on-sentry-issue Inngest function"
```

## P1 Task 6 — Manual end-to-end

- [ ] **Step 1:** Start stack (`inngest dev` + `pnpm dev`).
- [ ] **Step 2:** POST a fake webhook:

```bash
BODY='{"action":"created","data":{"issue":{"id":"SENTRY-TEST-1","title":"TypeError","web_url":"https://sentry.io/issues/test/","culprit":"checkout.applyCoupon","environment":"staging","release":"app@0.0.1"}}}'
SIG=$(node -e "process.stdout.write(require('crypto').createHmac('sha256',process.env.S).update(process.env.B).digest('hex'))" S="<your secret>" B="$BODY")
curl -X POST http://localhost:3000/webhooks/sentry \
  -H "content-type: application/json" \
  -H "sentry-hook-resource: issue" \
  -H "sentry-hook-signature: $SIG" \
  -d "$BODY"
```

Expected: 202 accepted.
- [ ] **Step 3:** Open Inngest dev UI → Events → see `sentry/issue.created`.
- [ ] **Step 4:** Open the run → `build-prompt` step succeeds, `invoke-codex` runs (requires `codex` CLI with MCP servers configured).

## P1 Done Criteria

- [ ] Unit tests green, typecheck clean
- [ ] Sentry webhook endpoint validates signatures and emits events
- [ ] `on-sentry-issue` visible in Inngest dev UI
- [ ] End-to-end with real Codex + MCP produces a real Linear ticket (manual check)

---

# P2 — Fixer (Flow 2)

**Goal:** Linear `ticket.created` → Codex opens a draft PR containing (a) a red-green Playwright test in `tests/regressions/` and (b) the fix. The test and fix land together atomically.

**Architecture:** A Linear webhook hits `/webhooks/linear`, signature-verified, filters to bug-labeled tickets, emits `linear/ticket.created`. The `on-linear-ticket` function builds a fixer prompt, creates an isolated git worktree of the target repo, and invokes Codex with `cwd` set to the worktree. Codex reads the ticket's structured scenario (from P1), writes the failing test, verifies red, writes the fix, verifies green, and opens a draft PR. Concurrency key by `touched_module` (extracted from ticket labels) prevents merge conflicts.

## P2 File Structure (additions)

```
src/
  webhooks/linear.ts
  git/worktree.ts                # git worktree add/remove helper
  prompts/fixer.ts
  inngest/functions/onLinearTicket.ts

tests/
  webhooks/linear.test.ts
  git/worktree.test.ts
  prompts/fixer.test.ts
  inngest/onLinearTicket.test.ts
```

**Modified:** `src/config/env.ts` (+2 vars), `src/inngest/index.ts`, `src/server.ts`, `.env.example`.

## P2 Task 1 — Extend env

**Files:** Modify `src/config/env.ts`, `tests/config/env.test.ts`, `.env.example`.

- [ ] **Step 1: Add failing test** (append to `describe` in `tests/config/env.test.ts`):

```ts
it("parses Linear webhook + target repo vars", () => {
  process.env.INNGEST_EVENT_KEY = "x";
  process.env.INNGEST_SIGNING_KEY = "x";
  process.env.CODEX_BIN = "/usr/local/bin/codex";
  process.env.SENTRY_WEBHOOK_SECRET = "x";
  process.env.LINEAR_API_KEY = "x";
  process.env.BROWSER_USE_API_KEY = "x";
  process.env.LINEAR_WEBHOOK_SECRET = "lin-sec";
  process.env.TARGET_REPO_PATH = "/tmp/target-repo";
  process.env.TARGET_REPO_WORKTREE_ROOT = "/tmp/worktrees";

  const env = loadEnv();
  expect(env.LINEAR_WEBHOOK_SECRET).toBe("lin-sec");
  expect(env.TARGET_REPO_PATH).toBe("/tmp/target-repo");
  expect(env.TARGET_REPO_WORKTREE_ROOT).toBe("/tmp/worktrees");
});
```

- [ ] **Step 2: Extend schema**

```ts
const EnvSchema = z.object({
  // ...existing...
  LINEAR_WEBHOOK_SECRET: z.string().min(1),
  TARGET_REPO_PATH: z.string().min(1),
  TARGET_REPO_WORKTREE_ROOT: z.string().min(1),
});
```

- [ ] **Step 3: Append to `.env.example`**

```
LINEAR_WEBHOOK_SECRET=
TARGET_REPO_PATH=/absolute/path/to/target/repo
TARGET_REPO_WORKTREE_ROOT=/tmp/incident-loop-worktrees
```

- [ ] **Step 4: Verify + commit**

```bash
pnpm test tests/config/env.test.ts
git add src/config/env.ts tests/config/env.test.ts .env.example
git commit -m "P2 task 1: extend env for Linear webhook + target repo"
```

## P2 Task 2 — Git worktree helper

Creates an isolated worktree so concurrent fixers don't trample each other. Uses `git worktree add` / `git worktree remove`.

**Files:** Create `src/git/worktree.ts`, `tests/git/worktree.test.ts`.

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";

const spawnMock = vi.fn();
vi.mock("node:child_process", () => ({
  spawn: (...a: unknown[]) => spawnMock(...a),
}));

import { createWorktree, removeWorktree } from "../../src/git/worktree";

function fakeProc(exitCode: number, stderr = ""): any {
  const proc: any = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  setImmediate(() => {
    if (stderr) proc.stderr.emit("data", Buffer.from(stderr));
    proc.emit("close", exitCode);
  });
  return proc;
}

describe("worktree helper", () => {
  beforeEach(() => {
    spawnMock.mockReset();
    process.env.INNGEST_EVENT_KEY = "x";
    process.env.INNGEST_SIGNING_KEY = "x";
    process.env.CODEX_BIN = "/usr/local/bin/codex";
    process.env.SENTRY_WEBHOOK_SECRET = "x";
    process.env.LINEAR_API_KEY = "x";
    process.env.BROWSER_USE_API_KEY = "x";
    process.env.LINEAR_WEBHOOK_SECRET = "x";
    process.env.TARGET_REPO_PATH = "/tmp/target";
    process.env.TARGET_REPO_WORKTREE_ROOT = "/tmp/wt";
  });

  it("creates a worktree with a branch named after the ticket", async () => {
    spawnMock.mockReturnValue(fakeProc(0));
    const wt = await createWorktree("TICKET-42");

    expect(wt.path).toMatch(/\/tmp\/wt\/TICKET-42-/);
    expect(wt.branch).toMatch(/^fix\/TICKET-42-/);
    expect(spawnMock).toHaveBeenCalledWith(
      "git",
      expect.arrayContaining(["worktree", "add", "-b", wt.branch, wt.path]),
      expect.objectContaining({ cwd: "/tmp/target" }),
    );
  });

  it("rejects on git failure", async () => {
    spawnMock.mockReturnValue(fakeProc(1, "fatal: boom"));
    await expect(createWorktree("T-1")).rejects.toThrow(/git worktree add.*boom/);
  });

  it("removes a worktree", async () => {
    spawnMock.mockReturnValue(fakeProc(0));
    await removeWorktree("/tmp/wt/T-1-abc");
    expect(spawnMock).toHaveBeenCalledWith(
      "git",
      ["worktree", "remove", "--force", "/tmp/wt/T-1-abc"],
      expect.objectContaining({ cwd: "/tmp/target" }),
    );
  });
});
```

- [ ] **Step 2: Implement `src/git/worktree.ts`**

```ts
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { env } from "../config/env";

export interface Worktree {
  path: string;
  branch: string;
}

function run(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("git", args, { cwd: env.TARGET_REPO_PATH, stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    proc.stderr?.on("data", (c: Buffer) => { stderr += c.toString(); });
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`git ${args.join(" ")} failed: ${stderr.trim()}`));
    });
    proc.on("error", reject);
  });
}

export async function createWorktree(ticketId: string): Promise<Worktree> {
  const suffix = randomBytes(4).toString("hex");
  const path = join(env.TARGET_REPO_WORKTREE_ROOT, `${ticketId}-${suffix}`);
  const branch = `fix/${ticketId}-${suffix}`;
  await run(["worktree", "add", "-b", branch, path]);
  return { path, branch };
}

export async function removeWorktree(path: string): Promise<void> {
  await run(["worktree", "remove", "--force", path]);
}
```

- [ ] **Step 3: Verify + commit**

```bash
pnpm test tests/git/worktree.test.ts
git add src/git/worktree.ts tests/git/worktree.test.ts
git commit -m "P2 task 2: git worktree create/remove helper"
```

## P2 Task 3 — Fixer prompt builder

**Files:** Create `src/prompts/fixer.ts`, `tests/prompts/fixer.test.ts`.

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect } from "vitest";
import { buildFixerPrompt } from "../../src/prompts/fixer";

describe("buildFixerPrompt", () => {
  const ticket = {
    id: "BUG-42",
    url: "https://linear.app/acme/issue/BUG-42",
    title: "Checkout coupon crash",
    body: "Summary: ...\nReproduction steps: 1. ...",
    errorSignature: "abc123",
  };
  const worktreePath = "/tmp/wt/BUG-42-abcd";
  const branch = "fix/BUG-42-abcd";

  it("includes ticket id, URL, and body", () => {
    const p = buildFixerPrompt({ ticket, worktreePath, branch });
    expect(p).toContain("BUG-42");
    expect(p).toContain(ticket.url);
    expect(p).toContain(ticket.body);
  });

  it("requires red-green discipline", () => {
    const p = buildFixerPrompt({ ticket, worktreePath, branch });
    expect(p).toMatch(/red/i);
    expect(p).toMatch(/green/i);
  });

  it("points at tests/regressions/", () => {
    const p = buildFixerPrompt({ ticket, worktreePath, branch });
    expect(p).toContain("tests/regressions/");
  });

  it("mandates a draft PR", () => {
    expect(buildFixerPrompt({ ticket, worktreePath, branch })).toMatch(/draft/i);
  });

  it("includes the worktree path and branch", () => {
    const p = buildFixerPrompt({ ticket, worktreePath, branch });
    expect(p).toContain(worktreePath);
    expect(p).toContain(branch);
  });
});
```

- [ ] **Step 2: Implement `src/prompts/fixer.ts`**

```ts
export interface LinearTicket {
  id: string;
  url: string;
  title: string;
  body: string;
  errorSignature: string;
}

export interface FixerInput {
  ticket: LinearTicket;
  worktreePath: string;
  branch: string;
}

export function buildFixerPrompt({ ticket, worktreePath, branch }: FixerInput): string {
  return `You are the Incident Fixer for the incident-loop system.

A Linear ticket has been filed by the Reproducer (or the Hunter) containing a structured reproduction scenario. Your job is to:

1. Write a **failing Playwright test** that reproduces the bug.
2. Run it and confirm it FAILS (red).
3. Write the minimal fix.
4. Run the test and confirm it PASSES (green).
5. Open a **draft PR** on GitHub containing both the test and the fix.

## Ticket
- ID: ${ticket.id}
- URL: ${ticket.url}
- Title: ${ticket.title}
- Error signature: ${ticket.errorSignature}

### Ticket body (structured scenario from the Reproducer)
\`\`\`
${ticket.body}
\`\`\`

## Workspace
- Worktree path: ${worktreePath}
- Branch: ${branch}
- Test file location: ${worktreePath}/tests/regressions/${ticket.id.toLowerCase()}.spec.ts

## Procedure
1. cd into ${worktreePath}.
2. Write \`tests/regressions/${ticket.id.toLowerCase()}.spec.ts\` as a Playwright test that asserts the expected behavior from the ticket.
3. Run the test. It MUST fail. Capture the output.
4. Write the minimal fix to make the test pass.
5. Run the test again. It MUST pass. Capture the output.
6. \`git add\` the test + fix in one commit.
7. Push the branch.
8. Open a **draft** pull request via the GitHub MCP. Body MUST include:
   - Link to ${ticket.url}
   - The red run output (proving the test failed pre-fix)
   - The green run output (proving the test passes post-fix)
   - A short description of the fix

## Hard constraints
- The PR MUST be draft, not ready-for-review.
- The test MUST be written before the fix.
- You MUST run the test and observe it failing before writing the fix. If it passes before the fix, the test is wrong — rewrite it.
- One commit with both test and fix. Do not split.
- Only modify files inside ${worktreePath}.

When done, print: FIXER_DONE <pr_url>
`;
}
```

- [ ] **Step 3: Verify + commit**

```bash
pnpm test tests/prompts/fixer.test.ts
git add src/prompts/fixer.ts tests/prompts/fixer.test.ts
git commit -m "P2 task 3: fixer prompt builder"
```

## P2 Task 4 — Linear webhook endpoint

**Files:** Create `src/webhooks/linear.ts`, `tests/webhooks/linear.test.ts`, modify `src/server.ts`.

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHmac } from "node:crypto";
import { Hono } from "hono";

const sendMock = vi.fn();
vi.mock("../../src/inngest/client", () => ({
  inngest: { send: (...a: unknown[]) => sendMock(...a) },
}));

import { mountLinearWebhook } from "../../src/webhooks/linear";

function sign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

describe("POST /webhooks/linear", () => {
  const secret = "lin-sec";

  beforeEach(() => {
    sendMock.mockReset();
    process.env.INNGEST_EVENT_KEY = "x";
    process.env.INNGEST_SIGNING_KEY = "x";
    process.env.CODEX_BIN = "/usr/local/bin/codex";
    process.env.SENTRY_WEBHOOK_SECRET = "x";
    process.env.LINEAR_API_KEY = "x";
    process.env.BROWSER_USE_API_KEY = "x";
    process.env.LINEAR_WEBHOOK_SECRET = secret;
    process.env.TARGET_REPO_PATH = "/tmp/target";
    process.env.TARGET_REPO_WORKTREE_ROOT = "/tmp/wt";
  });

  const bugBody = JSON.stringify({
    action: "create",
    type: "Issue",
    data: {
      id: "uuid-1",
      identifier: "BUG-42",
      url: "https://linear.app/acme/issue/BUG-42",
      title: "Checkout crash",
      description: "Summary: ...",
      labels: [{ name: "bug" }, { name: "source:reproducer" }, { name: "module:checkout" }],
    },
  });

  it("rejects bad signatures", async () => {
    const app = new Hono();
    mountLinearWebhook(app);
    const res = await app.request("/webhooks/linear", {
      method: "POST",
      headers: { "content-type": "application/json", "linear-signature": "deadbeef" },
      body: bugBody,
    });
    expect(res.status).toBe(401);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("emits event for bug-labeled Issue create", async () => {
    const app = new Hono();
    mountLinearWebhook(app);
    const res = await app.request("/webhooks/linear", {
      method: "POST",
      headers: { "content-type": "application/json", "linear-signature": sign(bugBody, secret) },
      body: bugBody,
    });
    expect(res.status).toBe(202);
    expect(sendMock).toHaveBeenCalledWith({
      name: "linear/ticket.created",
      data: expect.objectContaining({
        ticket: expect.objectContaining({ identifier: "BUG-42", module: "checkout" }),
      }),
    });
  });

  it("ignores non-bug tickets", async () => {
    const app = new Hono();
    mountLinearWebhook(app);
    const body = JSON.stringify({
      action: "create",
      type: "Issue",
      data: { id: "x", identifier: "FEAT-1", title: "feature", labels: [{ name: "feature" }] },
    });
    const res = await app.request("/webhooks/linear", {
      method: "POST",
      headers: { "content-type": "application/json", "linear-signature": sign(body, secret) },
      body,
    });
    expect(res.status).toBe(204);
    expect(sendMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Implement `src/webhooks/linear.ts`**

```ts
import type { Hono } from "hono";
import { env } from "../config/env";
import { inngest } from "../inngest/client";
import { verifyHmacSha256 } from "./verify";

interface LinearLabel { name: string }
interface LinearIssueData {
  id: string;
  identifier: string;
  url: string;
  title: string;
  description?: string;
  labels?: LinearLabel[];
}

function extractModule(labels: LinearLabel[]): string {
  const mod = labels.find((l) => l.name.startsWith("module:"));
  return mod ? mod.name.slice("module:".length) : "unknown";
}

export function mountLinearWebhook(app: Hono): void {
  app.post("/webhooks/linear", async (c) => {
    const signature = c.req.header("linear-signature") ?? "";
    const body = await c.req.text();

    if (!verifyHmacSha256({ body, signature, secret: env.LINEAR_WEBHOOK_SECRET })) {
      return c.json({ error: "invalid signature" }, 401);
    }

    const parsed = JSON.parse(body) as {
      action: string;
      type: string;
      data: LinearIssueData;
    };

    if (parsed.type !== "Issue" || parsed.action !== "create") {
      return c.body(null, 204);
    }

    const labels = parsed.data.labels ?? [];
    const isBug = labels.some((l) => l.name === "bug");
    if (!isBug) return c.body(null, 204);

    await inngest.send({
      name: "linear/ticket.created",
      data: {
        ticket: {
          id: parsed.data.id,
          identifier: parsed.data.identifier,
          url: parsed.data.url,
          title: parsed.data.title,
          body: parsed.data.description ?? "",
          module: extractModule(labels),
        },
      },
    });

    return c.json({ accepted: true }, 202);
  });
}
```

- [ ] **Step 3: Mount in `src/server.ts`**

```ts
import { mountLinearWebhook } from "./webhooks/linear";
// ...inside buildApp:
mountLinearWebhook(app);
```

- [ ] **Step 4: Verify + commit**

```bash
pnpm test tests/webhooks/linear.test.ts tests/server.test.ts
git add src/webhooks/linear.ts tests/webhooks/linear.test.ts src/server.ts
git commit -m "P2 task 4: Linear webhook with bug-label filter + module extraction"
```

## P2 Task 5 — `on-linear-ticket` Inngest function

**Files:** Create `src/inngest/functions/onLinearTicket.ts`, `tests/inngest/onLinearTicket.test.ts`, modify `src/inngest/index.ts`.

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/codex/invoke", () => ({ invokeCodex: vi.fn() }));
vi.mock("../../src/git/worktree", () => ({
  createWorktree: vi.fn(),
  removeWorktree: vi.fn(),
}));

import { onLinearTicket } from "../../src/inngest/functions/onLinearTicket";
import { functions } from "../../src/inngest";

describe("onLinearTicket", () => {
  beforeEach(() => {
    process.env.INNGEST_EVENT_KEY = "x";
    process.env.INNGEST_SIGNING_KEY = "x";
    process.env.CODEX_BIN = "/usr/local/bin/codex";
    process.env.SENTRY_WEBHOOK_SECRET = "x";
    process.env.LINEAR_API_KEY = "x";
    process.env.BROWSER_USE_API_KEY = "x";
    process.env.LINEAR_WEBHOOK_SECRET = "x";
    process.env.TARGET_REPO_PATH = "/tmp/target";
    process.env.TARGET_REPO_WORKTREE_ROOT = "/tmp/wt";
  });

  it("has id 'on-linear-ticket'", () => {
    expect(onLinearTicket.id()).toBe("on-linear-ticket");
  });

  it("is registered in the barrel", () => {
    expect(functions).toContain(onLinearTicket);
  });
});
```

- [ ] **Step 2: Implement `src/inngest/functions/onLinearTicket.ts`**

```ts
import { inngest } from "../client";
import { invokeCodex } from "../../codex/invoke";
import { createWorktree, removeWorktree } from "../../git/worktree";
import { buildFixerPrompt } from "../../prompts/fixer";

interface LinearTicketEvent {
  data: {
    ticket: {
      id: string;
      identifier: string;
      url: string;
      title: string;
      body: string;
      module: string;
    };
  };
}

export const onLinearTicket = inngest.createFunction(
  {
    id: "on-linear-ticket",
    retries: 1,
    concurrency: [
      { key: "event.data.ticket.module", limit: 1 },
      { limit: 5 },
    ],
  },
  { event: "linear/ticket.created" },
  async ({ event, step }) => {
    const ticket = (event as unknown as LinearTicketEvent).data.ticket;

    const wt = await step.run("create-worktree", () =>
      createWorktree(ticket.identifier),
    );

    try {
      const prompt = await step.run("build-prompt", () =>
        buildFixerPrompt({
          ticket: {
            id: ticket.identifier,
            url: ticket.url,
            title: ticket.title,
            body: ticket.body,
            errorSignature: extractSignature(ticket.body),
          },
          worktreePath: wt.path,
          branch: wt.branch,
        }),
      );

      const result = await step.run("invoke-codex", async () => {
        const { stdout } = await invokeCodex(prompt, {
          cwd: wt.path,
          timeoutMs: 30 * 60 * 1000,
        });
        return { stdout };
      });

      const prMatch = result.stdout.match(/FIXER_DONE\s+(\S+)/);
      return { prUrl: prMatch?.[1] ?? null, status: prMatch ? "ok" : "no-pr-url" };
    } finally {
      await step.run("remove-worktree", () => removeWorktree(wt.path));
    }
  },
);

function extractSignature(body: string): string {
  const m = body.match(/error signature:\s*(\S+)/i);
  return m?.[1] ?? "unknown";
}
```

- [ ] **Step 3: Register in `src/inngest/index.ts`**

```ts
import { ping } from "./functions/ping";
import { onSentryIssue } from "./functions/onSentryIssue";
import { onLinearTicket } from "./functions/onLinearTicket";

export const functions = [ping, onSentryIssue, onLinearTicket] as const;
```

- [ ] **Step 4: Verify + commit**

```bash
pnpm test && pnpm typecheck
git add src/inngest/functions/onLinearTicket.ts src/inngest/index.ts tests/inngest/onLinearTicket.test.ts
git commit -m "P2 task 5: on-linear-ticket fixer function with per-module concurrency"
```

## P2 Task 6 — Manual end-to-end

- [ ] **Step 1:** Ensure `TARGET_REPO_PATH` points at a real git repo on disk.
- [ ] **Step 2:** Start stack.
- [ ] **Step 3:** POST a fake Linear webhook with a bug-labeled Issue create payload (same curl pattern as P1, using `LINEAR_WEBHOOK_SECRET`).
- [ ] **Step 4:** In Inngest dev UI, confirm the run creates a worktree, invokes Codex, and cleans up the worktree on completion.
- [ ] **Step 5:** Inspect `ls $TARGET_REPO_WORKTREE_ROOT` after the run — expect empty (worktree removed).

## P2 Done Criteria

- [ ] Unit tests green, typecheck clean
- [ ] Linear webhook filters non-bug tickets
- [ ] `on-linear-ticket` serializes by module label, parallelizes across modules
- [ ] Worktrees are created and cleaned up even on Codex failure (finally block)
- [ ] End-to-end with real Codex produces a draft PR (manual check)

---

# P3 — Hunter (Flow 3)

**Goal:** PR marked ready-for-review → Codex pulls incident history + diff → fan-out to N=5 parallel executors that drive browser-use against the PR's preview env → reducer dedups and either files a Linear ticket (kicking P1 → P2) or posts an advisory comment on the PR.

**Architecture:** GitHub webhook hits `/webhooks/github`, signature-verified, filters to `pull_request.ready_for_review`, emits `github/pr.ready_for_review`. The `onPrReadyForReview` Inngest function runs three phases durably:

1. **Planner** (one `step.run`): Codex call with the planner prompt, outputs a JSON list of ranked scenarios.
2. **Executors** (`Promise.all` over the top N=5 scenarios, each as its own `step.run`): Codex call with the executor prompt, outputs `{scenario, passed, evidence}`.
3. **Reducer** (one `step.run`): pure function that computes error signatures, dedups against open Linear tickets in the last 30 days, and either files new tickets or comments on existing ones + posts a PR comment.

Concurrency key `event.data.pr.number` keeps executors for the same PR on one preview env. A global concurrency cap bounds browser-use load.

## P3 File Structure (additions)

```
src/
  webhooks/github.ts
  prompts/
    hunterPlanner.ts
    hunterExecutor.ts
  util/
    errorSignature.ts             # sha256(route:errorClass:topFrame)
  reducer/
    dedup.ts                      # pure dedup logic
    index.ts                      # reducer orchestration (files tickets or comments)
  inngest/functions/onPrReadyForReview.ts

tests/
  webhooks/github.test.ts
  prompts/{hunterPlanner,hunterExecutor}.test.ts
  util/errorSignature.test.ts
  reducer/dedup.test.ts
  inngest/onPrReadyForReview.test.ts
```

**Modified:** `src/config/env.ts` (+2 vars), `src/inngest/index.ts`, `src/server.ts`, `.env.example`.

## P3 Task 1 — Extend env

**Files:** Modify `src/config/env.ts`, `tests/config/env.test.ts`, `.env.example`.

- [ ] **Step 1: Add failing test**

```ts
it("parses GitHub webhook + scenario budget vars", () => {
  process.env.INNGEST_EVENT_KEY = "x";
  process.env.INNGEST_SIGNING_KEY = "x";
  process.env.CODEX_BIN = "/usr/local/bin/codex";
  process.env.SENTRY_WEBHOOK_SECRET = "x";
  process.env.LINEAR_API_KEY = "x";
  process.env.BROWSER_USE_API_KEY = "x";
  process.env.LINEAR_WEBHOOK_SECRET = "x";
  process.env.TARGET_REPO_PATH = "/tmp/t";
  process.env.TARGET_REPO_WORKTREE_ROOT = "/tmp/wt";
  process.env.GITHUB_WEBHOOK_SECRET = "gh-sec";
  process.env.MAX_SCENARIOS_PER_PR = "5";

  const env = loadEnv();
  expect(env.GITHUB_WEBHOOK_SECRET).toBe("gh-sec");
  expect(env.MAX_SCENARIOS_PER_PR).toBe(5);
});
```

- [ ] **Step 2: Extend schema**

```ts
const EnvSchema = z.object({
  // ...existing...
  GITHUB_WEBHOOK_SECRET: z.string().min(1),
  MAX_SCENARIOS_PER_PR: z.coerce.number().int().positive().default(5),
});
```

- [ ] **Step 3: Append to `.env.example`**

```
GITHUB_WEBHOOK_SECRET=
MAX_SCENARIOS_PER_PR=5
```

- [ ] **Step 4: Verify + commit**

```bash
pnpm test tests/config/env.test.ts
git add src/config/env.ts tests/config/env.test.ts .env.example
git commit -m "P3 task 1: extend env for GitHub webhook + scenario budget"
```

## P3 Task 2 — Error signature utility

**Files:** Create `src/util/errorSignature.ts`, `tests/util/errorSignature.test.ts`.

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect } from "vitest";
import { errorSignature } from "../../src/util/errorSignature";

describe("errorSignature", () => {
  it("is deterministic", () => {
    const a = errorSignature({ route: "/checkout", errorClass: "TypeError", topFrame: "applyCoupon:42" });
    const b = errorSignature({ route: "/checkout", errorClass: "TypeError", topFrame: "applyCoupon:42" });
    expect(a).toBe(b);
  });

  it("changes when any field changes", () => {
    const base = { route: "/checkout", errorClass: "TypeError", topFrame: "applyCoupon:42" };
    expect(errorSignature(base)).not.toBe(errorSignature({ ...base, route: "/cart" }));
    expect(errorSignature(base)).not.toBe(errorSignature({ ...base, errorClass: "RangeError" }));
    expect(errorSignature(base)).not.toBe(errorSignature({ ...base, topFrame: "applyCoupon:43" }));
  });

  it("returns a 64-char hex string", () => {
    const sig = errorSignature({ route: "/", errorClass: "Error", topFrame: "x" });
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
  });
});
```

- [ ] **Step 2: Implement `src/util/errorSignature.ts`**

```ts
import { createHash } from "node:crypto";

export interface SignatureInput {
  route: string;
  errorClass: string;
  topFrame: string;
}

export function errorSignature({ route, errorClass, topFrame }: SignatureInput): string {
  return createHash("sha256")
    .update(`${route}:${errorClass}:${topFrame}`)
    .digest("hex");
}
```

- [ ] **Step 3: Verify + commit**

```bash
pnpm test tests/util/errorSignature.test.ts
git add src/util/errorSignature.ts tests/util/errorSignature.test.ts
git commit -m "P3 task 2: deterministic error signature hash"
```

## P3 Task 3 — Dedup logic

**Files:** Create `src/reducer/dedup.ts`, `tests/reducer/dedup.test.ts`.

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect } from "vitest";
import { partitionForDedup } from "../../src/reducer/dedup";

describe("partitionForDedup", () => {
  const now = new Date("2026-04-15T12:00:00Z").getTime();
  const within30 = new Date(now - 10 * 24 * 3600 * 1000).toISOString();
  const over30 = new Date(now - 40 * 24 * 3600 * 1000).toISOString();

  const existing = [
    { id: "L-1", signature: "sig-A", createdAt: within30, state: "open" },
    { id: "L-2", signature: "sig-B", createdAt: over30, state: "open" },
    { id: "L-3", signature: "sig-C", createdAt: within30, state: "closed" },
  ];

  it("matches open tickets within 30 days on signature", () => {
    const { toComment, toFile } = partitionForDedup(
      [{ signature: "sig-A", scenario: "s1", evidence: "e1" }],
      existing,
      now,
    );
    expect(toComment).toHaveLength(1);
    expect(toComment[0].existingTicketId).toBe("L-1");
    expect(toFile).toHaveLength(0);
  });

  it("files new when sig is over 30 days old", () => {
    const { toComment, toFile } = partitionForDedup(
      [{ signature: "sig-B", scenario: "s2", evidence: "e2" }],
      existing,
      now,
    );
    expect(toFile).toHaveLength(1);
    expect(toComment).toHaveLength(0);
  });

  it("files new when matching ticket is closed", () => {
    const { toComment, toFile } = partitionForDedup(
      [{ signature: "sig-C", scenario: "s3", evidence: "e3" }],
      existing,
      now,
    );
    expect(toFile).toHaveLength(1);
    expect(toComment).toHaveLength(0);
  });

  it("splits a mixed batch correctly", () => {
    const { toComment, toFile } = partitionForDedup(
      [
        { signature: "sig-A", scenario: "known", evidence: "e" },
        { signature: "sig-NEW", scenario: "new", evidence: "e" },
      ],
      existing,
      now,
    );
    expect(toComment).toHaveLength(1);
    expect(toFile).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Implement `src/reducer/dedup.ts`**

```ts
export interface Failure {
  signature: string;
  scenario: string;
  evidence: string;
}

export interface ExistingTicket {
  id: string;
  signature: string;
  createdAt: string;
  state: "open" | "closed" | string;
}

export interface CommentAction {
  failure: Failure;
  existingTicketId: string;
}

export interface FileAction {
  failure: Failure;
}

export interface Partition {
  toComment: CommentAction[];
  toFile: FileAction[];
}

const THIRTY_DAYS_MS = 30 * 24 * 3600 * 1000;

export function partitionForDedup(
  failures: Failure[],
  existing: ExistingTicket[],
  nowMs: number,
): Partition {
  const toComment: CommentAction[] = [];
  const toFile: FileAction[] = [];

  for (const failure of failures) {
    const match = existing.find((t) => {
      if (t.signature !== failure.signature) return false;
      if (t.state !== "open") return false;
      const ageMs = nowMs - new Date(t.createdAt).getTime();
      return ageMs <= THIRTY_DAYS_MS;
    });

    if (match) {
      toComment.push({ failure, existingTicketId: match.id });
    } else {
      toFile.push({ failure });
    }
  }

  return { toComment, toFile };
}
```

- [ ] **Step 3: Verify + commit**

```bash
pnpm test tests/reducer/dedup.test.ts
git add src/reducer/dedup.ts tests/reducer/dedup.test.ts
git commit -m "P3 task 3: pure dedup partition (30-day open-ticket signature match)"
```

## P3 Task 4 — Planner prompt

**Files:** Create `src/prompts/hunterPlanner.ts`, `tests/prompts/hunterPlanner.test.ts`.

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect } from "vitest";
import { buildPlannerPrompt } from "../../src/prompts/hunterPlanner";

describe("buildPlannerPrompt", () => {
  const input = {
    prNumber: 123,
    prUrl: "https://github.com/acme/app/pull/123",
    diffSummary: "M src/checkout/coupon.ts\nM src/checkout/currency.ts",
    previewUrl: "https://pr-123.preview.acme.dev",
    maxScenarios: 5,
  };

  it("includes PR context + preview URL", () => {
    const p = buildPlannerPrompt(input);
    expect(p).toContain("123");
    expect(p).toContain(input.previewUrl);
  });

  it("asks for JSON output with exactly the top N scenarios", () => {
    const p = buildPlannerPrompt(input);
    expect(p).toMatch(/json/i);
    expect(p).toContain("5");
  });

  it("instructs Codex to pull Sentry + Linear history", () => {
    const p = buildPlannerPrompt(input);
    expect(p).toMatch(/sentry/i);
    expect(p).toMatch(/linear/i);
  });

  it("requires correlation with the diff", () => {
    expect(buildPlannerPrompt(input)).toMatch(/correlate|overlap|intersect/i);
  });
});
```

- [ ] **Step 2: Implement `src/prompts/hunterPlanner.ts`**

```ts
export interface PlannerInput {
  prNumber: number;
  prUrl: string;
  diffSummary: string;
  previewUrl: string;
  maxScenarios: number;
}

export function buildPlannerPrompt(input: PlannerInput): string {
  return `You are the Hunter Planner for the incident-loop system.

A pull request has been marked ready-for-review. Your job is to produce a ranked list of exactly ${input.maxScenarios} exploratory test scenarios. You do NOT run the scenarios — executors will do that. You only plan.

## PR context
- Number: ${input.prNumber}
- URL: ${input.prUrl}
- Preview: ${input.previewUrl}

### Diff summary
\`\`\`
${input.diffSummary}
\`\`\`

## Procedure
1. Use the Sentry MCP to pull recent and recurring incidents. Note which modules, routes, and flows they touched.
2. Use the Linear MCP to pull recent bug tickets with labels \`bug\` or \`source:hunter\`.
3. Correlate the diff with the incident history: which changed files/modules overlap with historical bug hot zones?
4. Produce ${input.maxScenarios} scenarios, ranked by "this area has broken before AND this PR touches it."

## Output format
Print exactly one JSON array (no prose, no markdown fences), like:

\`\`\`
[
  {
    "id": "s1",
    "title": "apply expired coupon then switch currency",
    "rationale": "BUG-17 (2 weeks ago) was an expired-coupon edge case; this PR touches src/checkout/coupon.ts and src/checkout/currency.ts",
    "steps": ["navigate to /cart", "add item", "apply coupon EXP2025", "change currency to EUR"],
    "expectedBehavior": "coupon re-validates for the new currency, no unhandled error"
  }
]
\`\`\`

The array MUST contain exactly ${input.maxScenarios} entries.

When done, print: PLANNER_DONE
`;
}
```

- [ ] **Step 3: Verify + commit**

```bash
pnpm test tests/prompts/hunterPlanner.test.ts
git add src/prompts/hunterPlanner.ts tests/prompts/hunterPlanner.test.ts
git commit -m "P3 task 4: hunter planner prompt"
```

## P3 Task 5 — Executor prompt

**Files:** Create `src/prompts/hunterExecutor.ts`, `tests/prompts/hunterExecutor.test.ts`.

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect } from "vitest";
import { buildExecutorPrompt } from "../../src/prompts/hunterExecutor";

describe("buildExecutorPrompt", () => {
  const input = {
    prNumber: 123,
    previewUrl: "https://pr-123.preview.acme.dev",
    scenario: {
      id: "s1",
      title: "apply expired coupon",
      rationale: "matches BUG-17",
      steps: ["nav /cart", "apply EXP2025"],
      expectedBehavior: "no unhandled error",
    },
  };

  it("includes preview URL and scenario", () => {
    const p = buildExecutorPrompt(input);
    expect(p).toContain(input.previewUrl);
    expect(p).toContain("apply expired coupon");
  });

  it("uses browser-use", () => {
    expect(buildExecutorPrompt(input)).toMatch(/browser-use/i);
  });

  it("asks for JSON with pass/fail + signature fields", () => {
    const p = buildExecutorPrompt(input);
    expect(p).toMatch(/json/i);
    expect(p).toMatch(/passed/i);
    expect(p).toMatch(/signature/i);
  });

  it("forbids modifying the repo", () => {
    expect(buildExecutorPrompt(input)).toMatch(/do not.*commit|read-only/i);
  });
});
```

- [ ] **Step 2: Implement `src/prompts/hunterExecutor.ts`**

```ts
export interface Scenario {
  id: string;
  title: string;
  rationale: string;
  steps: string[];
  expectedBehavior: string;
}

export interface ExecutorInput {
  prNumber: number;
  previewUrl: string;
  scenario: Scenario;
}

export function buildExecutorPrompt({ prNumber, previewUrl, scenario }: ExecutorInput): string {
  return `You are a Hunter Executor for the incident-loop system.

Run ONE exploratory scenario against a PR preview environment and report the result. You are read-only — do NOT commit, push, or open PRs.

## Target
- PR number: ${prNumber}
- Preview URL: ${previewUrl}

## Scenario
- ID: ${scenario.id}
- Title: ${scenario.title}
- Rationale: ${scenario.rationale}
- Expected behavior: ${scenario.expectedBehavior}

### Steps
${scenario.steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}

## Procedure
1. Use browser-use MCP to drive the preview environment through the steps.
2. Observe whether the expected behavior holds or a bug occurs.
3. If a bug occurs, capture: the route at time of failure, the error class, the top stack frame, and a short evidence string (what happened).

## Output format
Print exactly one JSON object (no prose), like:

\`\`\`
{
  "scenarioId": "${scenario.id}",
  "passed": false,
  "route": "/checkout",
  "errorClass": "TypeError",
  "topFrame": "applyCoupon:42",
  "signature": "",
  "evidence": "clicking Apply Coupon after currency change threw TypeError",
  "replayUrl": "https://browser-use..."
}
\`\`\`

Leave "signature" as an empty string — the reducer computes it deterministically from route + errorClass + topFrame.

If the scenario PASSED, set \`passed: true\` and leave route/errorClass/topFrame as empty strings.

## Hard constraints
- Read-only. Do NOT commit or open PRs.
- One JSON object on stdout. Nothing else.

When done, print: EXECUTOR_DONE
`;
}
```

- [ ] **Step 3: Verify + commit**

```bash
pnpm test tests/prompts/hunterExecutor.test.ts
git add src/prompts/hunterExecutor.ts tests/prompts/hunterExecutor.test.ts
git commit -m "P3 task 5: hunter executor prompt"
```

## P3 Task 6 — GitHub webhook endpoint

**Files:** Create `src/webhooks/github.ts`, `tests/webhooks/github.test.ts`, modify `src/server.ts`.

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHmac } from "node:crypto";
import { Hono } from "hono";

const sendMock = vi.fn();
vi.mock("../../src/inngest/client", () => ({
  inngest: { send: (...a: unknown[]) => sendMock(...a) },
}));

import { mountGithubWebhook } from "../../src/webhooks/github";

function sign(body: string, secret: string): string {
  return "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
}

describe("POST /webhooks/github", () => {
  const secret = "gh-sec";

  beforeEach(() => {
    sendMock.mockReset();
    process.env.INNGEST_EVENT_KEY = "x";
    process.env.INNGEST_SIGNING_KEY = "x";
    process.env.CODEX_BIN = "/usr/local/bin/codex";
    process.env.SENTRY_WEBHOOK_SECRET = "x";
    process.env.LINEAR_API_KEY = "x";
    process.env.BROWSER_USE_API_KEY = "x";
    process.env.LINEAR_WEBHOOK_SECRET = "x";
    process.env.TARGET_REPO_PATH = "/tmp/t";
    process.env.TARGET_REPO_WORKTREE_ROOT = "/tmp/wt";
    process.env.GITHUB_WEBHOOK_SECRET = secret;
    process.env.MAX_SCENARIOS_PER_PR = "5";
  });

  const readyBody = JSON.stringify({
    action: "ready_for_review",
    pull_request: {
      number: 123,
      html_url: "https://github.com/acme/app/pull/123",
      head: { ref: "feat/x" },
    },
    repository: { full_name: "acme/app" },
  });

  it("rejects bad signatures", async () => {
    const app = new Hono();
    mountGithubWebhook(app);
    const res = await app.request("/webhooks/github", {
      method: "POST",
      headers: { "content-type": "application/json", "x-hub-signature-256": "sha256=bad", "x-github-event": "pull_request" },
      body: readyBody,
    });
    expect(res.status).toBe(401);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("emits event for pull_request.ready_for_review", async () => {
    const app = new Hono();
    mountGithubWebhook(app);
    const res = await app.request("/webhooks/github", {
      method: "POST",
      headers: { "content-type": "application/json", "x-hub-signature-256": sign(readyBody, secret), "x-github-event": "pull_request" },
      body: readyBody,
    });
    expect(res.status).toBe(202);
    expect(sendMock).toHaveBeenCalledWith({
      name: "github/pr.ready_for_review",
      data: expect.objectContaining({
        pr: expect.objectContaining({ number: 123, repo: "acme/app" }),
      }),
    });
  });

  it("ignores other pull_request actions", async () => {
    const app = new Hono();
    mountGithubWebhook(app);
    const body = JSON.stringify({ action: "opened", pull_request: { number: 1 }, repository: { full_name: "a/b" } });
    const res = await app.request("/webhooks/github", {
      method: "POST",
      headers: { "content-type": "application/json", "x-hub-signature-256": sign(body, secret), "x-github-event": "pull_request" },
      body,
    });
    expect(res.status).toBe(204);
    expect(sendMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Implement `src/webhooks/github.ts`**

```ts
import type { Hono } from "hono";
import { env } from "../config/env";
import { inngest } from "../inngest/client";
import { verifyHmacSha256 } from "./verify";

interface PullRequestPayload {
  action: string;
  pull_request: {
    number: number;
    html_url: string;
    head: { ref: string };
  };
  repository: { full_name: string };
}

export function mountGithubWebhook(app: Hono): void {
  app.post("/webhooks/github", async (c) => {
    const signature = c.req.header("x-hub-signature-256") ?? "";
    const eventType = c.req.header("x-github-event") ?? "";
    const body = await c.req.text();

    if (!verifyHmacSha256({ body, signature, secret: env.GITHUB_WEBHOOK_SECRET })) {
      return c.json({ error: "invalid signature" }, 401);
    }

    if (eventType !== "pull_request") return c.body(null, 204);

    const parsed = JSON.parse(body) as PullRequestPayload;
    if (parsed.action !== "ready_for_review") return c.body(null, 204);

    await inngest.send({
      name: "github/pr.ready_for_review",
      data: {
        pr: {
          number: parsed.pull_request.number,
          url: parsed.pull_request.html_url,
          branch: parsed.pull_request.head.ref,
          repo: parsed.repository.full_name,
        },
      },
    });

    return c.json({ accepted: true }, 202);
  });
}
```

- [ ] **Step 3: Mount in `src/server.ts`**

```ts
import { mountGithubWebhook } from "./webhooks/github";
// inside buildApp:
mountGithubWebhook(app);
```

- [ ] **Step 4: Verify + commit**

```bash
pnpm test tests/webhooks/github.test.ts tests/server.test.ts
git add src/webhooks/github.ts tests/webhooks/github.test.ts src/server.ts
git commit -m "P3 task 6: GitHub webhook for pull_request.ready_for_review"
```

## P3 Task 7 — `onPrReadyForReview` Inngest function

This is the most complex task — it stitches planner, executors, and reducer into one durable function.

**Files:** Create `src/inngest/functions/onPrReadyForReview.ts`, `tests/inngest/onPrReadyForReview.test.ts`, modify `src/inngest/index.ts`.

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/codex/invoke", () => ({ invokeCodex: vi.fn() }));

import { onPrReadyForReview } from "../../src/inngest/functions/onPrReadyForReview";
import { functions } from "../../src/inngest";

describe("onPrReadyForReview", () => {
  beforeEach(() => {
    process.env.INNGEST_EVENT_KEY = "x";
    process.env.INNGEST_SIGNING_KEY = "x";
    process.env.CODEX_BIN = "/usr/local/bin/codex";
    process.env.SENTRY_WEBHOOK_SECRET = "x";
    process.env.LINEAR_API_KEY = "x";
    process.env.BROWSER_USE_API_KEY = "x";
    process.env.LINEAR_WEBHOOK_SECRET = "x";
    process.env.TARGET_REPO_PATH = "/tmp/t";
    process.env.TARGET_REPO_WORKTREE_ROOT = "/tmp/wt";
    process.env.GITHUB_WEBHOOK_SECRET = "x";
    process.env.MAX_SCENARIOS_PER_PR = "5";
  });

  it("has id 'on-pr-ready-for-review'", () => {
    expect(onPrReadyForReview.id()).toBe("on-pr-ready-for-review");
  });

  it("is registered in the barrel", () => {
    expect(functions).toContain(onPrReadyForReview);
  });
});
```

- [ ] **Step 2: Implement `src/inngest/functions/onPrReadyForReview.ts`**

```ts
import { inngest } from "../client";
import { invokeCodex } from "../../codex/invoke";
import { env } from "../../config/env";
import { buildPlannerPrompt } from "../../prompts/hunterPlanner";
import { buildExecutorPrompt, type Scenario } from "../../prompts/hunterExecutor";
import { errorSignature } from "../../util/errorSignature";

interface PrEvent {
  data: {
    pr: { number: number; url: string; branch: string; repo: string };
  };
}

interface ExecutorResult {
  scenarioId: string;
  passed: boolean;
  route: string;
  errorClass: string;
  topFrame: string;
  signature: string;
  evidence: string;
  replayUrl: string;
}

function parseJson<T>(text: string): T {
  const match = text.match(/\[[\s\S]*\]|\{[\s\S]*\}/);
  if (!match) throw new Error("no JSON found in codex output");
  return JSON.parse(match[0]) as T;
}

export const onPrReadyForReview = inngest.createFunction(
  {
    id: "on-pr-ready-for-review",
    retries: 1,
    concurrency: [
      { key: "event.data.pr.number", limit: 1 },
      { limit: 10 },
    ],
  },
  { event: "github/pr.ready_for_review" },
  async ({ event, step }) => {
    const pr = (event as unknown as PrEvent).data.pr;
    const previewUrl = `https://pr-${pr.number}.preview.${pr.repo.split("/")[0]}.dev`;

    // Phase 1: Planner
    const scenarios = await step.run("planner", async () => {
      const prompt = buildPlannerPrompt({
        prNumber: pr.number,
        prUrl: pr.url,
        diffSummary: `diff for PR #${pr.number}`,
        previewUrl,
        maxScenarios: env.MAX_SCENARIOS_PER_PR,
      });
      const { stdout } = await invokeCodex(prompt, { timeoutMs: 10 * 60 * 1000 });
      return parseJson<Scenario[]>(stdout).slice(0, env.MAX_SCENARIOS_PER_PR);
    });

    // Phase 2: Executors (fan-out)
    const results = await Promise.all(
      scenarios.map((scenario, idx) =>
        step.run(`executor-${idx}`, async () => {
          const prompt = buildExecutorPrompt({
            prNumber: pr.number,
            previewUrl,
            scenario,
          });
          const { stdout } = await invokeCodex(prompt, { timeoutMs: 10 * 60 * 1000 });
          return parseJson<ExecutorResult>(stdout);
        }),
      ),
    );

    // Phase 3: Reducer (in-process pure logic; ticket filing still goes through Codex/Linear MCP in a final step)
    const failures = results
      .filter((r) => !r.passed)
      .map((r) => ({
        ...r,
        signature: errorSignature({
          route: r.route,
          errorClass: r.errorClass,
          topFrame: r.topFrame,
        }),
      }));

    const outcome = await step.run("reducer", async () => {
      if (failures.length === 0) {
        return { status: "clean", failures: 0, filed: 0, commented: 0 };
      }

      // For v1, delegate dedup + ticket filing to Codex (it already has Linear MCP + PR comment access).
      // The partitionForDedup helper exists for later when we pull Linear tickets directly.
      const prompt = `You are the Hunter Reducer. The following failures were found on PR #${pr.number} (${pr.url}):

${JSON.stringify(failures, null, 2)}

For each failure:
1. Search Linear (via MCP) for open bug tickets created in the last 30 days whose body contains the failure's signature.
2. If a match exists, post a comment on that ticket: "Hunter hit this again on PR #${pr.number}. Evidence: <evidence>. Replay: <replayUrl>."
3. If no match, file a new Linear bug ticket following the structured-scenario format used by the Reproducer, tagged \`source:hunter\`. Include the signature in the body.

Then post ONE comment on the PR at ${pr.url} summarizing: N failures, which were new tickets vs. which were duplicates.

When done, print: REDUCER_DONE <filed_count> <commented_count>`;

      const { stdout } = await invokeCodex(prompt, { timeoutMs: 15 * 60 * 1000 });
      const m = stdout.match(/REDUCER_DONE\s+(\d+)\s+(\d+)/);
      return {
        status: "failures",
        failures: failures.length,
        filed: m ? parseInt(m[1], 10) : 0,
        commented: m ? parseInt(m[2], 10) : 0,
      };
    });

    return outcome;
  },
);
```

- [ ] **Step 3: Register in `src/inngest/index.ts`**

```ts
import { ping } from "./functions/ping";
import { onSentryIssue } from "./functions/onSentryIssue";
import { onLinearTicket } from "./functions/onLinearTicket";
import { onPrReadyForReview } from "./functions/onPrReadyForReview";

export const functions = [ping, onSentryIssue, onLinearTicket, onPrReadyForReview] as const;
```

- [ ] **Step 4: Verify + commit**

```bash
pnpm test && pnpm typecheck
git add src/inngest/functions/onPrReadyForReview.ts src/inngest/index.ts tests/inngest/onPrReadyForReview.test.ts
git commit -m "P3 task 7: on-pr-ready-for-review with planner/executor fan-out/reducer"
```

## P3 Task 8 — Manual end-to-end

- [ ] **Step 1:** Start stack.
- [ ] **Step 2:** POST a fake GitHub `pull_request.ready_for_review` webhook (same curl pattern as P1, header is `x-hub-signature-256: sha256=<hex>`, event header `x-github-event: pull_request`).
- [ ] **Step 3:** In Inngest dev UI, confirm the run executes: `planner` → `executor-0..executor-4` in parallel → `reducer`.
- [ ] **Step 4:** Check that per-PR concurrency key serializes a second event for the same PR number and allows different PR numbers in parallel.

## P3 Done Criteria

- [ ] Unit tests green, typecheck clean
- [ ] GitHub webhook filters to `ready_for_review` only
- [ ] `on-pr-ready-for-review` fans out to N executors in parallel
- [ ] Per-PR concurrency key works (second event for same PR serializes)
- [ ] End-to-end with real Codex posts a PR comment or files tickets (manual check)

---

# Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-04-15-incident-loop-plan.md`.**

Two execution options:

1. **Subagent-driven (recommended)** — I dispatch a fresh subagent per task, review between tasks. Cleanest for P0 → P3 in sequence because each task is genuinely independent.
2. **Inline execution** — Execute tasks in this session with checkpoints.

When ready, pick one and I'll start with **P0 Task 1**.
