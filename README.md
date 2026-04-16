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
