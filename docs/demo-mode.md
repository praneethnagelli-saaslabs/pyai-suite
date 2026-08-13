# Demo Mode (spec #94)

Every product ships a Demo Mode that works WITHOUT provider credentials.

Mechanism:
- The MockProvider (deterministic, no network) supplies believable, evidence-linked
  outputs for STT/LLM/TTS/Embeddings.
- Sample datasets live in `evals/<product>/` and `/api/sample/<product>`.
- UI shows a clear "DEMO DATA" badge whenever synthetic output is shown, so users
  never confuse demo output with a real provider call.

Hard rule (spec #130): never fabricate real provider latency/scores. Demo
numbers come only from the mock or from explicitly recorded sample fixtures.
