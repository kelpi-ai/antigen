# incident-loop

Orchestrator for the Sentry → Linear → PR incident loop. See
`docs/superpowers/specs/2026-04-15-incident-loop-design.md`.

## Local dev
The target app must already be running on localhost before you trigger a Sentry issue run.

Codex also needs authenticated Sentry and Linear MCP access in the user-level Codex config. The per-run `.codex/config.toml` written by this app only adds the Chrome DevTools MCP binding for the dedicated Chrome session.

Each run writes artifacts under `.incident-loop-artifacts/runs/<runId>/`, including:
- `browser.mp4`
- `metadata.json`
- `.codex/config.toml`

Start the demo flow:
1. `pnpm install`
2. `cp .env.example .env`
3. Fill in `.env`, including the localhost target URL and webhook secret
4. Terminal A: `npx inngest-cli@latest dev`
5. Terminal B: `pnpm dev`

## Commands
- `pnpm test` — unit tests
- `pnpm typecheck` — TypeScript check
- `pnpm dev` — run the server

## Manual repro walkthrough
Start the services:

```bash
pnpm install
cp .env.example .env
npx inngest-cli@latest dev
pnpm dev
```

Then send a fake Sentry webhook:

```bash
BODY='{"action":"created","data":{"issue":{"id":"SENTRY-TEST-1","title":"TypeError","web_url":"https://sentry.io/issues/test/","culprit":"checkout.applyCoupon","environment":"staging","release":"app@0.0.1"}}}'
SIG=$(node -e "process.stdout.write(require('crypto').createHmac('sha256', process.env.S).update(process.env.B).digest('hex'))" S="<your secret>" B="$BODY")
curl -X POST http://localhost:3000/webhooks/sentry \
  -H "content-type: application/json" \
  -H "sentry-hook-resource: issue" \
  -H "sentry-hook-signature: $SIG" \
  -d "$BODY"
```

Expected checks:
- Inngest receives `sentry/issue.created`
- a run directory is created under `.incident-loop-artifacts/runs/<runId>/`
- `browser.mp4` exists
- `metadata.json` contains the Linear ticket URL when Codex completes
