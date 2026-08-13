# Architecture

PyAI Suite is a **modular monorepo** (pnpm workspaces + Turborepo). One shared
platform, multiple products on top of it.

```
packages/core      @pyai/core   — provider registry, workflow engine, gates,
                                  budget governor, tracer, retry, adapters
packages/db        @pyai/db     — run store (memory or Postgres)
products/calliq    @pyai/calliq — sales-call intelligence
products/scrib     @pyai/scrib — voice dictation + cleanup
products/brief     @pyai/brief — local-first meeting brain
products/simulator @pyai/simulator — voice-agent stress tests
apps/api           @pyai/api    — Fastify API (+ /api/jobs, /ws/runs)
apps/web           @pyai/web    — React/Vite UI
apps/extension     Scrib Chrome MV3 (mic + insert)
apps/desktop       Tauri bridge scaffold
apps/worker        Async jobs (memory or BullMQ/Redis)
tools/cli          @pyai/cli
tools/mcp          @pyai/mcp
evals/             Golden datasets + offline runner
```

## Layering rule (no cross-contamination)

```
Product / UI
   ↓  (asks: "give me an STT adapter for capability X")
Workflow / Agent
   ↓
Capability Registry  (knows which provider supports which capability)
   ↓
Provider Router      (policy: cheapest/fastest/best_quality/balanced/fallback + circuit breaker)
   ↓
Provider Adapter     (PyAI / OpenAI / Gemini / mock / future)
   ↓
Vendor SDK / HTTP
```

Product code NEVER calls a vendor SDK directly. Adding a provider = implement
the capability interfaces + register. Adding a product = reuse registry,
workflow engine, playground, runs, traces, budgets, evals, storage.

## Hard constraints

### Extension must not be coupled to individual websites (Scrib)

The Chrome MV3 extension inserts text into **generic editable surfaces only**:

- `<textarea>`, `<input>`
- `contenteditable` elements (rich editors)
- elements exposing a standard selection/range API

It MUST NOT contain per-domain hardcoded insertion logic (no "if host ===
gmail.com do X", no site-specific selectors baked into the background worker).

Site-specific *behavior* is allowed only as **configuration**, not code:

- App-aware writing modes (Slack→casual, Gmail→polished, GitHub→technical…)
  are user-defined rules keyed on the active application/title, evaluated by the
  shared cleanup pipeline — not by the extension.
- New sites work automatically because they are just "another editable element".

Rationale: robustness, OSS credibility, and "works on sites we never heard of".

### No silent failures

Every workflow ends in an explicit status
(`SUCCEEDED | PARTIAL | FAILED | BUDGET_EXCEEDED | TIMEOUT | CANCELLED`).
Gates BLOCK bad output. Retries are bounded and reason-logged.

### No fake intelligence (spec #130)

Latency, quality, and benchmark numbers are reported only when actually
measured. The built-in MockProvider is deterministic and clearly labeled; it is
for offline dev/demo, not a stand-in for real metrics.

### Privacy by default (spec #101)

Audio/captured content stays local until the user explicitly selects a remote
provider. Secrets are never returned to the frontend. The Data Flow screen shows
exactly what goes where.
