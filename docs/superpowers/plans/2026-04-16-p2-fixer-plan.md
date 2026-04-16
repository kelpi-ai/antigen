# P2 Fixer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the P2 fixer flow so a bug-labeled Linear issue can trigger a durable Inngest workflow that fetches live ticket context via Linear MCP, writes a regression test first, proves red-green, proves the fix does not break already-correct behavior, optionally verifies browser-visible fixes with Chrome MCP, and opens a draft PR from an isolated git worktree.

**Architecture:** `/webhooks/linear` is an adapter that normalizes raw Linear webhooks into a repo-owned `linear/ticket.created` event carrying only routing fields. `on-linear-ticket` fetches live ticket context through Codex + Linear MCP, including browser / OS / viewport hints when they exist, creates a worktree, builds a TDD-enforcing fixer prompt, runs Codex in the worktree, parses a structured completion payload, and always removes the worktree in a `finally` path. The regression test in `tests/regressions/` is the durable knowledge base, and every successful run must also prove the fix did not regress already-correct behavior.

**Tech Stack:** TypeScript 5.x, Node 20+, pnpm, Inngest, Hono, zod, vitest, Codex CLI, Linear MCP, Chrome MCP

---

## File Structure

### Create

```text
src/
  codex/taggedJson.ts
  git/worktree.ts
  linear/fetchTicketContext.ts
  prompts/fixer.ts
  prompts/linearTicketContext.ts
  webhooks/linear.ts
  webhooks/verify.ts
  inngest/functions/onLinearTicket.ts

tests/
  codex/taggedJson.test.ts
  git/worktree.test.ts
  linear/fetchTicketContext.test.ts
  prompts/fixer.test.ts
  prompts/linearTicketContext.test.ts
  webhooks/linear.test.ts
  webhooks/verify.test.ts
  inngest/onLinearTicket.test.ts
```

### Modify

```text
src/config/env.ts
.env.example
src/inngest/index.ts
src/server.ts
README.md
tests/config/env.test.ts
tests/server.test.ts
```

### Responsibilities

- `src/webhooks/verify.ts` owns HMAC verification so the webhook route stays focused on payload normalization.
- `src/webhooks/linear.ts` converts the raw Linear webhook into the minimal repo-owned event shape `{ ticketId, identifier, module, url }`.
- `src/codex/taggedJson.ts` parses machine-readable one-line JSON output from Codex so both context-fetch and fixer completion share the same contract.
- `src/prompts/linearTicketContext.ts` asks Codex to use Linear MCP and return the latest ticket context, including environment hints, in a strict tagged JSON format.
- `src/linear/fetchTicketContext.ts` invokes Codex for the Linear MCP fetch and returns typed ticket context to the Inngest function.
- `src/git/worktree.ts` creates and removes isolated git worktrees for fixer runs.
- `src/prompts/fixer.ts` builds the main fixer prompt, including strict red-green requirements, a regression guard, the `systematic-debugging` fallback, and optional Chrome MCP verification.
- `src/inngest/functions/onLinearTicket.ts` sequences the durable workflow and owns cleanup.

## Task 1 — Extend Env For P2

**Files:**
- Modify: `src/config/env.ts`
- Modify: `.env.example`
- Modify: `tests/config/env.test.ts`

- [ ] **Step 1: Add the failing env test**

Append this test to `tests/config/env.test.ts`:

```ts
  it("parses Linear webhook + worktree vars", () => {
    process.env.INNGEST_EVENT_KEY = "x";
    process.env.INNGEST_SIGNING_KEY = "x";
    process.env.CODEX_BIN = "/usr/local/bin/codex";
    process.env.LINEAR_WEBHOOK_SECRET = "lin-sec";
    process.env.TARGET_REPO_PATH = "/tmp/target-repo";
    process.env.TARGET_REPO_WORKTREE_ROOT = "/tmp/worktrees";

    const env = loadEnv();
    expect(env.LINEAR_WEBHOOK_SECRET).toBe("lin-sec");
    expect(env.TARGET_REPO_PATH).toBe("/tmp/target-repo");
    expect(env.TARGET_REPO_WORKTREE_ROOT).toBe("/tmp/worktrees");
  });
```

- [ ] **Step 2: Run the env test to verify it fails**

Run:

```bash
pnpm test -- tests/config/env.test.ts
```

Expected: FAIL because `LINEAR_WEBHOOK_SECRET`, `TARGET_REPO_PATH`, and `TARGET_REPO_WORKTREE_ROOT` are not in `EnvSchema`.

- [ ] **Step 3: Extend the schema and example env file**

Update `src/config/env.ts`:

```ts
import { z } from "zod";

const EnvSchema = z.object({
  INNGEST_EVENT_KEY: z.string().min(1),
  INNGEST_SIGNING_KEY: z.string().min(1),
  CODEX_BIN: z.string().min(1),
  LINEAR_WEBHOOK_SECRET: z.string().min(1),
  TARGET_REPO_PATH: z.string().min(1),
  TARGET_REPO_WORKTREE_ROOT: z.string().min(1),
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

Update `.env.example`:

```dotenv
INNGEST_EVENT_KEY=
INNGEST_SIGNING_KEY=
CODEX_BIN=/usr/local/bin/codex
LINEAR_WEBHOOK_SECRET=
TARGET_REPO_PATH=/absolute/path/to/target/repo
TARGET_REPO_WORKTREE_ROOT=/tmp/incident-loop-worktrees
PORT=3000
```

- [ ] **Step 4: Run the env test again**

Run:

```bash
pnpm test -- tests/config/env.test.ts
```

Expected: PASS with all four env tests green.

- [ ] **Step 5: Commit**

```bash
git add src/config/env.ts .env.example tests/config/env.test.ts
git commit -m "P2 task 1: extend env for Linear webhook and worktrees"
```

## Task 2 — Add Reusable HMAC Verification Helper

**Files:**
- Create: `src/webhooks/verify.ts`
- Create: `tests/webhooks/verify.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/webhooks/verify.test.ts`:

```ts
import { createHmac } from "node:crypto";
import { describe, it, expect } from "vitest";
import { verifyHmacSha256 } from "../../src/webhooks/verify";

