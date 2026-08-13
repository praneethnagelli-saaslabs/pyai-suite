# Error UX (spec #92)

Never show "Something went wrong." Every error carries actionable context.

Required shape:
```
Transcript failed
Provider: PyAI Hear
Reason: Connection timeout after 2.0s
Attempt: 2/3
Fallback: OpenAI
[Retry] [Switch provider] [View trace]
```

Rules:
- Surface provider + reason + attempt + fallback (from RunProvenance / RetryRecord).
- Offer Retry, Switch provider, View trace (link to run explorer).
- Errors are derived from structured run/task status, not raw exception text.
- Never log or render secrets in the error surface.
