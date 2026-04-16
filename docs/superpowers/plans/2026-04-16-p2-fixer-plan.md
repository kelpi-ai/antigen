# P2 Localhost Fixer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a localhost-aligned P2 fixer flow where a bug-labeled Linear issue triggers a durable workflow that refreshes the latest GitHub-backed checkout, creates an isolated worktree, writes and verifies a regression fix locally against the running localhost app, and opens a draft PR through GitHub MCP.

**Architecture:** `/webhooks/linear` stays a thin adapter that emits a repo-owned `linear/ticket.created` event. `on-linear-ticket` fetches live ticket context through Linear MCP, refreshes the persistent checkout from the tracked GitHub remote, creates a worktree from the refreshed base, builds a localhost-aware fixer prompt, runs the Codex fixer through the SDK path inside that worktree, validates structured red-green-regression proof, and always removes the worktree in a `finally` path. Local git handles checkout refresh, worktree creation, commit, and push; GitHub MCP handles draft PR creation.

**Tech Stack:** TypeScript 5.x, Node 20+, pnpm, Hono, Inngest, zod, vitest, OpenAI Agents SDK, Codex SDK path, Linear MCP, GitHub MCP, Chrome DevTools MCP, Playwright WebKit where environment hints require it

**Spec:** `docs/superpowers/specs/2026-04-16-p2-fixer-design.md`

**Assumption:** `docs/superpowers/plans/2026-04-16-incident-loop-localhost-plan.md` has already been implemented. This P2 plan extends that localhost runtime; it does not reintroduce the old `CODEX_BIN` / subprocess architecture.

---

## File Structure

```text
.env.example                              # add P2 repo and webhook vars
README.md                                 # add localhost P2 validation notes

src/
  config/env.ts                           # extend localhost env schema with P2 vars
  git/updateCheckout.ts                   # refresh persistent checkout from GitHub remote
  git/worktree.ts                         # create/remove worktrees from refreshed base
  linear/fetchTicketContext.ts            # use Linear MCP to fetch live ticket context
  prompts/fixer.ts                        # localhost-aware fixer prompt
  codex/fixer.ts                          # invoke Codex fixer via SDK and parse FIXER_RESULT
  webhooks/linear.ts                      # Linear bug ticket webhook adapter
  inngest/functions/onLinearTicket.ts     # durable P2 orchestrator
  inngest/index.ts                        # register on-linear-ticket
  server.ts                               # mount /webhooks/linear

tests/
  config/env.test.ts
  git/updateCheckout.test.ts
  git/worktree.test.ts
  linear/fetchTicketContext.test.ts
  prompts/fixer.test.ts
  codex/fixer.test.ts
  webhooks/linear.test.ts
  inngest/onLinearTicket.test.ts
  server.test.ts
```

## Task 1 — Extend The Localhost Env Schema For P2

**Files:**
- Modify: `src/config/env.ts`
- Modify: `.env.example`
- Modify: `tests/config/env.test.ts`

- [ ] **Step 1: Add the failing env test**

Append this test to `tests/config/env.test.ts`:

```ts
it("parses localhost P2 repo vars", () => {
  process.env.INNGEST_EVENT_KEY = "x";
  process.env.INNGEST_SIGNING_KEY = "x";
  process.env.OPENAI_API_KEY = "sk-test";
  process.env.TARGET_APP_URL = "http://localhost:3001";
  process.env.SENTRY_WEBHOOK_SECRET = "sentry-secret";
  process.env.LINEAR_API_KEY = "lin_api_xxx";
  process.env.LINEAR_WEBHOOK_SECRET = "lin-webhook-secret";
  process.env.TARGET_REPO_PATH = "/tmp/repo";
  process.env.TARGET_REPO_WORKTREE_ROOT = "/tmp/worktrees";
  process.env.TARGET_REPO_REMOTE = "origin";
  process.env.TARGET_REPO_BASE_BRANCH = "main";

  const env = loadEnv();
  expect(env.LINEAR_WEBHOOK_SECRET).toBe("lin-webhook-secret");
  expect(env.TARGET_REPO_PATH).toBe("/tmp/repo");
  expect(env.TARGET_REPO_WORKTREE_ROOT).toBe("/tmp/worktrees");
  expect(env.TARGET_REPO_REMOTE).toBe("origin");
  expect(env.TARGET_REPO_BASE_BRANCH).toBe("main");
});
```

- [ ] **Step 2: Run the env test to verify it fails**

Run:

```bash
pnpm test -- tests/config/env.test.ts
```

Expected: FAIL because the new P2 vars are not yet present in `EnvSchema`.

- [ ] **Step 3: Extend the localhost env schema**

Update `src/config/env.ts` so the schema includes the localhost P1 vars plus the new P2 vars:

