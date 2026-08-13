# Testing

Layered, fast, no real provider keys required (spec #86, #116).

## Levels
- **Unit** (Vitest): core engine, gates, budget, retry, registry routing,
  editable-target, prompt registry, webhooks, control plane, integrations.
- **Contract tests**: every provider adapter implements the capability
  interfaces; the MockProvider is the reference contract. Provider tests use
  mocks/fixtures, never live credentials in CI.
- **Workflow tests**: full CallIQ analysis runs end-to-end against MockProvider
  (transcribe → extract → evidence gate → verify) offline.
- **Integration** (API): Fastify server booted in-process; hits providers, runs,
  playground, `/v1/*`, OpenAPI.
- **E2E** (Playwright): reserved for the web UI once built (command palette,
  playground, run explorer). Not yet present.
- **Golden dataset evals**: `pnpm eval` runs `evals/<product>/*` with
  input/expected/criteria/scoring.

## Rules
- CI runs lint + typecheck + unit + integration + build + Docker build + security
  scan WITHOUT provider credentials.
- Provider-dependent paths are exercised only by mocks/contract fixtures.
- No test depends on network egress.

## Run
```
pnpm test        # vitest across workspace
pnpm typecheck   # tsc --noEmit across workspace
pnpm lint
pnpm build
pnpm eval        # golden-dataset evals (per product)
pnpm benchmark   # provider comparison harness
```