function sign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

describe("verifyHmacSha256", () => {
  const body = JSON.stringify({ ok: true });
  const secret = "shh";

  it("returns true for a valid signature", () => {
    expect(
      verifyHmacSha256({
        body,
        secret,
        signature: sign(body, secret),
      }),
    ).toBe(true);
  });

  it("returns false for an invalid signature", () => {
    expect(
      verifyHmacSha256({
        body,
        secret,
        signature: "deadbeef",
      }),
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run the helper test to verify it fails**

Run:

```bash
pnpm test -- tests/webhooks/verify.test.ts
```

Expected: FAIL because `src/webhooks/verify.ts` does not exist.

- [ ] **Step 3: Implement the helper**

Create `src/webhooks/verify.ts`:

```ts
import { createHmac, timingSafeEqual } from "node:crypto";

export interface VerifyHmacInput {
  body: string;
  signature: string;
  secret: string;
}

export function verifyHmacSha256({
  body,
  signature,
  secret,
}: VerifyHmacInput): boolean {
  const expected = createHmac("sha256", secret).update(body).digest("hex");
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);

  return (
    actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer)
  );
}
```

- [ ] **Step 4: Run the helper test again**

Run:

```bash
pnpm test -- tests/webhooks/verify.test.ts
```

Expected: PASS with both verification tests green.

- [ ] **Step 5: Commit**

```bash
git add src/webhooks/verify.ts tests/webhooks/verify.test.ts
git commit -m "P2 task 2: add reusable webhook signature verification"
```

## Task 3 — Parse Tagged JSON From Codex Output

**Files:**
- Create: `src/codex/taggedJson.ts`
- Create: `tests/codex/taggedJson.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/codex/taggedJson.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { extractTaggedJson } from "../../src/codex/taggedJson";

describe("extractTaggedJson", () => {
  it("parses a tagged JSON line", () => {
    const stdout = [
      "noise before",
      'FIXER_RESULT {"status":"ok","prUrl":"https://github.com/acme/repo/pull/1"}',
    ].join("\n");

    expect(extractTaggedJson<{ status: string; prUrl: string }>(stdout, "FIXER_RESULT"))
      .toEqual({
        status: "ok",
        prUrl: "https://github.com/acme/repo/pull/1",
      });
  });

  it("uses the last matching line", () => {
    const stdout = [
      'FIXER_RESULT {"status":"old"}',
      'FIXER_RESULT {"status":"new"}',
    ].join("\n");

    expect(extractTaggedJson<{ status: string }>(stdout, "FIXER_RESULT")).toEqual({
      status: "new",
    });
  });

  it("throws when the tagged line is missing", () => {
    expect(() => extractTaggedJson("plain output", "FIXER_RESULT"))
      .toThrow(/Missing FIXER_RESULT line/);
  });

  it("throws when the tagged JSON is invalid", () => {
    expect(() => extractTaggedJson("FIXER_RESULT not-json", "FIXER_RESULT"))
      .toThrow(/Invalid FIXER_RESULT JSON/);
  });
});
```

- [ ] **Step 2: Run the parser test to verify it fails**

Run:

```bash
pnpm test -- tests/codex/taggedJson.test.ts
```

Expected: FAIL because `src/codex/taggedJson.ts` does not exist.

- [ ] **Step 3: Implement the parser**

Create `src/codex/taggedJson.ts`:

```ts
export function extractTaggedJson<T>(stdout: string, tag: string): T {
  const prefix = `${tag} `;
  const line = stdout
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .reverse()
    .find((entry) => entry.startsWith(prefix));

  if (!line) {
    throw new Error(`Missing ${tag} line in Codex output`);
  }

  try {
    return JSON.parse(line.slice(prefix.length)) as T;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid ${tag} JSON: ${message}`);
  }
}
```

- [ ] **Step 4: Run the parser test again**

Run:

```bash
pnpm test -- tests/codex/taggedJson.test.ts
```

Expected: PASS with all parser tests green.

- [ ] **Step 5: Commit**

```bash
git add src/codex/taggedJson.ts tests/codex/taggedJson.test.ts
git commit -m "P2 task 3: parse tagged JSON from Codex output"
```

## Task 4 — Fetch Live Linear Ticket Context Through Codex

**Files:**
- Create: `src/prompts/linearTicketContext.ts`
- Create: `src/linear/fetchTicketContext.ts`
- Create: `tests/prompts/linearTicketContext.test.ts`
- Create: `tests/linear/fetchTicketContext.test.ts`

- [ ] **Step 1: Write the failing prompt-builder test**

Create `tests/prompts/linearTicketContext.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildLinearTicketContextPrompt } from "../../src/prompts/linearTicketContext";

describe("buildLinearTicketContextPrompt", () => {
  const input = {
    ticketId: "lin_123",
    identifier: "BUG-42",
    module: "checkout",
    url: "https://linear.app/acme/issue/BUG-42",
  };

  it("mentions the ticket id and identifier", () => {
    const prompt = buildLinearTicketContextPrompt(input);
    expect(prompt).toContain("lin_123");
    expect(prompt).toContain("BUG-42");
  });

  it("requires Linear MCP and exact tagged output", () => {
    const prompt = buildLinearTicketContextPrompt(input);
    expect(prompt).toMatch(/Linear MCP/i);
    expect(prompt).toContain("LINEAR_TICKET_CONTEXT");
  });

  it("asks for browser visibility, environment hints, and similar issue context", () => {
    const prompt = buildLinearTicketContextPrompt(input);
    expect(prompt).toMatch(/browser-visible/i);
    expect(prompt).toMatch(/viewport/i);
    expect(prompt).toMatch(/browser/i);
    expect(prompt).toMatch(/similar issue/i);
  });
});
```

- [ ] **Step 2: Write the failing fetcher test**

Create `tests/linear/fetchTicketContext.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/codex/invoke", () => ({
  invokeCodex: vi.fn(),
}));

import { invokeCodex } from "../../src/codex/invoke";
import { fetchLinearTicketContext } from "../../src/linear/fetchTicketContext";