```ts
const EnvSchema = z.object({
  INNGEST_EVENT_KEY: z.string().min(1),
  INNGEST_SIGNING_KEY: z.string().min(1),
  OPENAI_API_KEY: z.string().min(1),
  TARGET_APP_URL: z.string().url(),
  SENTRY_WEBHOOK_SECRET: z.string().min(1),
  LINEAR_API_KEY: z.string().min(1),
  LINEAR_WEBHOOK_SECRET: z.string().min(1),
  TARGET_REPO_PATH: z.string().min(1),
  TARGET_REPO_WORKTREE_ROOT: z.string().min(1),
  TARGET_REPO_REMOTE: z.string().min(1).default("origin"),
  TARGET_REPO_BASE_BRANCH: z.string().min(1).default("main"),
  ARTIFACTS_DIR: z.string().min(1).default(".incident-loop-artifacts"),
  CHROME_PATH: z.string().min(1).optional(),
  FFMPEG_BIN: z.string().min(1).optional(),
  PORT: z.coerce.number().int().positive().default(3000),
});
```

- [ ] **Step 4: Update `.env.example`**

Make sure `.env.example` includes the new P2 block:

```dotenv
INNGEST_EVENT_KEY=
INNGEST_SIGNING_KEY=
OPENAI_API_KEY=
TARGET_APP_URL=http://localhost:3001
SENTRY_WEBHOOK_SECRET=
LINEAR_API_KEY=
LINEAR_WEBHOOK_SECRET=
TARGET_REPO_PATH=/absolute/path/to/local/github/checkout
TARGET_REPO_WORKTREE_ROOT=/tmp/incident-loop-worktrees
TARGET_REPO_REMOTE=origin
TARGET_REPO_BASE_BRANCH=main
ARTIFACTS_DIR=.incident-loop-artifacts
CHROME_PATH=
FFMPEG_BIN=
PORT=3000
```

- [ ] **Step 5: Run the env test again**

Run:

```bash
pnpm test -- tests/config/env.test.ts
```

Expected: PASS with the localhost env tests green.

- [ ] **Step 6: Commit**

```bash
git add src/config/env.ts .env.example tests/config/env.test.ts
git commit -m "P2 task 1: extend localhost env for repo-backed fixer flow"
```

## Task 2 — Refresh The Persistent Checkout Before Worktree Creation

**Files:**
- Create: `src/git/updateCheckout.ts`
- Create: `tests/git/updateCheckout.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/git/updateCheckout.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";

const spawnMock = vi.fn();
vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

import { updateCheckout } from "../../src/git/updateCheckout";

function fakeProc(exitCode: number, stderr = ""): unknown {
  const proc = new EventEmitter() as EventEmitter & { stderr: EventEmitter };
  proc.stderr = new EventEmitter();
  setImmediate(() => {
    if (stderr) proc.stderr.emit("data", Buffer.from(stderr));
    proc.emit("close", exitCode);
  });
  return proc;
}

describe("updateCheckout", () => {
  beforeEach(() => {
    spawnMock.mockReset();
    process.env.INNGEST_EVENT_KEY = "x";
    process.env.INNGEST_SIGNING_KEY = "x";
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.TARGET_APP_URL = "http://localhost:3001";
    process.env.SENTRY_WEBHOOK_SECRET = "sentry-secret";
    process.env.LINEAR_API_KEY = "lin_api_xxx";
    process.env.LINEAR_WEBHOOK_SECRET = "lin-webhook-secret";
    process.env.TARGET_REPO_PATH = "/tmp/repo";
    process.env.TARGET_REPO_WORKTREE_ROOT = "/tmp/worktrees";
    process.env.TARGET_REPO_REMOTE = "origin";
    process.env.TARGET_REPO_BASE_BRANCH = "main";
  });

  it("fetches the remote and fast-forwards the base branch", async () => {
    spawnMock
      .mockReturnValueOnce(fakeProc(0))
      .mockReturnValueOnce(fakeProc(0))
      .mockReturnValueOnce(fakeProc(0));

    await updateCheckout();

    expect(spawnMock).toHaveBeenNthCalledWith(
      1,
      "git",
      ["rev-parse", "--is-inside-work-tree"],
      expect.objectContaining({ cwd: "/tmp/repo" }),
    );
    expect(spawnMock).toHaveBeenNthCalledWith(
      2,
      "git",
      ["fetch", "origin"],
      expect.objectContaining({ cwd: "/tmp/repo" }),
    );
    expect(spawnMock).toHaveBeenNthCalledWith(
      3,
      "git",
      ["pull", "--ff-only", "origin", "main"],
      expect.objectContaining({ cwd: "/tmp/repo" }),
    );
  });

  it("fails when the target path is not a git checkout", async () => {
    spawnMock.mockReturnValue(fakeProc(1, "fatal: not a git repository"));
    await expect(updateCheckout()).rejects.toThrow(
      /git rev-parse --is-inside-work-tree.*not a git repository/,
    );
  });

  it("fails when fetch fails", async () => {
    spawnMock
      .mockReturnValueOnce(fakeProc(0))
      .mockReturnValueOnce(fakeProc(1, "fatal: no remote"));
    await expect(updateCheckout()).rejects.toThrow(/git fetch origin.*no remote/);
  });
});
```

- [ ] **Step 2: Run the checkout test to verify it fails**

Run:

```bash
pnpm test -- tests/git/updateCheckout.test.ts
```

Expected: FAIL because `src/git/updateCheckout.ts` does not exist.

- [ ] **Step 3: Implement the helper**

Create `src/git/updateCheckout.ts`:

```ts
import { spawn } from "node:child_process";
import { env } from "../config/env";

function runGit(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("git", args, {
      cwd: env.TARGET_REPO_PATH,
      stdio: ["ignore", "ignore", "pipe"],
    });

    let stderr = "";
    proc.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`git ${args.join(" ")} failed: ${stderr.trim()}`));
    });
    proc.on("error", reject);
  });
}

export async function updateCheckout(): Promise<void> {
  await runGit(["rev-parse", "--is-inside-work-tree"]);
  await runGit(["fetch", env.TARGET_REPO_REMOTE]);
  await runGit([
    "pull",
    "--ff-only",
    env.TARGET_REPO_REMOTE,
    env.TARGET_REPO_BASE_BRANCH,
  ]);
}
```

- [ ] **Step 4: Run the checkout test again**

Run:

```bash
pnpm test -- tests/git/updateCheckout.test.ts
```

Expected: PASS with both checkout-refresh tests green.

- [ ] **Step 5: Commit**

```bash
git add src/git/updateCheckout.ts tests/git/updateCheckout.test.ts
git commit -m "P2 task 2: refresh persistent checkout before fixer runs"
```

## Task 3 — Create And Clean Up Worktrees From The Refreshed Base

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
  const proc = new EventEmitter() as EventEmitter & { stderr: EventEmitter };
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
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.TARGET_APP_URL = "http://localhost:3001";
    process.env.SENTRY_WEBHOOK_SECRET = "sentry-secret";
    process.env.LINEAR_API_KEY = "lin_api_xxx";
    process.env.LINEAR_WEBHOOK_SECRET = "lin-webhook-secret";
    process.env.TARGET_REPO_PATH = "/tmp/repo";
    process.env.TARGET_REPO_WORKTREE_ROOT = "/tmp/worktrees";
    process.env.TARGET_REPO_REMOTE = "origin";
    process.env.TARGET_REPO_BASE_BRANCH = "main";
  });

  it("creates a worktree from the refreshed base branch", async () => {
    spawnMock.mockReturnValue(fakeProc(0));
    const worktree = await createWorktree("BUG-42");

    expect(worktree.path).toMatch(/\/tmp\/worktrees\/BUG-42-/);
    expect(worktree.branch).toMatch(/^fix\/BUG-42-/);
    expect(spawnMock).toHaveBeenCalledWith(
      "git",
      expect.arrayContaining([
        "worktree",
        "add",
        "-b",
        worktree.branch,
        worktree.path,
        "main",
      ]),
      expect.objectContaining({ cwd: "/tmp/repo" }),
    );
  });

  it("removes the worktree", async () => {
    spawnMock.mockReturnValue(fakeProc(0));
    await removeWorktree("/tmp/worktrees/BUG-42-abcd");
    expect(spawnMock).toHaveBeenCalledWith(
      "git",
      ["worktree", "remove", "--force", "/tmp/worktrees/BUG-42-abcd"],
      expect.objectContaining({ cwd: "/tmp/repo" }),
    );
  });

  it("fails when git worktree add fails", async () => {
    spawnMock.mockReturnValue(fakeProc(1, "fatal: invalid reference"));
    await expect(createWorktree("BUG-42")).rejects.toThrow(
      /git worktree add.*invalid reference/,
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
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    proc.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
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

  await runGit([
    "worktree",
    "add",
    "-b",
    branch,
    path,
    env.TARGET_REPO_BASE_BRANCH,
  ]);

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

Expected: PASS with worktree create/remove covered.

- [ ] **Step 5: Commit**

```bash
git add src/git/worktree.ts tests/git/worktree.test.ts
git commit -m "P2 task 3: create worktrees from refreshed localhost base"
```

## Task 4 — Add The Shared Codex Runner And Result Parsing

**Files:**
- Create: `src/codex/fixer.ts`
- Create: `tests/codex/fixer.test.ts`

- [ ] **Step 1: Write the failing runner test**

Create `tests/codex/fixer.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@openai/codex-sdk", () => ({
  runCodex: vi.fn(),
}));

import { runCodexTask, runFixer, parseFixerResult } from "../../src/codex/fixer";
import { runCodex } from "@openai/codex-sdk";

describe("parseFixerResult", () => {
  it("parses the tagged result line", () => {
    expect(
      parseFixerResult(
        'FIXER_RESULT {"status":"ok","prUrl":"https://github.com/acme/repo/pull/1","testPath":"tests/regressions/bug-42.spec.ts","redEvidence":"Expected 500","greenEvidence":"1 passed","regressionGuardEvidence":"other flows still pass"}',
      ).prUrl,
    ).toBe("https://github.com/acme/repo/pull/1");
  });

  it("fails when required proof is missing", () => {
    expect(() =>
      parseFixerResult(
        'FIXER_RESULT {"status":"ok","prUrl":"https://github.com/acme/repo/pull/1","testPath":"tests/regressions/bug-42.spec.ts","redEvidence":"Expected 500","greenEvidence":"1 passed","regressionGuardEvidence":""}',
      ),
    ).toThrow(/Incomplete FIXER_RESULT payload/);
  });
});

describe("runCodexTask", () => {
  beforeEach(() => {
    vi.mocked(runCodex).mockReset();
  });

  it("returns raw Codex output for shared tasks", async () => {
    vi.mocked(runCodex).mockResolvedValue({
      outputText: 'LINEAR_TICKET_CONTEXT {"ticketId":"lin_123"}',
    });

    await expect(runCodexTask("inspect Linear ticket")).resolves.toContain(
      "LINEAR_TICKET_CONTEXT",
    );
  });
});

describe("runFixer", () => {
  beforeEach(() => {
    vi.mocked(runCodex).mockReset();
  });

  it("returns parsed fixer output", async () => {
    vi.mocked(runCodex).mockResolvedValue({
      outputText: 'FIXER_RESULT {"status":"ok","prUrl":"https://github.com/acme/repo/pull/1","testPath":"tests/regressions/bug-42.spec.ts","redEvidence":"Expected 500","greenEvidence":"1 passed","regressionGuardEvidence":"other flows still pass","browserVerificationEvidence":"checkout succeeds on localhost"}',
    });

    const result = await runFixer({
      prompt: "fix it",
      cwd: "/tmp/worktrees/BUG-42-abcd",
    });

    expect(result.browserVerificationEvidence).toContain("localhost");
  });
});
```

- [ ] **Step 2: Run the runner test to verify it fails**

Run:

```bash
pnpm test -- tests/codex/fixer.test.ts
```

Expected: FAIL because `src/codex/fixer.ts` does not exist.

- [ ] **Step 3: Implement the shared runner**

Create `src/codex/fixer.ts`:

```ts
import { runCodex } from "@openai/codex-sdk";

export interface FixerResult {
  status: "ok";
  prUrl: string;
  testPath: string;
  redEvidence: string;
  greenEvidence: string;
  regressionGuardEvidence: string;
  browserVerificationEvidence?: string;
}

export async function runCodexTask(prompt: string, cwd?: string): Promise<string> {
  const result = await runCodex(cwd ? { prompt, cwd } : { prompt });
  return result.outputText;
}

export function parseFixerResult(stdout: string): FixerResult {
  const line = stdout
    .split(/\r?\n/)
    .find((entry) => entry.startsWith("FIXER_RESULT "));

  if (!line) throw new Error("Missing FIXER_RESULT line");

  const parsed = JSON.parse(line.slice("FIXER_RESULT ".length)) as FixerResult;
  if (
    parsed.status !== "ok" ||
    !parsed.prUrl ||
    !parsed.redEvidence ||
    !parsed.greenEvidence ||
    !parsed.regressionGuardEvidence
  ) {
    throw new Error("Incomplete FIXER_RESULT payload");
  }
  return parsed;
}

export async function runFixer(input: {
  prompt: string;
  cwd: string;
}): Promise<FixerResult> {
  return parseFixerResult(await runCodexTask(input.prompt, input.cwd));
}
```

- [ ] **Step 4: Run the runner test again**

Run:

```bash
pnpm test -- tests/codex/fixer.test.ts
```

Expected: PASS with shared Codex invocation and result parsing covered.

- [ ] **Step 5: Commit**

```bash
git add src/codex/fixer.ts tests/codex/fixer.test.ts
git commit -m "P2 task 4: add shared Codex runner for localhost fixer flows"
```

## Task 5 — Build The Localhost Fixer Prompt And Fetch Live Linear Ticket Context

**Files:**
- Create: `src/linear/fetchTicketContext.ts`
- Create: `src/prompts/fixer.ts`
- Create: `tests/linear/fetchTicketContext.test.ts`
- Create: `tests/prompts/fixer.test.ts`

- [ ] **Step 1: Write the failing ticket-context test**

Create `tests/linear/fetchTicketContext.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/codex/fixer", () => ({
  runCodexTask: vi.fn(),
}));

import { runCodexTask } from "../../src/codex/fixer";
import { fetchTicketContext } from "../../src/linear/fetchTicketContext";

describe("fetchTicketContext", () => {
  beforeEach(() => {
    vi.mocked(runCodexTask).mockReset();
  });

  it("parses live ticket context and environment hints", async () => {
    vi.mocked(runCodexTask).mockResolvedValue(
      'LINEAR_TICKET_CONTEXT {"ticketId":"lin_123","identifier":"BUG-42","url":"https://linear.app/acme/issue/BUG-42","title":"Checkout crash","body":"Reproduction steps: 1. Open checkout","module":"checkout","browserVisible":true,"similarIssueContext":"BUG-12 same flow","environmentHints":{"browser":"webkit","os":"macos","viewport":"390x844"}}',
    );

    const result = await fetchTicketContext({
      ticketId: "lin_123",
      identifier: "BUG-42",
      module: "checkout",
      url: "https://linear.app/acme/issue/BUG-42",
    });

    expect(result.browserVisible).toBe(true);
    expect(result.environmentHints.browser).toBe("webkit");
  });
});
```

- [ ] **Step 2: Write the failing prompt test**

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
    similarIssueContext: "BUG-12 same flow",
    environmentHints: {
      browser: "webkit",
      os: "macos",
      viewport: "390x844",
    },
  };

  it("requires red-green, regression guard, and GitHub MCP draft PR creation", () => {
    const prompt = buildFixerPrompt({
      ticket,
      worktreePath: "/tmp/worktrees/BUG-42-abcd",
      branch: "fix/BUG-42-abcd",
      targetAppUrl: "http://localhost:3001",
    });

    expect(prompt).toMatch(/red/i);
    expect(prompt).toMatch(/green/i);
    expect(prompt).toMatch(/regression guard/i);
    expect(prompt).toMatch(/GitHub MCP/i);
  });

  it("includes localhost verification hints", () => {
    const prompt = buildFixerPrompt({
      ticket,
      worktreePath: "/tmp/worktrees/BUG-42-abcd",
      branch: "fix/BUG-42-abcd",
      targetAppUrl: "http://localhost:3001",
    });

    expect(prompt).toContain("http://localhost:3001");
    expect(prompt).toMatch(/webkit/i);
    expect(prompt).toMatch(/390x844/i);
    expect(prompt).toMatch(/accessibility tree diff/i);
  });
});
```

- [ ] **Step 3: Run the prompt and ticket-context tests to verify they fail**

Run:

```bash
pnpm test -- tests/linear/fetchTicketContext.test.ts tests/prompts/fixer.test.ts
```

Expected: FAIL because the ticket-context and prompt modules do not exist.

- [ ] **Step 4: Implement the typed ticket-context fetcher**

Create `src/linear/fetchTicketContext.ts`:

```ts
import { runCodexTask } from "../codex/fixer";

