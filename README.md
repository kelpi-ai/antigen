# incident-loop

# Mistakenly put the wrong link: https://docs.google.com/videos/d/1y14Kwfo8kXfCUB-QAdduwCywaDRdf3j3j9ewvEWjghE/edit?usp=sharing - here's the main link!

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

## P3 local validation

P3 needs these environment variables in `.env`:

- Base runtime:
  - `INNGEST_EVENT_KEY`
  - `INNGEST_SIGNING_KEY`
  - `CODEX_BIN`
  - `PORT` (default: `3000`)
- P3-specific:
  - `GITHUB_WEBHOOK_SECRET`
  - `CHROME_PATH`
  - `ARTIFACTS_DIR`
  - `MAX_SCENARIOS_PER_PR`
  - `P3_EXECUTOR_CONCURRENCY`

Prerequisites:

- Install and authenticate the Codex CLI.
- Add a user-level Codex config (`~/.codex/config.toml`) with GitHub, Sentry, and Linear MCP access.
- Confirm `CHROME_PATH` points to a runnable Chrome binary.
- Use a target PR that has an active preview deployment URL.

Artifacts are written under `.incident-loop-artifacts/p3/<runId>/`.

Per-scenario folders are under `.incident-loop-artifacts/p3/<runId>/scenarios/<scenarioId>/` and include:

- `profile/` — Chrome user profile used by the browser session.
- `.codex/config.toml` — per-scenario Codex config.
- `failure.png` — screenshot if the scenario fails (optional if it passes).

### Manual P3 walkthrough

1. Start local services:
   - Terminal A: `npx inngest-cli@latest dev`
   - Terminal B: `pnpm dev`
2. Run the P3-focused automated check:
   - `pnpm test -- tests/e2e/p3Hunter.test.ts`
3. Send a signed GitHub `ready_for_review` webhook to `http://localhost:${PORT:-3000}/webhooks/github`:
   - Create payload:
     - `BODY='{"action":"ready_for_review","number":123,"pull_request":{"html_url":"https://github.com/acme/shop/pull/123","head":{"sha":"HEAD_SHA"},"base":{"sha":"BASE_SHA"}},"repository":{"full_name":"acme/shop"}}'`
   - Sign payload:
     - `SIG=$(node -e 'const { createHmac } = require("node:crypto"); process.stdout.write("sha256=" + createHmac("sha256", process.env.GITHUB_WEBHOOK_SECRET).update(process.argv[1]).digest("hex"));' "$BODY")`
   - Post it:
   - `curl -i "http://localhost:${PORT:-3000}/webhooks/github" -H 'content-type: application/json' -H "x-github-event: pull_request" -H "x-hub-signature-256: $SIG" --data "$BODY"`
4. Confirm `github/pr.ready_for_review` appears in Inngest and inspect output artifacts under `.incident-loop-artifacts/p3/<runId>/`.