describe("fetchLinearTicketContext", () => {
  beforeEach(() => {
    vi.mocked(invokeCodex).mockReset();
  });

  it("returns parsed ticket context", async () => {
    vi.mocked(invokeCodex).mockResolvedValue({
      stdout: [
        "some logs",
        'LINEAR_TICKET_CONTEXT {"ticketId":"lin_123","identifier":"BUG-42","url":"https://linear.app/acme/issue/BUG-42","title":"Checkout crash","body":"Reproduction steps: 1. Open checkout","module":"checkout","browserVisible":true,"similarIssueContext":"BUG-12 had the same cart flow","environmentHints":{"browser":"webkit","os":"macos","viewport":"390x844"}}',
      ].join("\n"),
      stderr: "",
      exitCode: 0,
    });

    const result = await fetchLinearTicketContext({
      ticketId: "lin_123",
      identifier: "BUG-42",
      module: "checkout",
      url: "https://linear.app/acme/issue/BUG-42",
    });

    expect(result.title).toBe("Checkout crash");
    expect(result.browserVisible).toBe(true);
    expect(result.environmentHints.browser).toBe("webkit");
    expect(invokeCodex).toHaveBeenCalledWith(
      expect.stringContaining("LINEAR_TICKET_CONTEXT"),
      expect.objectContaining({ timeoutMs: 300000 }),
    );
  });

  it("falls back to the event module when the fetched module is empty", async () => {
    vi.mocked(invokeCodex).mockResolvedValue({
      stdout: 'LINEAR_TICKET_CONTEXT {"ticketId":"lin_123","identifier":"BUG-42","url":"https://linear.app/acme/issue/BUG-42","title":"Checkout crash","body":"Reproduction steps: 1. Open checkout","module":"","browserVisible":false,"similarIssueContext":"","environmentHints":{"browser":"","os":"","viewport":""}}',
      stderr: "",
      exitCode: 0,
    });

    const result = await fetchLinearTicketContext({
      ticketId: "lin_123",
      identifier: "BUG-42",
      module: "unknown",
      url: "https://linear.app/acme/issue/BUG-42",
    });

    expect(result.module).toBe("unknown");
  });
});
```

- [ ] **Step 3: Run the new tests to verify they fail**

Run:

```bash
pnpm test -- tests/prompts/linearTicketContext.test.ts tests/linear/fetchTicketContext.test.ts
```

Expected: FAIL because the new prompt and fetcher modules do not exist.

- [ ] **Step 4: Implement the Linear ticket context prompt**

Create `src/prompts/linearTicketContext.ts`:

```ts
export interface LinearTicketSeed {
  ticketId: string;
  identifier: string;
  module: string;
  url: string;
}

export function buildLinearTicketContextPrompt(input: LinearTicketSeed): string {
  return `You are gathering live Linear ticket context for the incident-loop fixer.

Use the Linear MCP to inspect ticket ${input.ticketId} (${input.identifier}) at ${input.url}.
Do not modify the ticket. Read the description, comments, labels, and any similar-issue references linked from the ticket.

Return exactly one line and nothing after it:
LINEAR_TICKET_CONTEXT {"ticketId":"${input.ticketId}","identifier":"${input.identifier}","url":"${input.url}","title":"...","body":"...","module":"...","browserVisible":true,"similarIssueContext":"...","environmentHints":{"browser":"...","os":"...","viewport":"..."}}

Rules:
- "body" should preserve the most useful reproduction details you found.
- "module" should use the best `module:*` label you can confirm. If you cannot improve on the incoming hint, return "${input.module}".
- "browserVisible" should be true only when the bug is meaningfully visible in a browser flow.
- "similarIssueContext" should summarize only relevant prior issue context. Return "" when none exists.
- "environmentHints" should carry the best browser / OS / viewport clues you can confirm from the ticket. Use empty strings when unavailable.
- No markdown fences.
- No explanation before or after the tagged line.
`;
}
```

- [ ] **Step 5: Implement the typed fetcher**

Create `src/linear/fetchTicketContext.ts`:

```ts
import { invokeCodex } from "../codex/invoke";
import { extractTaggedJson } from "../codex/taggedJson";
import {
  buildLinearTicketContextPrompt,
  type LinearTicketSeed,
} from "../prompts/linearTicketContext";

export interface LinearTicketContext extends LinearTicketSeed {
  title: string;
  body: string;
  browserVisible: boolean;
  similarIssueContext: string;
  environmentHints: {
    browser: string;
    os: string;
    viewport: string;
  };
}

type ParsedLinearTicketContext = Omit<LinearTicketContext, "module"> & {
  module?: string;
};

export async function fetchLinearTicketContext(
  input: LinearTicketSeed,
): Promise<LinearTicketContext> {
  const { stdout } = await invokeCodex(buildLinearTicketContextPrompt(input), {
    timeoutMs: 5 * 60 * 1000,
  });

  const parsed = extractTaggedJson<ParsedLinearTicketContext>(
    stdout,
    "LINEAR_TICKET_CONTEXT",
  );

  return {
    ...parsed,
    module: parsed.module || input.module,
  };
}
```

- [ ] **Step 6: Run the prompt and fetcher tests again**

Run:

```bash
pnpm test -- tests/prompts/linearTicketContext.test.ts tests/linear/fetchTicketContext.test.ts
```

Expected: PASS with all five tests green.

- [ ] **Step 7: Commit**

```bash
git add src/prompts/linearTicketContext.ts src/linear/fetchTicketContext.ts tests/prompts/linearTicketContext.test.ts tests/linear/fetchTicketContext.test.ts
git commit -m "P2 task 4: fetch live ticket context through Codex and Linear MCP"
```

## Task 5 — Create Git Worktree Helper

**Files:**
- Create: `src/git/worktree.ts`
- Create: `tests/git/worktree.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/git/worktree.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";

const spawnMock = vi.fn();
vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

import { createWorktree, removeWorktree } from "../../src/git/worktree";

