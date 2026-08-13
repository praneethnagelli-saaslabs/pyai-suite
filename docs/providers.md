# Providers

PyAI Suite never calls vendor SDKs from product code. Providers implement
capability adapters and register with the shared registry.

## PyAI (primary)

Docs: [Quickstart](https://docs.pyai.com/quickstart)

| Surface | Capability | Endpoint |
|---------|------------|----------|
| **Hear** (sync) | `batch_stt` / `streaming_stt` | `POST /v1/audio/transcriptions` (`model=pyai-hear`) |
| **Hear** (batch / Recap) | `batch_stt` + `speaker_diarization` | `POST /v1/transcription/jobs` (`diarize: true`) |
| **Speak** | `tts` | `POST /v1/audio/speech` (`model=pyai-voice`) |
| **Omni** | `realtime_voice` | WebSocket realtime (see Omni guide) |
| **Whoami** | health | `GET /v1/me` |

PyAI does **not** expose a public `/v1/chat/completions`. Text LLM (Recap summaries, deal extraction) uses OpenAI / Gemini / mock.

### Brief Hear + summary loop

Same Hear primitive, meeting-notes instead of deal Recap:

1. **Hear** — live Meet chunks use sync `/v1/audio/transcriptions`; uploads use diarized batch jobs.
2. **Summary** — structured brief (summary, decisions, actions) via the configured analysis LLM.

### CallIQ Hear + Recap loop

[Conversation intelligence](https://docs.pyai.com/guides/conversation-intelligence):

1. **Hear** — diarized batch job (`/v1/transcription/jobs`) when audio is present; inline transcript for Meet-bot / demo.
2. **Recap** — talk-ratio + keyword hits from Hear segments, then structured deal notes via the configured analysis LLM.

Base URL: `https://api.pyai.com` (OpenAI-compatible under `/v1`).

Auth: `Authorization: Bearer <key>` (alias: `x-api-key`).

### Instant sandbox key

No signup, email, or card — daily-capped `pyai_test_` key:

```bash
export PYAI_API_KEY="$(
  curl -sS -X POST https://api.pyai.com/v1/sandbox/keys \
    | python -c 'import json,sys; print(json.load(sys.stdin)["api_key"])'
)"
curl https://api.pyai.com/v1/me -H "Authorization: Bearer $PYAI_API_KEY"
```

Or via this repo:

```bash
pnpm --filter @pyai/cli start setup --sandbox
```

Production keys (`pyai_live_`) come from the [PyAI console](https://console.pyai.com).

## Other providers

OpenAI, Gemini, and Mock register the same capability interfaces. Routing
policies (`cheapest` / `fastest` / `best_quality` / `balanced` / `fallback`)
pick among configured adapters. **Default order is always PyAI → OpenAI → Gemini → Mock.**
PyAI has no public chat API, so LLM / Recap / Summary / cleanup fall through to
OpenAI or Gemini when those keys exist. Mock is always available for offline Demo Mode.

## Adding a provider

1. Implement the relevant adapters in `packages/core/src/providers/`.
2. Register in `createPlatform()`.
3. Add contract tests — no product code changes.
