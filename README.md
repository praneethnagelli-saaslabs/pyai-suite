# PyAI Suite

Open-source AI product suite on a **provider-agnostic voice/AI platform**, with **PyAI** as the primary provider.

> One reusable AI/voice platform + four products on top of it.

| Product | Pitch | Demo status |
|---------|-------|-------------|
| **CallIQ** | Sales-call intelligence | **Product demo** (simulated Meet) or **Join Meet as bot** (Attendee) → deal intel |
| **Scrib** | Voice typing + cleanup | **Run demo** + hold-to-talk (Speak→Hear→cleanup) |
| **Brief** | Local-first meeting brain | **Live Meet capture** (no bot) + sample demo → notes → memory |
| **Simulator** | Adversarial agent stress tests | **Run demo** works (callers → scores → benchmark card) |

## Quick start (≈5 minutes)

```bash
git clone <repo>
cd pyai-suite
cp .env.example .env
pnpm install
pnpm --filter @pyai/api dev   # http://localhost:4000
pnpm --filter @pyai/web dev   # http://localhost:3000
```

Or with Docker:

```bash
cp .env.example .env
# After clone, and after every git pull:
pnpm docker:sync
# same as: sh scripts/docker-sync.sh
# Attendee+Chrome is pulled from GHCR (no 5–10 min local Chrome build)
# open http://localhost:3000
# Attendee starts first, mints a local API key, and the suite API loads it automatically
# Attendee UI: http://localhost:8000  (calliq@local.test / pyai-local-dev-only)
```

No API keys required for Demo Mode — the built-in **MockProvider** powers offline demos.

### Connect PyAI (optional, ~30s)

Instant sandbox key — no signup, email, or card ([docs](https://docs.pyai.com/quickstart)):

```bash
pnpm --filter @pyai/cli start setup --sandbox
```

API is OpenAI-compatible at `https://api.pyai.com/v1`. See [docs/providers.md](docs/providers.md).

## What you can do first

1. Open http://localhost:3000
2. **CallIQ** → Run product demo (simulated Meet) or Join Meet as bot (Attendee) → deal notes
3. **Scrib** → Run demo or Hold to talk → before/after
4. **Brief** → Capture Meet audio (tab, no bot), or Run sample demo
5. **Simulator** → Run demo → benchmark card
6. Open **Runs** / **Playground** / **Providers** (`⌘K`)

Meeting bots: [docs/meeting-bots.md](docs/meeting-bots.md). Google Meet without the extension: [docs/google-meet.md](docs/google-meet.md).

## Chrome extension

Unpacked MV3 in `apps/extension` — CallIQ bot join, Brief Meet capture, and Scrib dictation. API (`:4000`) and web (`:3000`) must already be running.

1. Open `chrome://extensions`
2. Turn on **Developer mode**
3. **Load unpacked** → select `apps/extension`
4. Pin **PyAI Suite**

| Use | How |
|-----|-----|
| **CallIQ** | Popup → **Start call with CallIQ Bot** or **Bring bot into this Meet**. Stay in Meet — transcript is in the CallIQ **side panel** (not a new tab). Admit **one** CallIQ Bot. |
| **Brief** | Popup → **Open Meet + Brief**, or join Meet first → **Capture this Meet in Brief**. In Brief, share the Meet tab with tab audio on (no bot). |
| **Scrib** | Hold **Control+Shift+1** (⌃, not ⌘), speak, release to paste. Or hold **Hold to talk** in the popup. |

Reload the extension after every code change. More detail: [apps/extension/README.md](apps/extension/README.md). Provider keys stay in API `.env` — the extension never sees them.

## Monorepo layout

```
apps/api              Fastify API (+ /api/jobs, /ws/runs)
apps/web              React + Vite UI (all four products)
apps/extension        Chrome MV3 (CallIQ bot, Brief capture, Scrib dictation)
apps/desktop          Tauri bridge scaffold
apps/worker           Async jobs (memory or BullMQ/Redis)
packages/core         Registry, workflows, gates, budget, tracer, PyAI adapter
packages/db           Run store (memory or Postgres)
packages/control      Action-oriented command plane
packages/integrations Slack / Notion / webhook adapters
products/calliq     Sales-call intelligence
products/scrib  Dictation cleanup + editable targets
products/brief  Meeting notes + memory
products/simulator    Adversarial voice-agent stress tests
tools/cli             ai-suite doctor | setup --sandbox | demo
tools/mcp             Agent tools over the suite API
evals/                Golden datasets + pnpm eval
```

## Scripts

```bash
pnpm typecheck
pnpm test
pnpm eval
pnpm --filter @pyai/web build
```

CI runs without real provider credentials.

## Docs

- [Architecture](docs/architecture.md)
- [Providers (PyAI)](docs/providers.md)
- [Security](docs/security.md)
- [Design](docs/design.md)
- [API](docs/api.md)
- [Demo mode](docs/demo-mode.md)
- [Meeting bots (CallIQ)](docs/meeting-bots.md)
- [Chrome extension](apps/extension/README.md)
- [Self-host Attendee](docs/attendee-selfhost.md) (GHCR image + main `docker compose up`)
- [PyAI Quickstart](https://docs.pyai.com/quickstart)

## License

MIT