function fakeProc(exitCode: number, stderr = ""): unknown {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
  };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();

  setImmediate(() => {
    if (stderr) {
      proc.stderr.emit("data", Buffer.from(stderr));
    }
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
    process.env.LINEAR_WEBHOOK_SECRET = "x";
    process.env.TARGET_REPO_PATH = "/tmp/target";
    process.env.TARGET_REPO_WORKTREE_ROOT = "/tmp/wt";
  });

  it("creates a worktree with a branch named after the ticket", async () => {
    spawnMock.mockReturnValue(fakeProc(0));
    const wt = await createWorktree("BUG-42");

    expect(wt.path).toMatch(/\/tmp\/wt\/BUG-42-/);
    expect(wt.branch).toMatch(/^fix\/BUG-42-/);
    expect(spawnMock).toHaveBeenCalledWith(
      "git",
      expect.arrayContaining(["worktree", "add", "-b", wt.branch, wt.path]),
      expect.objectContaining({ cwd: "/tmp/target" }),
    );
  });

  it("rejects on git failure", async () => {
    spawnMock.mockReturnValue(fakeProc(1, "fatal: boom"));
    await expect(createWorktree("BUG-42")).rejects.toThrow(/git worktree add.*boom/);
  });

  it("removes a worktree", async () => {
    spawnMock.mockReturnValue(fakeProc(0));
    await removeWorktree("/tmp/wt/BUG-42-abcd");
    expect(spawnMock).toHaveBeenCalledWith(
      "git",
      ["worktree", "remove", "--force", "/tmp/wt/BUG-42-abcd"],
      expect.objectContaining({ cwd: "/tmp/target" }),
    );
  });
});
```

- [ ] **Step 2: Run the worktree test to verify it fails**

Run:

```bash
pnpm test -- tests/git/worktree.test.ts
```

Expected: FAIL because `src/git/worktree.ts` does not exist.

- [ ] **Step 3: Implement the helper**

Create `src/git/worktree.ts`:

```ts
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { env } from "../config/env";

export interface Worktree {
  path: string;
  branch: string;
}

function runGit(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("git", args, {
      cwd: env.TARGET_REPO_PATH,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stderr = "";
    proc.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`git ${args.join(" ")} failed: ${stderr.trim()}`));
      }
    });

    proc.on("error", reject);
  });
}

export async function createWorktree(ticketId: string): Promise<Worktree> {
  const suffix = randomBytes(4).toString("hex");
  const path = join(env.TARGET_REPO_WORKTREE_ROOT, `${ticketId}-${suffix}`);
  const branch = `fix/${ticketId}-${suffix}`;

  await runGit(["worktree", "add", "-b", branch, path]);
  return { path, branch };
}

export async function removeWorktree(path: string): Promise<void> {
  await runGit(["worktree", "remove", "--force", path]);
}
```

- [ ] **Step 4: Run the worktree test again**

Run:

```bash
pnpm test -- tests/git/worktree.test.ts
```

Expected: PASS with all worktree tests green.

- [ ] **Step 5: Commit**

```bash
git add src/git/worktree.ts tests/git/worktree.test.ts
git commit -m "P2 task 5: add git worktree helper"
```

## Task 6 — Build The Fixer Prompt And Structured Completion Contract

**Files:**
- Create: `src/prompts/fixer.ts`
- Create: `tests/prompts/fixer.test.ts`

- [ ] **Step 1: Write the failing prompt contract test**

Create `tests/prompts/fixer.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildFixerPrompt } from "../../src/prompts/fixer";

describe("buildFixerPrompt", () => {
  const ticket = {
    ticketId: "lin_123",
    identifier: "BUG-42",
    url: "https://linear.app/acme/issue/BUG-42",
    title: "Checkout crash",
    body: "Reproduction steps: 1. Open checkout",
    module: "checkout",
    browserVisible: true,
    similarIssueContext: "BUG-12 had the same cart flow",
    environmentHints: {
      browser: "webkit",
      os: "macos",
      viewport: "390x844",
    },
  };
  const worktreePath = "/tmp/wt/BUG-42-abcd";
  const branch = "fix/BUG-42-abcd";

  it("includes ticket context and worktree metadata", () => {
    const prompt = buildFixerPrompt({ ticket, worktreePath, branch });
    expect(prompt).toContain(ticket.identifier);
    expect(prompt).toContain(ticket.url);
    expect(prompt).toContain(ticket.body);
    expect(prompt).toContain(worktreePath);
    expect(prompt).toContain(branch);
  });

  it("requires red-green discipline and systematic debugging fallback", () => {
    const prompt = buildFixerPrompt({ ticket, worktreePath, branch });
    expect(prompt).toMatch(/red/i);
    expect(prompt).toMatch(/green/i);
    expect(prompt).toMatch(/systematic-debugging/i);
  });

  it("requires a regression guard so the fix does not break working behavior", () => {
    const prompt = buildFixerPrompt({ ticket, worktreePath, branch });
    expect(prompt).toMatch(/regression guard/i);
    expect(prompt).toMatch(/already-correct behavior/i);
  });

  it("treats tests/regressions as the knowledge base", () => {
    const prompt = buildFixerPrompt({ ticket, worktreePath, branch });
    expect(prompt).toContain("tests/regressions/");
    expect(prompt).toMatch(/knowledge base/i);
  });

  it("requires a FIXER_RESULT payload", () => {
    const prompt = buildFixerPrompt({ ticket, worktreePath, branch });
    expect(prompt).toContain("FIXER_RESULT");
    expect(prompt).toContain('"redEvidence"');
    expect(prompt).toContain('"greenEvidence"');
    expect(prompt).toContain('"regressionGuardEvidence"');
  });

  it("mentions Chrome MCP when the bug is browser-visible", () => {
    const prompt = buildFixerPrompt({ ticket, worktreePath, branch });
    expect(prompt).toMatch(/Chrome MCP/i);
    expect(prompt).toMatch(/accessibility tree diff/i);
    expect(prompt).toMatch(/webkit/i);
    expect(prompt).toMatch(/390x844/i);
  });

  it("omits Chrome MCP instructions for non-browser-visible bugs", () => {
    const prompt = buildFixerPrompt({
      ticket: { ...ticket, browserVisible: false },
      worktreePath,
      branch,
    });
    expect(prompt).not.toMatch(/Use Chrome MCP/i);
  });
});
```

- [ ] **Step 2: Run the prompt contract test to verify it fails**

Run:

```bash
pnpm test -- tests/prompts/fixer.test.ts
```

Expected: FAIL because `src/prompts/fixer.ts` does not exist.

- [ ] **Step 3: Implement the fixer prompt**

Create `src/prompts/fixer.ts`:

```ts
import type { LinearTicketContext } from "../linear/fetchTicketContext";

