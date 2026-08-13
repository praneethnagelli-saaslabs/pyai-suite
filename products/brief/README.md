# Brief

> A local-first meeting brain.

```bash
# API running
curl -s http://localhost:4000/api/sample/brief | \
  curl -s http://localhost:4000/api/brief/analyze -H 'content-type: application/json' -d @-
```

Or open http://localhost:3000/brief

Privacy indicator shows mic/local vs uploaded provider. Meeting memory is searchable.
