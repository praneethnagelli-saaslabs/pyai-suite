# Voice Agent Simulator

> The crash-test dummy laboratory for voice agents.

```bash
curl -s http://localhost:4000/api/simulator/run \
  -H 'content-type: application/json' \
  -d '{"agentName":"Acme Receptionist","count":10,"llmProvider":"mock"}'
```

Or open http://localhost:3000/simulator — run N adversarial callers, get a shareable benchmark card.