export interface FixerInput {
  ticket: LinearTicketContext;
  worktreePath: string;
  branch: string;
}

export interface FixerCompletion {
  status: "ok";
  prUrl: string;
  testPath: string;
  redEvidence: string;
  greenEvidence: string;
  regressionGuardEvidence: string;
  chromeEvidence?: string;
}

export function buildFixerPrompt({
  ticket,
  worktreePath,
  branch,
}: FixerInput): string {
  const testPath = `tests/regressions/${ticket.identifier.toLowerCase()}.spec.ts`;
  const similarIssueContext = ticket.similarIssueContext || "none";
  const environmentHints = [
    `- Browser hint: ${ticket.environmentHints.browser || "unknown"}`,
    `- OS hint: ${ticket.environmentHints.os || "unknown"}`,
    `- Viewport hint: ${ticket.environmentHints.viewport || "unknown"}`,
  ].join("\n");
  const chromeSection = ticket.browserVisible
    ? "8. Use Chrome MCP to verify the browser-visible fix and capture concise evidence. Match the browser and viewport hints above as closely as possible. If the issue points to Safari, use Playwright WebKit. For layout shifts, missing elements, or broken CSS, include accessibility tree diff evidence."
    : "8. Chrome MCP is optional for this ticket because the current context does not clearly indicate a browser-visible bug.";

  return `You are the Incident Fixer for the incident-loop system.

The regression test is the durable knowledge base for future bug prevention. Your job is to convert this incident into a focused regression test, prove the test fails, apply the minimal fix, prove the test passes, and open a draft PR.

## Ticket
- Linear ticket ID: ${ticket.ticketId}
- Identifier: ${ticket.identifier}
- URL: ${ticket.url}
- Title: ${ticket.title}
- Module: ${ticket.module}
- Similar issue context: ${similarIssueContext}

## Environment hints
${environmentHints}

## Ticket body
\`\`\`
${ticket.body}
\`\`\`

## Workspace
- Worktree path: ${worktreePath}
- Branch: ${branch}
- Regression test path: ${testPath}

## Procedure
1. cd into ${worktreePath}.
2. Write ${testPath} first. It must be a focused regression test for this incident.
3. Run the regression test and capture the failing output.
4. If the reproduction is ambiguous, flaky, or the failure is not trustworthy, stop fixing and switch into the systematic-debugging skill workflow until the failure is clear.
5. Write the minimal fix.
6. Run the regression test again and capture the passing output.
7. Run a focused regression guard against behavior that was already correct before the fix. The fix must not introduce new errors into working paths. Capture concise evidence from that guard step.
${chromeSection}
9. Create one commit containing the regression test and the fix.
10. Push ${branch}.
11. Open a draft PR. The PR body must include:
   - the Linear ticket URL
   - the red run output
   - the green run output
   - the regression-guard evidence
   - a short fix summary
   - Chrome verification evidence when you used Chrome MCP
12. Print exactly one line and nothing after it:
FIXER_RESULT {"status":"ok","prUrl":"https://github.com/org/repo/pull/123","testPath":"${testPath}","redEvidence":"...","greenEvidence":"...","regressionGuardEvidence":"...","chromeEvidence":"..."}

## Hard constraints
- The test must be written before the fix.
- If the test passes before the fix, the test is wrong. Rewrite it or use systematic-debugging.
- The PR must stay draft.
- Only modify files inside ${worktreePath}.
- If Chrome MCP is not used, omit "chromeEvidence" from the JSON instead of inventing it.
`;
}
```

- [ ] **Step 4: Run the prompt contract test again**

Run:

```bash
pnpm test -- tests/prompts/fixer.test.ts
```

Expected: PASS with all seven prompt tests green.

- [ ] **Step 5: Commit**

```bash
git add src/prompts/fixer.ts tests/prompts/fixer.test.ts
git commit -m "P2 task 6: add fixer prompt with structured completion contract"
```

## Task 7 — Add The Linear Webhook Adapter

**Files:**
- Create: `src/webhooks/linear.ts`
- Create: `tests/webhooks/linear.test.ts`
- Modify: `src/server.ts`
- Modify: `tests/server.test.ts`

- [ ] **Step 1: Write the failing webhook test**

Create `tests/webhooks/linear.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHmac } from "node:crypto";
import { Hono } from "hono";

