# PyAI Suite

Four AI products that share one voice platform. **PyAI** is tried first when it can do the job; if it can’t, the app falls back (and shows that in the UI).

| Product | What it does (plain English) |
|---------|------------------------------|
| **CallIQ** | Listens to a sales call → writes deal notes |
| **Scrib** | You speak → cleaned text ready to paste |
| **Brief** | Listens to a meeting → notes + search memory |
| **Simulator** | Practice / stress-test a live voice agent |

You do **not** need API keys to click around. Without keys, **Mock** still runs demos.

---

## What you need on your computer

1. **Docker Desktop** (or Docker Engine + Compose) — easiest way to run everything  
2. **Git**  
3. Optional later: **Node 20+** and **pnpm** (only if you run without Docker)

---

## Start everything (recommended)

Copy-paste these in a terminal:

```bash
git clone <this-repo-url>
cd pyai-suite
cp .env.example .env
pnpm docker:sync
```

(`pnpm docker:sync` is the same as `sh scripts/docker-sync.sh`.  
It builds/starts the stack. First time can take a few minutes.)

Then open:

| Where | URL / login |
|-------|-------------|
| **The app (start here)** | http://localhost:3000 |
| API | http://localhost:4000 |
| Attendee (CallIQ bot helper) | http://localhost:8000 |
| Attendee **username** | `calliq@local.test` |
| Attendee **password** | `pyai-local-dev-only` |

(Those Attendee login values are the Docker defaults from `.env.example`. Change them only if you set `ATTENDEE_BOOTSTRAP_EMAIL` / `ATTENDEE_BOOTSTRAP_PASSWORD` in `.env`.)

**After every `git pull`**, run again:

```bash
pnpm docker:sync
```

Then hard-refresh the browser: **Cmd+Shift+R** (Mac) or **Ctrl+Shift+R** (Windows/Linux).

> The web UI is baked into Docker. Changing frontend code without rebuilding `web` will not show up.

---

## Optional: turn on real AI (PyAI / OpenAI)

Demos work with **Mock**. For real Hear / Speak / notes:

1. Open `.env`
2. Add keys you have (empty = skip that provider):

```bash
PYAI_API_KEY=          # best first choice for voice
OPENAI_API_KEY=        # fallback + chat notes
GEMINI_API_KEY=        # optional
```

Or mint a PyAI sandbox key (no signup):

```bash
pnpm --filter @pyai/cli start setup --sandbox
```

3. Restart API (Docker):

```bash
docker compose up -d api
```

4. In the app → **Providers** → check health (green = key works).

**Tip:** “Healthy” means the key works. If Hear is slow/fails, the app may **fall back** for a few minutes and show a banner — that is normal.

---

## What to click for each product

Open http://localhost:3000 first.

### CallIQ — sales call notes

**You need:** suite running (`pnpm docker:sync`).

| Goal | What to do |
|------|------------|
| Fast demo (no real Meet) | **CallIQ** → **Run product demo** |
| Real Meet with a bot | **CallIQ** → paste Meet link → **Join Meet as bot** → in Meet **admit CallIQ Bot once** |
| Upload a recording | **CallIQ** → upload audio → wait for Hear + recap |

Bot admin UI (only if you need to poke Attendee directly):

| | |
|--|--|
| URL | http://localhost:8000 |
| Username | `calliq@local.test` |
| Password | `pyai-local-dev-only` |

More: [docs/meeting-bots.md](docs/meeting-bots.md)

---

### Scrib — speak → clean text

**You need:** suite running.

| Goal | What to do |
|------|------------|
| See the pipeline | **Scrib** → **Try demo** (Speak → Hear → cleanup) |
| Use your mic | **Scrib** → hold to talk → copy cleaned text |

Chrome shortcut (extension loaded): hold **Control+Shift+1**, speak, release to paste.

---

### Brief — meeting notes (no bot)

**You need:** suite running. For live Meet: Chrome + tab audio share.

| Goal | What to do |
|------|------------|
| Sample meeting | **Brief** → sample / demo |
| Live Meet (no bot) | **Brief** → **Capture Meet** → share the **Meet Chrome Tab** + turn on **Also share tab audio** → **End meeting → notes** |
| Upload a file | **Brief** → upload recording → notes + optional playback |
| Past meetings | **Brief** → pick a meeting in the left list |
| Search memory | **Brief** → type a question in search |

---

### Simulator — practice calls

**You need:** suite running. Real voice works better with **PyAI** (or OpenAI) in `.env`.

| Goal | What to do |
|------|------------|
| Live call | **Simulator** → start a call |
| Persona mode | **Simulator** → Persona |
| Scores / compare | **Simulator** → Dashboard / Compare |
| Stress test | **Simulator** → Run stress test |

---

## Chrome extension (optional)

Helps CallIQ bot join, Brief Meet capture, and Scrib paste.

**You need:** suite already running on `:3000` and `:4000`.

1. Open `chrome://extensions`
2. Turn on **Developer mode**
3. **Load unpacked** → choose folder `apps/extension`
4. Pin **PyAI Suite**

Reload the extension after code changes. Details: [apps/extension/README.md](apps/extension/README.md)

---

## Run without Docker (developers)

```bash
cp .env.example .env
pnpm install
pnpm --filter @pyai/api dev    # http://localhost:4000
pnpm --filter @pyai/web dev    # http://localhost:3000
```

Postgres / Redis / MinIO / Attendee still need Docker if you want those features:

```bash
docker compose up -d postgres redis minio attendee-app
```

---

## Handy commands

| Command | When |
|---------|------|
| `pnpm docker:sync` | First start + after every git pull |
| `docker compose up -d` | Start stack (images already built) |
| `docker compose build api web && docker compose up -d api web` | After API/UI code changes |
| `docker compose ps` | See what’s running |
| `docker compose logs -f api` | Watch API errors |
| `pnpm test` | Run tests |
| `pnpm typecheck` | TypeScript check |

macOS menu-bar Scrib: `pnpm --filter @pyai/desktop dev` — see [apps/desktop/README.md](apps/desktop/README.md)

---

## Folder map (don’t memorize — just in case)

```
apps/api          Backend
apps/web          Website (all four products)
apps/extension    Chrome extension
apps/desktop      macOS tray Scrib
apps/worker       Background jobs
products/*        CallIQ, Scrib, Brief, Simulator logic
packages/core     Shared AI platform (PyAI first)
docs/             Deeper docs
```

---

## More docs

- [Pitch + demo (all products)](docs/pitch-pyai-suite.md)
- [Architecture](docs/architecture.md)
- [Providers (PyAI)](docs/providers.md)
- [Security](docs/security.md)
- [API](docs/api.md)
- [Demo mode](docs/demo-mode.md)
- [Meeting bots](docs/meeting-bots.md)
- [Google Meet (no extension)](docs/google-meet.md)
- [Self-host Attendee](docs/attendee-selfhost.md)
- [PyAI quickstart](https://docs.pyai.com/quickstart)

## License

MIT
