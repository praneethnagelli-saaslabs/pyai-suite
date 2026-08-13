# Scrib

Universal voice dictation on the shared PyAI Suite platform.

## Layout

- `products/scrib` — cleanup workflow, app modes, dictionary
- Chrome extension under `apps/extension` (when present)

## Quick demo

```bash
curl -s http://localhost:4000/api/scrib/dictate \
  -H 'content-type: application/json' \
  -d '{"text":"um so like can you send that"}'
```

UI: http://localhost:3000/scrib

## License

MIT — Runs on PyAI.