export interface TicketSeed {
  ticketId: string;
  identifier: string;
  module: string;
  url: string;
}

export interface TicketContext extends TicketSeed {
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

export async function fetchTicketContext(input: TicketSeed): Promise<TicketContext> {
  const output = await runCodexTask(`
Use Linear MCP to inspect ticket ${input.ticketId} (${input.identifier}) and return exactly:
LINEAR_TICKET_CONTEXT {"ticketId":"${input.ticketId}","identifier":"${input.identifier}","url":"${input.url}","title":"...","body":"...","module":"...","browserVisible":true,"similarIssueContext":"...","environmentHints":{"browser":"...","os":"...","viewport":"..."}}
`);

  const line = output
    .split(/\\r?\\n/)
    .find((entry) => entry.startsWith("LINEAR_TICKET_CONTEXT "));

  if (!line) {
    throw new Error("Missing LINEAR_TICKET_CONTEXT line");
  }

  const parsed = JSON.parse(line.slice("LINEAR_TICKET_CONTEXT ".length)) as TicketContext;
  return {
    ...parsed,
    module: parsed.module || input.module,
  };
}
```

- [ ] **Step 5: Implement the prompt**

Create `src/prompts/fixer.ts`:

```ts
import type { TicketContext } from "../linear/fetchTicketContext";

export function buildFixerPrompt(input: {
  ticket: TicketContext;
  worktreePath: string;
  branch: string;
  targetAppUrl: string;
}): string {
  const { ticket, worktreePath, branch, targetAppUrl } = input;

  return `You are the localhost Incident Fixer.

The regression test is the durable knowledge base. Work only inside ${worktreePath}.

Ticket: ${ticket.identifier}
URL: ${ticket.url}
Module: ${ticket.module}
Branch: ${branch}
Similar issue context: ${ticket.similarIssueContext || "none"}
Target app URL: ${targetAppUrl}
Environment hints: browser=${ticket.environmentHints.browser || "unknown"}, os=${ticket.environmentHints.os || "unknown"}, viewport=${ticket.environmentHints.viewport || "unknown"}

Ticket body:
${ticket.body}

Procedure:
1. Write a focused regression test in tests/regressions/ first.
2. Run it and prove it fails.
3. If the repro is unclear, use systematic-debugging before changing code.
4. Write the minimal fix.
5. Run the regression test again and prove it passes.
6. Run a regression guard proving already-correct behavior still works.
7. If the bug is browser-visible, verify against ${targetAppUrl}. Use WebKit when the issue suggests Safari-like behavior. For layout or missing-element bugs, include accessibility tree diff evidence.
8. Commit and push the branch with local git.
9. Use GitHub MCP to open a draft PR.
10. Print exactly one line:
FIXER_RESULT {"status":"ok","prUrl":"...","testPath":"...","redEvidence":"...","greenEvidence":"...","regressionGuardEvidence":"...","browserVerificationEvidence":"..."}
`;
}
```

- [ ] **Step 6: Run the prompt and ticket-context tests again**

Run:

```bash
pnpm test -- tests/linear/fetchTicketContext.test.ts tests/prompts/fixer.test.ts
```

Expected: PASS with live ticket parsing and prompt contract covered.

- [ ] **Step 7: Commit**

```bash
git add src/linear/fetchTicketContext.ts src/prompts/fixer.ts tests/linear/fetchTicketContext.test.ts tests/prompts/fixer.test.ts
git commit -m "P2 task 5: add localhost ticket context fetcher and fixer prompt"
```

## Task 6 — Add The Linear Webhook Adapter

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
  const secret = "lin-webhook-secret";

  beforeEach(() => {
    sendMock.mockReset();
    process.env.INNGEST_EVENT_KEY = "x";
    process.env.INNGEST_SIGNING_KEY = "x";
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.TARGET_APP_URL = "http://localhost:3001";
    process.env.SENTRY_WEBHOOK_SECRET = "sentry-secret";
    process.env.LINEAR_API_KEY = "lin_api_xxx";
    process.env.LINEAR_WEBHOOK_SECRET = secret;
    process.env.TARGET_REPO_PATH = "/tmp/repo";
    process.env.TARGET_REPO_WORKTREE_ROOT = "/tmp/worktrees";
    process.env.TARGET_REPO_REMOTE = "origin";
    process.env.TARGET_REPO_BASE_BRANCH = "main";
  });

  it("emits the normalized event for bug-labeled issues", async () => {
    const app = new Hono();
    mountLinearWebhook(app);

    const body = JSON.stringify({
      action: "create",
      type: "Issue",
      data: {
        id: "lin_123",
        identifier: "BUG-42",
        url: "https://linear.app/acme/issue/BUG-42",
        labels: [{ name: "bug" }, { name: "module:checkout" }],
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
      data: {
        ticketId: "lin_123",
        identifier: "BUG-42",
        module: "checkout",
        url: "https://linear.app/acme/issue/BUG-42",
      },
    });
  });

  it("returns 401 for an invalid signature", async () => {
    const app = new Hono();
    mountLinearWebhook(app);

    const body = JSON.stringify({
      action: "create",
      type: "Issue",
      data: {
        id: "lin_123",
        identifier: "BUG-42",
        url: "https://linear.app/acme/issue/BUG-42",
        labels: [{ name: "bug" }],
      },
    });

    const res = await app.request("/webhooks/linear", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "linear-signature": "deadbeef",
      },
      body,
    });

    expect(res.status).toBe(401);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("ignores non-bug issues", async () => {
    const app = new Hono();
    mountLinearWebhook(app);

    const body = JSON.stringify({
      action: "create",
      type: "Issue",
      data: {
        id: "lin_123",
        identifier: "BUG-42",
        url: "https://linear.app/acme/issue/BUG-42",
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

  it("falls back to unknown when the module label is missing", async () => {
    const app = new Hono();
    mountLinearWebhook(app);

    const body = JSON.stringify({
      action: "create",
      type: "Issue",
      data: {
        id: "lin_123",
        identifier: "BUG-42",
        url: "https://linear.app/acme/issue/BUG-42",
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
      data: {
        ticketId: "lin_123",
        identifier: "BUG-42",
        module: "unknown",
        url: "https://linear.app/acme/issue/BUG-42",
      },
    });
  });
});
```

- [ ] **Step 2: Run the webhook test to verify it fails**

Run:

```bash
pnpm test -- tests/webhooks/linear.test.ts
```

Expected: FAIL because `src/webhooks/linear.ts` does not exist.

- [ ] **Step 3: Implement the webhook adapter and mount it**

Create `src/webhooks/linear.ts`:

```ts
import type { Hono } from "hono";
import { env } from "../config/env";
import { inngest } from "../inngest/client";
import { verifyHmacSha256 } from "./verify";

function extractModule(labels: Array<{ name: string }>): string {
  const moduleLabel = labels.find((label) => label.name.startsWith("module:"));
  return moduleLabel ? moduleLabel.name.slice("module:".length) : "unknown";
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
      data: { id: string; identifier: string; url: string; labels?: Array<{ name: string }> };
    };

    if (parsed.type !== "Issue" || parsed.action !== "create") return c.body(null, 204);

    const labels = parsed.data.labels ?? [];
    if (!labels.some((label) => label.name === "bug")) return c.body(null, 204);

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

 Mount it in `src/server.ts` by calling `mountLinearWebhook(app)` inside `buildApp()`, and update `tests/server.test.ts` so the `beforeEach` block sets the localhost env shape instead of `CODEX_BIN`:

```ts
beforeEach(() => {
  process.env.INNGEST_EVENT_KEY = "test";
  process.env.INNGEST_SIGNING_KEY = "test";
  process.env.OPENAI_API_KEY = "sk-test";
  process.env.TARGET_APP_URL = "http://localhost:3001";
  process.env.SENTRY_WEBHOOK_SECRET = "sentry-secret";
  process.env.LINEAR_API_KEY = "lin_api_xxx";
  process.env.LINEAR_WEBHOOK_SECRET = "lin-webhook-secret";
  process.env.TARGET_REPO_PATH = "/tmp/repo";
  process.env.TARGET_REPO_WORKTREE_ROOT = "/tmp/worktrees";
  process.env.TARGET_REPO_REMOTE = "origin";
  process.env.TARGET_REPO_BASE_BRANCH = "main";
});
```

- [ ] **Step 4: Run the webhook and server tests again**

Run:

```bash
pnpm test -- tests/webhooks/linear.test.ts tests/server.test.ts
```

Expected: PASS with the webhook route mounted and tested.

- [ ] **Step 5: Commit**

```bash
git add src/webhooks/linear.ts src/server.ts tests/webhooks/linear.test.ts tests/server.test.ts
git commit -m "P2 task 6: add localhost Linear webhook adapter"
```

## Task 7 — Implement The Durable `on-linear-ticket` Flow

**Files:**
- Create: `src/inngest/functions/onLinearTicket.ts`
- Create: `tests/inngest/onLinearTicket.test.ts`
- Modify: `src/inngest/index.ts`

- [ ] **Step 1: Write the failing function test**

Create `tests/inngest/onLinearTicket.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/linear/fetchTicketContext", () => ({
  fetchTicketContext: vi.fn(),
}));
vi.mock("../../src/git/updateCheckout", () => ({
  updateCheckout: vi.fn(),
}));
vi.mock("../../src/git/worktree", () => ({
  createWorktree: vi.fn(),
  removeWorktree: vi.fn(),
}));
vi.mock("../../src/codex/fixer", () => ({
  runFixer: vi.fn(),
}));