const sendMock = vi.fn();
vi.mock("../../src/inngest/client", () => ({
  inngest: { send: (...args: unknown[]) => sendMock(...args) },
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
    process.env.LINEAR_WEBHOOK_SECRET = secret;
    process.env.TARGET_REPO_PATH = "/tmp/target";
    process.env.TARGET_REPO_WORKTREE_ROOT = "/tmp/wt";
  });

  const bugBody = JSON.stringify({
    action: "create",
    type: "Issue",
    data: {
      id: "lin_123",
      identifier: "BUG-42",
      url: "https://linear.app/acme/issue/BUG-42",
      title: "Checkout crash",
      labels: [{ name: "bug" }, { name: "module:checkout" }],
    },
  });

  it("rejects bad signatures", async () => {
    const app = new Hono();
    mountLinearWebhook(app);

    const res = await app.request("/webhooks/linear", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "linear-signature": "deadbeef",
      },
      body: bugBody,
    });

    expect(res.status).toBe(401);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("emits a normalized event for bug-labeled issue creates", async () => {
    const app = new Hono();
    mountLinearWebhook(app);

    const res = await app.request("/webhooks/linear", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "linear-signature": sign(bugBody, secret),
      },
      body: bugBody,
    });

    expect(res.status).toBe(202);
    expect(sendMock).toHaveBeenCalledWith({
      name: "linear/ticket.created",
      data: {
        ticketId: "lin_123",
        identifier: "BUG-42",
        module: "checkout",
        url: "https://linear.app/acme/issue/BUG-42",
      },
    });
  });

  it("falls back to unknown when no module label is present", async () => {
    const app = new Hono();
    mountLinearWebhook(app);

    const body = JSON.stringify({
      action: "create",
      type: "Issue",
      data: {
        id: "lin_124",
        identifier: "BUG-43",
        url: "https://linear.app/acme/issue/BUG-43",
        title: "Missing module",
        labels: [{ name: "bug" }],
      },
    });

    const res = await app.request("/webhooks/linear", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "linear-signature": sign(body, secret),
      },
      body,
    });

    expect(res.status).toBe(202);
    expect(sendMock).toHaveBeenCalledWith({
      name: "linear/ticket.created",
      data: expect.objectContaining({ module: "unknown" }),
    });
  });

  it("ignores non-bug tickets", async () => {
    const app = new Hono();
    mountLinearWebhook(app);

    const body = JSON.stringify({
      action: "create",
      type: "Issue",
      data: {
        id: "lin_125",
        identifier: "FEAT-1",
        url: "https://linear.app/acme/issue/FEAT-1",
        title: "Feature request",
        labels: [{ name: "feature" }],
      },
    });

    const res = await app.request("/webhooks/linear", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "linear-signature": sign(body, secret),
      },
      body,
    });

    expect(res.status).toBe(204);
    expect(sendMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the webhook test to verify it fails**

Run:

```bash
pnpm test -- tests/webhooks/linear.test.ts
```

Expected: FAIL because `src/webhooks/linear.ts` does not exist.

- [ ] **Step 3: Implement the webhook adapter**

Create `src/webhooks/linear.ts`:

```ts
import type { Hono } from "hono";
import { env } from "../config/env";
import { inngest } from "../inngest/client";
import { verifyHmacSha256 } from "./verify";

interface LinearLabel {
  name: string;
}

interface LinearIssueData {
  id: string;
  identifier: string;
  url: string;
  title: string;
  labels?: LinearLabel[];
}

function extractModule(labels: LinearLabel[]): string {
  const moduleLabel = labels.find((label) => label.name.startsWith("module:"));
  return moduleLabel ? moduleLabel.name.slice("module:".length) : "unknown";
}

export function mountLinearWebhook(app: Hono): void {
  app.post("/webhooks/linear", async (c) => {
    const signature = c.req.header("linear-signature") ?? "";
    const body = await c.req.text();

    if (
      !verifyHmacSha256({
        body,
        signature,
        secret: env.LINEAR_WEBHOOK_SECRET,
      })
    ) {
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
    const isBug = labels.some((label) => label.name === "bug");
    if (!isBug) {
      return c.body(null, 204);
    }

    await inngest.send({
      name: "linear/ticket.created",
      data: {
        ticketId: parsed.data.id,
        identifier: parsed.data.identifier,
        module: extractModule(labels),
        url: parsed.data.url,
      },
    });

    return c.json({ accepted: true }, 202);
  });
}
```

- [ ] **Step 4: Mount the webhook in the server and update the smoke test env**

Update `src/server.ts`:

```ts
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { serve as inngestServe } from "inngest/hono";
import { pathToFileURL } from "node:url";
import { inngest } from "./inngest/client";
import { functions } from "./inngest";
import { env } from "./config/env";
import { mountLinearWebhook } from "./webhooks/linear";

export function buildApp(): Hono {
  const app = new Hono();
  app.get("/health", (c) => c.json({ ok: true }));
  mountLinearWebhook(app);
  app.on(
    ["GET", "POST", "PUT"],
    "/api/inngest",
    inngestServe({ client: inngest, functions: [...functions] }),
  );
  return app;
}

const isMainModule = process.argv[1]
  ? pathToFileURL(process.argv[1]).href === import.meta.url
  : false;

if (isMainModule) {
  const app = buildApp();
  serve({ fetch: app.fetch, port: env.PORT }, (info) => {
    console.log(`Server on http://localhost:${info.port}`);
    console.log(`Inngest: http://localhost:${info.port}/api/inngest`);
  });
}
```

Update the `beforeEach` block in `tests/server.test.ts`:

```ts
  beforeEach(() => {
    process.env.INNGEST_EVENT_KEY = "test";
    process.env.INNGEST_SIGNING_KEY = "test";
    process.env.CODEX_BIN = "/usr/local/bin/codex";
    process.env.LINEAR_WEBHOOK_SECRET = "lin-sec";
    process.env.TARGET_REPO_PATH = "/tmp/target";
    process.env.TARGET_REPO_WORKTREE_ROOT = "/tmp/wt";
  });
```

- [ ] **Step 5: Run the webhook and server tests again**

Run:

```bash
pnpm test -- tests/webhooks/linear.test.ts tests/server.test.ts
```

Expected: PASS with webhook behavior covered and the existing server smoke tests still green.

- [ ] **Step 6: Commit**

```bash
git add src/webhooks/linear.ts src/server.ts tests/webhooks/linear.test.ts tests/server.test.ts
git commit -m "P2 task 7: add Linear webhook adapter"
```

## Task 8 — Implement The Durable `on-linear-ticket` Flow

**Files:**
- Create: `src/inngest/functions/onLinearTicket.ts`
- Create: `tests/inngest/onLinearTicket.test.ts`
- Modify: `src/inngest/index.ts`

- [ ] **Step 1: Write the failing function test**

Create `tests/inngest/onLinearTicket.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/linear/fetchTicketContext", () => ({
  fetchLinearTicketContext: vi.fn(),
}));
vi.mock("../../src/git/worktree", () => ({
  createWorktree: vi.fn(),
  removeWorktree: vi.fn(),
}));
vi.mock("../../src/codex/invoke", () => ({
  invokeCodex: vi.fn(),
}));

import { fetchLinearTicketContext } from "../../src/linear/fetchTicketContext";
import { createWorktree, removeWorktree } from "../../src/git/worktree";
import { invokeCodex } from "../../src/codex/invoke";
import {
  onLinearTicket,
  runLinearTicketFlow,
} from "../../src/inngest/functions/onLinearTicket";
import { functions } from "../../src/inngest";

