# API

Clean, versioned REST API with an OpenAPI document (spec #77). Typed clients are
generated from the OpenAPI schema.

## Routes
```
POST /v1/transcriptions        transcribe audio (STT capability)
POST /v1/meetings              ingest a meeting recording/transcript
POST /v1/calls/analyze         CallIQ Hear → Recap loop (audio or transcript)
POST /v1/benchmarks            run a provider/model benchmark
POST /v1/playground/runs       universal playground capability run
GET  /v1/runs/:id              run record + provider-call trace
GET  /v1/providers             registered providers + configured flags
GET  /v1/models                all models across configured providers
GET  /v1/capabilities          capability vocabulary
POST /v1/route                 routing decision for a capability + policy
```

All responses are JSON. Errors carry `{ error, reason }`. No secrets are ever
returned. Streaming endpoints (STT partials, LLM tokens, TTS bytes) use SSE /
WebSocket as appropriate and never base64 audio in JSON on the hot path.

## OpenAPI
The canonical OpenAPI 3.1 document lives at `apps/api/openapi.yaml` and is
served at `/openapi.json`. `apps/web` and external agents consume it.

## Typed client
`tools/client` generates a TypeScript client from `openapi.yaml` (no hand-rolled
fetch wrappers in product code).
