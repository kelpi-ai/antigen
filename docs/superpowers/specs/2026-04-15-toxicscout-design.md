# ToxicScout — Design & Handoff Note

**Date:** 2026-04-15
**Status:** Design approved through Section 2 (Architecture + Agent Roster). Sections 3–5 are proposed defaults awaiting review.
**Intended reader:** An engineering agent (or human) who will turn this into an implementation plan and then code.

---

## 1. What we're building

**ToxicScout** is a hackathon-grade but architecturally-complete demo: a user types any US address, and a team of 6 live research agents (built on Codex SDK) investigate environmental hazards from every angle — regulatory records, historical land use, active nearby threats, contamination pathways — and produce a plain-language health report that no real estate disclosure would ever show.

The demo's central thesis: **one generalist LLM with tools is boring; a team of specialists with distinct missions, sandboxed toolboxes, and real coordination is a product.**

### Scope classification
- **Full product spec** — all 6 agents, real research loops, live data sources
- **Demo-grade execution** — no prod concerns (auth, rate limiting beyond basic, observability), hardcoded demo-friendly addresses are fine as fallbacks
- **Live agents, live tools** — no pre-recorded responses. Agents genuinely research. Codex SDK is the runtime. Exa is the primary web-research tool.

### Non-goals
- Production deployment, user accounts, persistence beyond a single session
- Real groundwater modeling (we approximate with USGS flow direction + distance)
- Monitoring/alerting (dropped from original pitch — doesn't fit one-shot reports)
- Mobile optimization

### Target demo moment
Judge types a real suburban address → 3-act investigation plays out live on screen → final report reveals a former Superfund site 0.3mi away, an active dry cleaner 200ft upgradient (TCE risk), and historical agricultural use. Judge's next thought: *"I want to check my own address right now."*

---

## 2. Tech stack (approved)

- **Framework:** Next.js 15 (app router), TypeScript, single repo
- **UI:** React, Tailwind, shadcn/ui, Mapbox GL (map in final report)
- **Agent runtime:** `@openai/codex-sdk` (Node). Agents run as child processes with per-agent tool allowlists and network allowlists.
- **Web research:** `exa-js`
- **Geospatial math:** `@turf/turf` (distance, bearing, upwind/downwind)
- **Schemas:** `zod` (agent output validation)
- **Streaming:** Native SSE via a streaming route handler (`app/api/investigate/route.ts`)
- **State:** None beyond in-memory session keyed by investigation ID. No DB.

---

## 3. Architecture (approved)

Three logical layers, one Next.js app.

```
app/
  page.tsx                      # address input → creates investigation, redirects
  investigate/[id]/page.tsx     # split-screen UI (client component, consumes SSE)
  api/investigate/route.ts      # SSE stream endpoint; drives orchestrator
lib/
  orchestrator/
    run.ts                      # 3-act flow: plan → research → synthesis
    events.ts                   # event types + typed emitter
    session.ts                  # in-memory investigation state
  agents/
    lead-investigator.ts        # Act 1 plan + Act 3 synthesis (Codex agent)
    regulatory.ts
    historical.ts
    neighbor.ts
    plume.ts
    risk-translation.ts
    shared/
      tools.ts                  # tool implementations
      schemas.ts                # zod output schemas
      codex.ts                  # Codex SDK wrapper with allowlists + budgets
components/
  investigation/
    SplitScreen.tsx             # layout
    AgentPanel.tsx              # left: 6 agent cards
    AgentCard.tsx               # single agent: status, tool calls, findings
    ReportPanel.tsx             # right: progressive report
    ReportSection.tsx           # individual report section
    ToolCallLine.tsx            # streaming tool-call rendering
```

**Key design call:** the **Lead Investigator runs as a Codex agent** (its reasoning is model-driven), but the **orchestration plumbing is plain TypeScript** (spawning, timeouts, event routing, error recovery). This gives us the "agent-driven coordination" story without losing debuggability — orchestration logs are in the Node terminal, not inside a sandbox.

---

## 4. Agent roster (approved)

### Shared constraints (apply to all 6 agents)
- **Budget:** max 15 tool calls per agent, 60s wall-clock hard cap
- **Output:** must emit a `zod`-validated JSON object at exit. Shape: `{status: 'ok'|'degraded', findings: <agent-specific>, confidence: 'low'|'medium'|'high', sources: string[]}`
- **Streaming:** every tool call (name, args summary) and intermediate reasoning text bubbles up via the orchestrator as SSE events
- **Failure mode:** on timeout or error, returns `{status: 'degraded', reason, partial}`. Orchestrator never throws — degraded findings still make it into the final report with a visible marker.
- **Tool allowlists are enforced at Codex spawn config, not just in prompts.** This is the core multi-agent story: each specialist *literally cannot* do another specialist's job.

### 4.1 Lead Investigator (Codex agent)
- **Runs in:** Act 1 (plan) and Act 3 (synthesis + follow-ups)
- **Mission prompt (core):** *"You are the lead investigator on an environmental hazard report for a specific US address. In Act 1, write a research plan: which specialists to dispatch and what specific question each should answer. In Act 3, you receive their findings, decide if any 1–2 targeted follow-up queries are worth running, then produce the final report in the provided markdown template."*
- **Tools:** `dispatch_agent(agentId, question)`, `read_findings(agentId)`, `followup(agentId, question)`, `write_plan(text)`, `write_report_section(id, markdown)`
- **Network:** none. It can only talk to other agents through the orchestrator.

### 4.2 Regulatory Record Agent
- **Mission:** *"Find every officially-documented contamination record within 2 miles of this address. Be exhaustive about government records; ignore news and blogs."*
- **Tools:**
  - `epa_envirofacts_query(dataset, lat, lon, radius_mi)` — wraps EPA's public Envirofacts REST API (SEMS, TRI, RCRAInfo, ECHO)
  - `fetch_url(url)` — allowlist: `*.epa.gov`, `*.state.*.us`, `mass.gov`, known state cleanup registries
- **No Exa, no open web.**
- **Output findings shape:** `{sites: [{name, program, address, lat, lon, status, contaminants[], last_action_date, source_url}]}`

### 4.3 Historical Land Use Agent
- **Mission:** *"Reconstruct what has been on this parcel and its immediate block since ~1900. Prior industrial, commercial, or agricultural uses that could have left contamination. Cite every claim."*
- **Tools:**
  - `exa_search(query, options)` — primary research tool
  - `exa_get_contents(urls)` — read full page text
  - `fetch_url(url)` — open web, no allowlist
- **No EPA APIs** (forces it to find primary sources).
- **Output findings shape:** `{eras: [{years, use, evidence_quote, source_url, confidence}]}`
- **Example queries it forms on its own:** `"Sanborn map [city] [street] 1920"`, `"[address] historical business directory"`, `"[neighborhood] industrial history"`

### 4.4 Neighbor Threat Agent
- **Mission:** *"Identify currently-operating contamination sources within 0.5 miles: dry cleaners (TCE), gas stations (benzene/MTBE), auto body, metal plating, industrial facilities. Include recent news (fires, spills, violations)."*
- **Tools:**
  - `mapbox_places_nearby(lat, lon, radius_m, categories)` — finds businesses by category
  - `exa_search(query)` — for recent news
  - `fetch_url(url)` — open web
- **Output findings shape:** `{threats: [{name, type, distance_m, bearing_deg, known_contaminants[], recent_incidents[], source_url}]}`

### 4.5 Plume & Pathway Agent
- **Runs in:** Act 2 Wave B (after Regulatory / Historical / Neighbor finish)
- **Mission:** *"For each hazard the team found, estimate whether contamination could plausibly reach the target address via groundwater, surface water, or air. Reject hazards that can't physically reach; rank the rest."*
- **Tools:**
  - `read_findings(agentId)` — reads Wave A outputs
  - `usgs_groundwater_flow(lat, lon)` — wraps USGS NWIS for local flow direction
  - `noaa_wind_rose(lat, lon)` — prevailing wind direction from nearest station
  - `compute_geo(op, args)` — turf.js wrapper: bearing, distance, upwind/downwind
  - `fetch_url(url)` — allowlist: `*.usgs.gov`, `*.noaa.gov`
- **Output findings shape:** `{hazards: [{source_ref, pathway: 'groundwater'|'air'|'surface'|'soil', reachable: bool, reasoning, confidence}]}`
- **Why this agent is special:** it's the only specialist that reads other specialists' outputs mid-investigation. It's what makes the team feel like a team instead of 5 parallel API calls, and it's the agent most likely to surface the "dry cleaner 200ft upgradient" moment.

### 4.6 Risk Translation & Action Agent
- **Runs in:** Act 3, alongside Lead Investigator's synthesis
- **Mission:** *"Given the team's findings and the pathway analysis, translate technical contamination data into plain-language health context. Then identify actionable next steps: free testing programs, local advocacy groups, legal disclosure obligations for the state."*
- **Tools:**
  - `exa_search(query)` — for state-specific programs, advocacy groups
  - `fetch_url(url)` — open web
  - `read_findings(agentId)` — all prior agents
- **Output findings shape:** `{risk_summary: {level: 'low'|'moderate'|'high'|'severe', plain_english}, concerns: [{contaminant, what_it_is, health_effects, exposure_routes}], actions: [{type, title, description, url}]}`

---

## 5. Orchestration flow — the 3 acts (approved)

Three distinct demo beats, driven by `lib/orchestrator/run.ts`.

### Act 1 — Plan (~5s)
1. Orchestrator geocodes the address (Mapbox) → `{lat, lon, normalized_address}`
2. Spawns **Lead Investigator** with the address + agent roster descriptions
3. Lead Investigator writes a research plan out loud using `write_plan()`. Each `write_plan` call streams a `plan_chunk` event to the UI.
4. Lead Investigator emits dispatch instructions: for each specialist, a specific question to investigate.
5. Orchestrator validates the plan (must dispatch Regulatory + Historical + Neighbor in Wave A, Plume in Wave B, Risk Translation in Act 3), then proceeds.

### Act 2 — Research (~30s)
- **Wave A (parallel):** spawn Regulatory, Historical, Neighbor simultaneously. Each runs its own research loop, emits streaming events, exits with structured findings. Wall-clock cap: 30s.
- **Wave B (starts as soon as all 3 Wave A agents finish OR Wave A hits 30s cap):** spawn Plume agent with read-access to Wave A findings. 15s cap.

### Act 3 — Synthesis (~15s)
1. Re-spawn Lead Investigator with all Wave A + Wave B findings.
2. Lead Investigator optionally issues 1–2 follow-up queries (`followup(agentId, question)`) to any Wave A/B agent. Orchestrator re-spawns those agents with the focused question + their prior findings in context. This is the "the orchestrator is actually thinking" beat.
3. In parallel with follow-ups: spawn Risk Translation Agent with all findings so far.
4. Lead Investigator calls `write_report_section(id, markdown)` repeatedly to build the final report progressively. Each call emits a `report_chunk` event to the UI.
5. Done event closes the stream.

---

## 6. Event stream spec (proposed — review)

One SSE endpoint: `GET /api/investigate/:id/stream`. All events are JSON lines with a `type` discriminator. Event types:

```ts
type InvestigationEvent =
  | { type: 'session_started'; address: string; lat: number; lon: number }
  | { type: 'phase'; phase: 'planning' | 'research' | 'synthesis' }
  | { type: 'agent_spawned'; agentId: AgentId; mission: string; toolAllowlist: string[] }
  | { type: 'agent_reasoning'; agentId: AgentId; text: string }   // intermediate thinking
  | { type: 'tool_call'; agentId: AgentId; tool: string; argsSummary: string }
  | { type: 'tool_result'; agentId: AgentId; tool: string; summary: string }
  | { type: 'agent_finding'; agentId: AgentId; finding: string }  // human-readable bullet
  | { type: 'agent_done'; agentId: AgentId; status: 'ok' | 'degraded'; findings: unknown }
  | { type: 'plan_chunk'; text: string }
  | { type: 'followup'; fromAgent: AgentId; toAgent: AgentId; question: string }
  | { type: 'report_chunk'; sectionId: string; markdown: string }
  | { type: 'done' }
  | { type: 'error'; agentId?: AgentId; message: string };
```

The frontend is a pure consumer of this stream — no other data fetching on the investigation page.

---

## 7. UI — split-screen layout (proposed — review)

### Left panel — "Research Team" (60% width during Act 2, 40% in Act 3)
- Header: current phase indicator (`Planning / Researching / Synthesizing`)
- 6 agent cards in a vertical stack (Lead Investigator prominent at top, 5 specialists below):
  - Status dot (idle / running / done / degraded)
  - Mission line (truncated)
  - Tool allowlist badges (small pills — makes the sandbox story visible)
  - Streaming area: most recent 3 tool calls + findings bullets, auto-scroll
  - Budget bar: X/15 tool calls used, elapsed time
- Visual pacing: during Wave A, 3 cards are active simultaneously — this is the "it's really 5 things at once" moment

### Right panel — "Report" (40% width during Act 2, 60% in Act 3)
- Starts empty with placeholder: *"Report will build here as the team completes their research."*
- Fills progressively as `report_chunk` events arrive. Section order:
  1. **Address header** — normalized address, small Mapbox map with hazard pins
  2. **Overall risk** — color-coded badge (low/moderate/high/severe) + 2-sentence summary
  3. **Top concerns** — top 3–5 hazards with "why it matters in plain English"
  4. **Regulatory findings** — from Regulatory agent
  5. **Historical land use timeline** — from Historical agent, rendered as a vertical timeline
  6. **Active nearby threats** — from Neighbor agent, with distance/bearing
  7. **Pathway analysis** — from Plume agent, explaining which hazards can actually reach the address
  8. **What you can do** — from Risk Translation agent: testing programs, advocacy, legal disclosures

### Visual affordances
- Each report section has a small badge indicating which agent produced it — reinforces the team story
- Degraded agents show a visible "partial findings" marker in their card AND in the report section they contributed to
- Tool-call lines use a monospaced font; findings use serif — makes the distinction between "work" and "conclusions" visually obvious

---

## 8. Tools — implementation notes (proposed — review)

All tools live in `lib/agents/shared/tools.ts` and are registered per-agent at spawn time via the Codex SDK spawn wrapper in `lib/agents/shared/codex.ts`.

- `epa_envirofacts_query` — EPA Envirofacts is public REST, no auth. Docs: `https://www.epa.gov/enviro/web-services`. Returns raw JSON; tool wrapper trims to useful fields before handing to the agent.
- `exa_search` / `exa_get_contents` — thin wrappers around `exa-js`. Default `num_results: 8`, `use_autoprompt: true`.
- `mapbox_places_nearby` — Mapbox Search Box API with category filters. Requires `MAPBOX_TOKEN` env var.
- `usgs_groundwater_flow` — USGS NWIS has flow direction data at station level; wrapper finds nearest station via bounding-box query.
- `noaa_wind_rose` — NOAA Climate Data Online; wrapper finds nearest weather station and returns prevailing wind direction for the last 12 months.
- `compute_geo` — turf.js operations: `distance`, `bearing`, `is_upwind`, `is_upgradient`.
- `fetch_url` — simple wrapper around `fetch` with per-agent domain allowlist enforcement.

**Tool-call event emission:** every tool wrapper emits a `tool_call` event before execution and a `tool_result` event after. This happens in the orchestrator's tool-dispatch layer, not inside the agent, so the event stream is reliable even if the agent misbehaves.

---

## 9. Environment & secrets

Required env vars (place in `.env.local`):
```
OPENAI_API_KEY=              # or whatever Codex SDK needs
EXA_API_KEY=
MAPBOX_TOKEN=
```

No other secrets. EPA, USGS, NOAA are public + unauthenticated.

---

## 10. What's approved vs. proposed

| Section | Status |
|---|---|
| 1. Goal & scope | Approved |
| 2. Tech stack | Approved |
| 3. Architecture & file layout | Approved |
| 4. Agent roster (all 6) | Approved |
| 5. 3-act orchestration flow | Approved (in conversation) |
| 6. Event stream spec | **Proposed — needs review** |
| 7. Split-screen UI layout | **Proposed — needs review** |
| 8. Tool implementation notes | **Proposed — needs review** |

Sections 6–8 were not explicitly reviewed by the user in the brainstorming conversation; they are the designer's reasonable defaults consistent with the approved sections. The implementing agent should flag any of these they want to change before writing code.

---

## 11. Open questions for the implementing agent

1. **Codex SDK version & exact spawn API** — this spec assumes each agent spawn accepts `{systemPrompt, tools, toolAllowlist, networkAllowlist, budget}`. Verify against the current SDK; adapt the `codex.ts` wrapper if the shape differs.
2. **Follow-up round mechanics** — Act 3 follow-ups re-spawn a specialist with prior findings in context. Decide whether that's a fresh Codex session with context injected, or a resumed session if the SDK supports it.
3. **Geocoding failure** — if Mapbox can't resolve the address, the orchestrator currently has no fallback. Is "fail fast with a clear error" acceptable, or should we try a second geocoder?
4. **Demo pacing** — if Wave A agents finish in 4 seconds, the "dramatic parallel research" beat is lost. Should the orchestrator enforce a minimum Act 2 duration (e.g., 15s floor) for demo effect, or keep it honest?
5. **Degraded-agent UX** — when an agent hits its budget or times out, how prominently should the UI flag it? (Current proposal: visible marker but not alarming.)

---

## 12. Suggested implementation order

1. **Skeleton** — Next.js app, SSE route that emits a fake event sequence, split-screen UI that renders it. Proves the pipe works end-to-end with zero agents.
2. **Codex SDK wrapper** — `lib/agents/shared/codex.ts` with spawn, tool registration, allowlist enforcement, event emission, budget/timeout. Test with a single dummy agent.
3. **Tools** — implement all tools in `lib/agents/shared/tools.ts`. Each tool gets a unit test that hits the real upstream (EPA, Exa, etc.) once.
4. **Regulatory Agent** — simplest specialist (narrowest tool set). Verify it can actually find real Superfund sites for a known address.
5. **Historical Agent** — second, because it's Exa-only and independent.
6. **Neighbor Agent** — third.
7. **Plume Agent** — once Wave A works, add the Wave B wiring.
8. **Lead Investigator + Risk Translation** — the Act 3 synthesis loop. Test the full 3-act flow end-to-end.
9. **UI polish** — map rendering, report typography, agent card streaming animations, degraded-state markers.
10. **Demo hardening** — pick 2–3 hero addresses, verify the team reliably surfaces interesting findings on them, tune budgets and timeouts.

Expect most of the hackathon time to land in steps 2, 3, and 10. Steps 4–8 are relatively mechanical once the wrapper and tools are solid.
