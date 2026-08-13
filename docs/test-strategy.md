# Test Strategy (spec #86, #87, #88, #89)

## Levels
- Unit: engine, gates, budget, retry, registry routing, editable-target, prompts, webhooks, flags, control plane, integrations.
- Provider contract (#87): one shared suite runs against EVERY adapter (capability, health, streaming, error handling, usage reporting). New provider = add adapter + register; suite covers it.
- Workflow (#86): full CallIQ analysis runs offline against MockProvider.
- Integration: Fastify server booted in-process.
- E2E (Playwright): reserved for web UI (command palette, playground, run explorer).
- Performance (#89): benchmarks for STT first partial / final, LLM first token, TTS first byte, workflow completion, search, DB, extension insertion latency; tracked for regressions.
- Failure (#88): ChaosProvider injects timeout/500/malformed-JSON/slow/drop/rate-limit; verifies retry, fallback, failure record, budget enforcement.

## CI
No real provider keys. Provider paths exercised via MockProvider + contract fixtures only.