import { fetchTicketContext } from "../../src/linear/fetchTicketContext";
import { updateCheckout } from "../../src/git/updateCheckout";
import { createWorktree, removeWorktree } from "../../src/git/worktree";
import { runFixer } from "../../src/codex/fixer";
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
    vi.mocked(fetchTicketContext).mockReset();
    vi.mocked(updateCheckout).mockReset();
    vi.mocked(createWorktree).mockReset();
    vi.mocked(removeWorktree).mockReset();
    vi.mocked(runFixer).mockReset();
    process.env.INNGEST_EVENT_KEY = "x";
    process.env.INNGEST_SIGNING_KEY = "x";
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.TARGET_APP_URL = "http://localhost:3001";
    process.env.SENTRY_WEBHOOK_SECRET = "sentry-secret";
    process.env.LINEAR_API_KEY = "lin_api_xxx";
    process.env.LINEAR_WEBHOOK_SECRET = "lin-webhook-secret";
    process.env.TARGET_REPO_PATH = "/tmp/repo";
    process.env.TARGET_REPO_WORKTREE_ROOT = "/tmp/worktrees";
    process.env.TARGET_REPO_REMOTE = "origin";
    process.env.TARGET_REPO_BASE_BRANCH = "main";
  });

  it("has id 'on-linear-ticket'", () => {
    expect(onLinearTicket.id()).toBe("on-linear-ticket");
  });

  it("is registered in the barrel", () => {
    expect(functions).toContain(onLinearTicket);
  });

  it("fetches ticket context, refreshes checkout, then creates the worktree", async () => {
    vi.mocked(fetchTicketContext).mockResolvedValue({
      ticketId: "lin_123",
      identifier: "BUG-42",
      module: "checkout",
      url: "https://linear.app/acme/issue/BUG-42",
      title: "Checkout crash",
      body: "Reproduction steps: 1. Open checkout",
      browserVisible: true,
      similarIssueContext: "BUG-12 same flow",
      environmentHints: { browser: "webkit", os: "macos", viewport: "390x844" },
    });
    vi.mocked(updateCheckout).mockResolvedValue();
    vi.mocked(createWorktree).mockResolvedValue({
      path: "/tmp/worktrees/BUG-42-abcd",
      branch: "fix/BUG-42-abcd",
    });
    vi.mocked(runFixer).mockResolvedValue({
      status: "ok",
      prUrl: "https://github.com/acme/repo/pull/1",
      testPath: "tests/regressions/bug-42.spec.ts",
      redEvidence: "Expected 500",
      greenEvidence: "1 passed",
      regressionGuardEvidence: "other flows still pass",
      browserVerificationEvidence: "localhost checkout succeeds",
    });
    vi.mocked(removeWorktree).mockResolvedValue();

    const { order, step } = createStepRecorder();
    const result = await runLinearTicketFlow({ event, step });

    expect(order).toEqual([
      "fetch-ticket-context",
      "update-checkout",
      "create-worktree",
      "build-prompt",
      "run-fixer",
      "remove-worktree",
    ]);
    expect(result.prUrl).toContain("/pull/1");
  });

  it("does not create a worktree when checkout refresh fails", async () => {
    vi.mocked(fetchTicketContext).mockResolvedValue({
      ticketId: "lin_123",
      identifier: "BUG-42",
      module: "checkout",
      url: "https://linear.app/acme/issue/BUG-42",
      title: "Checkout crash",
      body: "Reproduction steps: 1. Open checkout",
      browserVisible: false,
      similarIssueContext: "",
      environmentHints: { browser: "", os: "", viewport: "" },
    });
    vi.mocked(updateCheckout).mockRejectedValue(new Error("git fetch origin failed"));

    const { step } = createStepRecorder();
    await expect(runLinearTicketFlow({ event, step })).rejects.toThrow(/git fetch origin failed/);

    expect(createWorktree).not.toHaveBeenCalled();
    expect(removeWorktree).not.toHaveBeenCalled();
  });

  it("removes the worktree when fixer execution fails", async () => {
    vi.mocked(fetchTicketContext).mockResolvedValue({
      ticketId: "lin_123",
      identifier: "BUG-42",
      module: "checkout",
      url: "https://linear.app/acme/issue/BUG-42",
      title: "Checkout crash",
      body: "Reproduction steps: 1. Open checkout",
      browserVisible: true,
      similarIssueContext: "BUG-12 same flow",
      environmentHints: { browser: "webkit", os: "macos", viewport: "390x844" },
    });
    vi.mocked(updateCheckout).mockResolvedValue();
    vi.mocked(createWorktree).mockResolvedValue({
      path: "/tmp/worktrees/BUG-42-abcd",
      branch: "fix/BUG-42-abcd",
    });
    vi.mocked(runFixer).mockRejectedValue(new Error("fixer failed"));
    vi.mocked(removeWorktree).mockResolvedValue();

    const { step } = createStepRecorder();
    await expect(runLinearTicketFlow({ event, step })).rejects.toThrow(/fixer failed/);

    expect(removeWorktree).toHaveBeenCalledWith("/tmp/worktrees/BUG-42-abcd");
  });
});
```

- [ ] **Step 2: Run the function test to verify it fails**

Run:

```bash
pnpm test -- tests/inngest/onLinearTicket.test.ts
```

Expected: FAIL because `src/inngest/functions/onLinearTicket.ts` does not exist.

- [ ] **Step 3: Implement the orchestrator**

Create `src/inngest/functions/onLinearTicket.ts`:

```ts
import { updateCheckout } from "../../git/updateCheckout";
import { createWorktree, removeWorktree } from "../../git/worktree";
import { fetchTicketContext, type TicketSeed } from "../../linear/fetchTicketContext";
import { buildFixerPrompt } from "../../prompts/fixer";
import { runFixer, type FixerResult } from "../../codex/fixer";
import { env } from "../../config/env";
import { inngest } from "../client";

