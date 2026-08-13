# Voice Agent Simulator

Hamming-style voice lab: live call, versioned agents, scenarios, and an AI customer.

## Live call

Open http://localhost:3000/simulator → **Live call** → Start simulation.

**Agents** saves named configs as versions (edit → save snapshot → activate to roll back). **Persona** runs an AI customer against a scenario — no microphone. **Scenarios** upgrades the old persona catalog with goals, expected behavior, and failure conditions. **Regression** is still the batch text stress test.

```
Browser mic (PCM16 24 kHz)
        ↓
Suite API  /ws/simulator/call   ← keys stay here
        ↓
PyAI Omni  →  OpenAI Realtime  →  mock
```

Fallback is recorded on the session (`fallback_used`, `reason`, `provider`). It is never silent. The browser never receives API keys.

## Regression (batch)

```bash
curl -s http://localhost:4000/api/simulator/run \
  -H 'content-type: application/json' \
  -d '{"agentName":"Acme Receptionist","count":10,"llmProvider":"mock"}'
```

Adversarial text callers → heuristic scores → benchmark card.
