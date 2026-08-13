# CallIQ

> Sales-call intelligence with evidence-backed deal notes.

Sales-call intelligence on the shared PyAI Suite platform.

## Quick demo

```bash
# from repo root, with API running
pnpm --filter @pyai/cli start demo
# or open http://localhost:3000/calliq?demo=1
```

## Loop

```
transcript / audio
  → STT (capability registry)
  → parallel extraction
  → evidence gate
  → multi-model verification
  → deal notes + CRM JSON
```

Every important claim carries provenance (speaker + timestamp). Gates `BLOCK` unsupported claims. Runs appear in the universal Runs explorer with cost/latency.

## Providers

Default demo path uses **MockProvider** (no keys). Set `PYAI_API_KEY` / `OPENAI_API_KEY` / `GEMINI_API_KEY` in `.env` to switch providers without redeploying.

## License

MIT — Runs on PyAI.