interface StepLike {
  run<T>(id: string, fn: () => Promise<T> | T): Promise<T>;
}

export interface LinearTicketCreatedEvent {
  data: TicketSeed;
}

export async function runLinearTicketFlow({
  event,
  step,
}: {
  event: LinearTicketCreatedEvent;
  step: StepLike;
}): Promise<FixerResult> {
  const seed = event.data;

  const ticket = await step.run("fetch-ticket-context", () => fetchTicketContext(seed));
  await step.run("update-checkout", () => updateCheckout());

  const worktree = await step.run("create-worktree", () => createWorktree(seed.identifier));

  try {
    const prompt = await step.run("build-prompt", () =>
      buildFixerPrompt({
        ticket,
        worktreePath: worktree.path,
        branch: worktree.branch,
        targetAppUrl: env.TARGET_APP_URL,
      }),
    );

    return await step.run("run-fixer", () =>
      runFixer({ prompt, cwd: worktree.path }),
    );
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
  async ({ event, step }) =>
    runLinearTicketFlow({
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

- [ ] **Step 5: Run the function test and the full verification pass**

Run:

```bash
pnpm test -- tests/inngest/onLinearTicket.test.ts
pnpm test
pnpm typecheck
```

Expected:

- `tests/inngest/onLinearTicket.test.ts`: PASS
- `pnpm test`: PASS
- `pnpm typecheck`: PASS

- [ ] **Step 6: Commit**

```bash
git add src/inngest/functions/onLinearTicket.ts src/inngest/index.ts tests/inngest/onLinearTicket.test.ts
git commit -m "P2 task 7: add durable localhost on-linear-ticket flow"
```

## Task 8 — Document And Manually Validate Localhost P2

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add localhost P2 validation notes to `README.md`**

Append:

```md
## Localhost P2 validation

Additional P2 env vars:

- `LINEAR_WEBHOOK_SECRET`
- `TARGET_REPO_PATH`
- `TARGET_REPO_WORKTREE_ROOT`
- `TARGET_REPO_REMOTE`
- `TARGET_REPO_BASE_BRANCH`

Localhost P2 assumptions:

- the target app is already running at `TARGET_APP_URL`
- `TARGET_REPO_PATH` points to a local git checkout of the GitHub-backed repo
- the checkout remote is configured and pushable
```

- [ ] **Step 2: Re-run the automated suite**

Run:

```bash
pnpm test
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 3: Run the manual localhost P2 smoke test**

Use a real local checkout and a running localhost app, then:

```bash
mkdir -p /tmp/incident-loop-worktrees
```

Prepare the request body:

```bash
BODY='{"action":"create","type":"Issue","data":{"id":"lin_123","identifier":"BUG-42","url":"https://linear.app/acme/issue/BUG-42","labels":[{"name":"bug"},{"name":"module:checkout"}]}}'
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
- Inngest shows `linear/ticket.created`
- the persistent checkout is refreshed before the worktree is created
- a worktree appears briefly under `$TARGET_REPO_WORKTREE_ROOT` and is then removed
- the branch is pushed to GitHub
- GitHub MCP opens a draft PR
- success requires red evidence, green evidence, regression-guard evidence, and a draft PR URL
- for browser-visible bugs, localhost verification evidence reflects the ticket’s environment hints

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "P2 task 8: document and validate localhost fixer flow"
```

## P2 Done Criteria

- [ ] Unit tests are green.
- [ ] `pnpm typecheck` is clean.
- [ ] The webhook emits the normalized repo-owned event shape.
- [ ] P2 refreshes the persistent checkout from GitHub before worktree creation.
- [ ] P2 fetches live ticket context through Linear MCP.
- [ ] Local git handles checkout refresh, worktree creation, commit, and push.
- [ ] GitHub MCP handles draft PR creation.
- [ ] Success requires explicit red evidence, green evidence, regression-guard evidence, and a draft PR URL.
- [ ] Browser-visible bugs can attach localhost verification evidence without replacing the regression test as the main proof.
- [ ] Worktrees are always removed.
- [ ] The committed regression test remains the durable knowledge base for future bug prevention.