function createStepRecorder() {
  const order: string[] = [];
  return {
    order,
    step: {
      run: async <T>(id: string, fn: () => Promise<T> | T): Promise<T> => {
        order.push(id);
        return await fn();
      },
    },
  };
}

describe("onLinearTicket", () => {
  const event = {
    data: {
      ticketId: "lin_123",
      identifier: "BUG-42",
      module: "checkout",
      url: "https://linear.app/acme/issue/BUG-42",
    },
  };

  beforeEach(() => {
    vi.mocked(fetchLinearTicketContext).mockReset();
    vi.mocked(createWorktree).mockReset();
    vi.mocked(removeWorktree).mockReset();
    vi.mocked(invokeCodex).mockReset();
  });

  it("has id 'on-linear-ticket'", () => {
    expect(onLinearTicket.id()).toBe("on-linear-ticket");
  });

  it("is registered in the barrel", () => {
    expect(functions).toContain(onLinearTicket);
  });

  it("fetches context before creating the worktree and returns the parsed result", async () => {
    vi.mocked(fetchLinearTicketContext).mockResolvedValue({
      ticketId: "lin_123",
      identifier: "BUG-42",
      module: "checkout",
      url: "https://linear.app/acme/issue/BUG-42",
      title: "Checkout crash",
      body: "Reproduction steps: 1. Open checkout",
      browserVisible: true,
      similarIssueContext: "BUG-12 had the same cart flow",
      environmentHints: {
        browser: "webkit",
        os: "macos",
        viewport: "390x844",
      },
    });
    vi.mocked(createWorktree).mockResolvedValue({
      path: "/tmp/wt/BUG-42-abcd",
      branch: "fix/BUG-42-abcd",
    });
    vi.mocked(invokeCodex).mockResolvedValue({
      stdout: 'FIXER_RESULT {"status":"ok","prUrl":"https://github.com/acme/repo/pull/1","testPath":"tests/regressions/bug-42.spec.ts","redEvidence":"Expected 500","greenEvidence":"1 passed","regressionGuardEvidence":"Checkout total and button layout unchanged","chromeEvidence":"Checkout succeeds"}',
      stderr: "",
      exitCode: 0,
    });
    vi.mocked(removeWorktree).mockResolvedValue();

    const { order, step } = createStepRecorder();
    const result = await runLinearTicketFlow({ event, step });

    expect(order.slice(0, 3)).toEqual([
      "fetch-ticket-context",
      "create-worktree",
      "build-prompt",
    ]);
    expect(result.prUrl).toBe("https://github.com/acme/repo/pull/1");
    expect(removeWorktree).toHaveBeenCalledWith("/tmp/wt/BUG-42-abcd");
  });

  it("does not create a worktree when ticket context fetch fails", async () => {
    vi.mocked(fetchLinearTicketContext).mockRejectedValue(
      new Error("linear mcp unavailable"),
    );

    const { step } = createStepRecorder();
    await expect(runLinearTicketFlow({ event, step })).rejects.toThrow(
      /linear mcp unavailable/,
    );

    expect(createWorktree).not.toHaveBeenCalled();
    expect(removeWorktree).not.toHaveBeenCalled();
  });

  it("removes the worktree when Codex fails", async () => {
    vi.mocked(fetchLinearTicketContext).mockResolvedValue({
      ticketId: "lin_123",
      identifier: "BUG-42",
      module: "checkout",
      url: "https://linear.app/acme/issue/BUG-42",
      title: "Checkout crash",
      body: "Reproduction steps: 1. Open checkout",
      browserVisible: false,
      similarIssueContext: "",
      environmentHints: {
        browser: "",
        os: "",
        viewport: "",
      },
    });
    vi.mocked(createWorktree).mockResolvedValue({
      path: "/tmp/wt/BUG-42-abcd",
      branch: "fix/BUG-42-abcd",
    });
    vi.mocked(invokeCodex).mockRejectedValue(new Error("codex exited 1: boom"));
    vi.mocked(removeWorktree).mockResolvedValue();

    const { step } = createStepRecorder();
    await expect(runLinearTicketFlow({ event, step })).rejects.toThrow(
      /codex exited 1: boom/,
    );

    expect(removeWorktree).toHaveBeenCalledWith("/tmp/wt/BUG-42-abcd");
  });

  it("fails when FIXER_RESULT is missing required proof", async () => {
    vi.mocked(fetchLinearTicketContext).mockResolvedValue({
      ticketId: "lin_123",
      identifier: "BUG-42",
      module: "checkout",
      url: "https://linear.app/acme/issue/BUG-42",
      title: "Checkout crash",
      body: "Reproduction steps: 1. Open checkout",
      browserVisible: false,
      similarIssueContext: "",
      environmentHints: {
        browser: "",
        os: "",
        viewport: "",
      },
    });
    vi.mocked(createWorktree).mockResolvedValue({
      path: "/tmp/wt/BUG-42-abcd",
      branch: "fix/BUG-42-abcd",
    });
    vi.mocked(invokeCodex).mockResolvedValue({
      stdout: 'FIXER_RESULT {"status":"ok","prUrl":"https://github.com/acme/repo/pull/1","testPath":"tests/regressions/bug-42.spec.ts","redEvidence":"Expected 500","greenEvidence":"1 passed","regressionGuardEvidence":""}',
      stderr: "",
      exitCode: 0,
    });
    vi.mocked(removeWorktree).mockResolvedValue();

    const { step } = createStepRecorder();
    await expect(runLinearTicketFlow({ event, step })).rejects.toThrow(
      /Incomplete FIXER_RESULT payload/,
    );
  });
});
```

- [ ] **Step 2: Run the function test to verify it fails**

Run:

```bash
pnpm test -- tests/inngest/onLinearTicket.test.ts
```

Expected: FAIL because `src/inngest/functions/onLinearTicket.ts` does not exist.

- [ ] **Step 3: Implement the function**

Create `src/inngest/functions/onLinearTicket.ts`:

```ts
import { invokeCodex } from "../../codex/invoke";
import { extractTaggedJson } from "../../codex/taggedJson";
import { createWorktree, removeWorktree } from "../../git/worktree";
import {
  fetchLinearTicketContext,
  type LinearTicketSeed,
} from "../../linear/fetchTicketContext";
import {
  buildFixerPrompt,
  type FixerCompletion,
} from "../../prompts/fixer";
import { inngest } from "../client";

