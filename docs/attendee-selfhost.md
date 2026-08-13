# Attendee (CallIQ meeting bot)

Attendee is part of the **main** Docker Compose stack (not optional).

## Start

```bash
cp .env.example .env
pnpm docker:sync    # or: sh scripts/docker-sync.sh
```

Run that after every `git pull`. It rebuilds api/web/worker and **pulls** the Attendee+Chrome image from GHCR when possible (`ghcr.io/praneethnagelli-saaslabs/pyai-suite/attendee:latest`). Local Chrome compile is only the fallback if the pull fails.

Services include `attendee-app` (:8000), `attendee-worker`, `attendee-scheduler`, plus its own Postgres/Redis. All three reuse the same image (`linux/amd64`).

After Attendee is cached, rebuild only the suite with:

```bash
docker compose up --build -d --no-deps api web worker
```

To force a fresh Attendee image: `docker pull ghcr.io/praneethnagelli-saaslabs/pyai-suite/attendee:latest` or `docker compose build --no-cache attendee-app`.

The GHCR package must be **public** (GitHub → Packages → attendee → Change visibility) so teammates can pull without a token. CI workflow `.github/workflows/attendee-image.yml` publishes it on demand / weekly / when compose sync files change.

## Connect CallIQ

Compose starts **Attendee first**, migrates the DB, mints a local API key into a shared volume, then starts the suite API which loads that key into `ATTENDEE_API_KEY`. You do **not** need to paste a key into `.env` for Docker.

1. Wait until `attendee-app` is healthy and `api` is up (`docker compose ps`).
2. Optional UI login: http://localhost:8000 with `calliq@local.test` / `pyai-local-dev-only` (override via `ATTENDEE_BOOTSTRAP_EMAIL` / `ATTENDEE_BOOTSTRAP_PASSWORD` in `.env`).
3. Open a real Google Meet (or Zoom), copy the invite URL, CallIQ → paste → **Join Meet as bot**.
   Admit **CallIQ Bot** when it knocks. Attendee does **not** create Meet rooms.

To use your own key instead of bootstrap: set `ATTENDEE_API_KEY` in `.env` (takes precedence) or `ATTENDEE_SKIP_BOOTSTRAP=1`.

The raw token is never written to `.env` or logs — only to the Docker volume `attendee_bootstrap`.

Compose sets `ALLOWED_HOSTS` to include `attendee-app` so the suite API can call Attendee over the Docker network.

## Recordings (MinIO)

Attendee uses the suite **MinIO** service (S3-compatible). Defaults in `.env.example`:

```bash
AWS_ENDPOINT_URL=http://minio:9000
AWS_RECORDING_STORAGE_BUCKET_NAME=attendee-recordings
AWS_ACCESS_KEY_ID=minioadmin
AWS_SECRET_ACCESS_KEY=minioadmin
AWS_DEFAULT_REGION=us-east-1
```

`minio-init` creates the `attendee-recordings` bucket on startup. Console: http://localhost:9001

No AWS cloud account required for local demos.