export interface LinearTicketCreatedEvent {
  data: LinearTicketSeed;
}

interface StepLike {
  run<T>(id: string, fn: () => Promise<T> | T): Promise<T>;
}

export async function runLinearTicketFlow({
  event,
  step,
}: {
  event: LinearTicketCreatedEvent;
  step: StepLike;
}): Promise<FixerCompletion> {
  const seed = event.data;

  const ticket = await step.run("fetch-ticket-context", () =>
    fetchLinearTicketContext(seed),
  );

  const worktree = await step.run("create-worktree", () =>
    createWorktree(seed.identifier),
  );

  try {
    const prompt = await step.run("build-prompt", () =>
      buildFixerPrompt({
        ticket,
        worktreePath: worktree.path,
        branch: worktree.branch,
      }),
    );

    const stdout = await step.run("invoke-codex", async () => {
      const result = await invokeCodex(prompt, {
        cwd: worktree.path,
        timeoutMs: 30 * 60 * 1000,
      });
      return result.stdout;
    });

    const completion = await step.run("parse-result", () =>
      extractTaggedJson<FixerCompletion>(stdout, "FIXER_RESULT"),
    );

    if (
      completion.status !== "ok" ||
      !completion.prUrl ||
      !completion.redEvidence ||
      !completion.greenEvidence ||
      !completion.regressionGuardEvidence
    ) {
      throw new Error("Incomplete FIXER_RESULT payload");
    }

    return completion;
  } finally {
    await step.run("remove-worktree", () => removeWorktree(worktree.path));
  }
}

export const onLinearTicket = inngest.createFunction(
  {
    id: "on-linear-ticket",
    retries: 1,
    concurrency: [
      { key: "event.data.module", limit: 1 },
      { limit: 5 },
    ],
  },
  { event: "linear/ticket.created" },
  async ({ event, step }) => runLinearTicketFlow({
    event: event as LinearTicketCreatedEvent,
    step,
  }),
);
```

- [ ] **Step 4: Register the function**

Update `src/inngest/index.ts`:

```ts
import { ping } from "./functions/ping";
import { onLinearTicket } from "./functions/onLinearTicket";

export const functions = [ping, onLinearTicket] as const;
```

- [ ] **Step 5: Run the function test and a full type-aware verification pass**

Run:

```bash
pnpm test -- tests/inngest/onLinearTicket.test.ts
pnpm test
pnpm typecheck
```

Expected:

- `tests/inngest/onLinearTicket.test.ts`: PASS
- `pnpm test`: PASS across the full suite
- `pnpm typecheck`: PASS with no TypeScript errors

- [ ] **Step 6: Commit**

```bash
git add src/inngest/functions/onLinearTicket.ts src/inngest/index.ts tests/inngest/onLinearTicket.test.ts
git commit -m "P2 task 8: add durable on-linear-ticket workflow"
```

## Task 9 — Document And Manually Validate P2

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add P2 setup and manual validation notes to the README**

Append this section to `README.md`:

```md
## P2 local validation

Additional env vars for the fixer flow:

- `LINEAR_WEBHOOK_SECRET`
- `TARGET_REPO_PATH`
- `TARGET_REPO_WORKTREE_ROOT`

Manual webhook smoke test:

1. Start `npx inngest-cli@latest dev`
2. Start `pnpm dev`
3. Create a bug-labeled Linear issue
4. POST a signed Linear webhook to `/webhooks/linear`
5. Confirm `linear/ticket.created` appears in Inngest and the fixer run cleans up its worktree
6. For browser-specific bugs, confirm the ticket context includes browser, OS, and viewport hints
```

- [ ] **Step 2: Re-run the automated suite after the docs change**

Run:

```bash
pnpm test
pnpm typecheck
```

Expected: PASS. The README change should not affect code or test behavior.

- [ ] **Step 3: Run the manual webhook smoke test**

Use a real target repo for `TARGET_REPO_PATH`, then run:

```bash
mkdir -p /tmp/incident-loop-worktrees
```

Prepare the request body:

```bash
BODY='{"action":"create","type":"Issue","data":{"id":"lin_123","identifier":"BUG-42","url":"https://linear.app/acme/issue/BUG-42","title":"Checkout crash","labels":[{"name":"bug"},{"name":"module:checkout"}]}}'
```

Compute the signature:

```bash
SIG=$(node -e 'const { createHmac } = require("node:crypto"); process.stdout.write(createHmac("sha256", process.argv[2]).update(process.argv[1]).digest("hex"));' "$BODY" "$LINEAR_WEBHOOK_SECRET")
```

Send the webhook:

```bash
curl -i \
  http://localhost:3000/webhooks/linear \
  -H "content-type: application/json" \
  -H "linear-signature: $SIG" \
  --data "$BODY"
```

Expected:

- HTTP response: `202 Accepted`
- Inngest dev UI shows `linear/ticket.created`
- the `on-linear-ticket` run fetches live ticket context
- a worktree appears briefly under `$TARGET_REPO_WORKTREE_ROOT` and is removed on completion
- success requires red/green evidence, regression-guard evidence, and a draft PR URL in the structured `FIXER_RESULT`
- for Safari- or viewport-specific bugs, confirm the fix run uses matching Playwright or Chrome MCP settings

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "P2 task 9: document and validate fixer flow"
```

## P2 Done Criteria

- [ ] Unit tests are green.
- [ ] `pnpm typecheck` is clean.
- [ ] The webhook emits the normalized repo-owned event shape.
- [ ] The fixer fetches live ticket context through Codex + Linear MCP.
- [ ] Missing `module:*` labels fall back to `unknown`.
- [ ] Worktrees are always removed.
- [ ] Success requires explicit red evidence, green evidence, regression-guard evidence, and a draft PR URL.
- [ ] Browser-visible bugs can attach Chrome MCP evidence without replacing the regression test as the main proof.
- [ ] The committed regression test is the durable knowledge base for future bug prevention.
