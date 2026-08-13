#!/bin/sh
# After every git pull: pull/rebuild images and restart the stack.
# Attendee (Chrome) is pulled from GHCR when possible — local build is fallback.
set -eu
cd "$(dirname "$0")/.."

DEFAULT_ATTENDEE_IMAGE="ghcr.io/praneethnagelli-saaslabs/pyai-suite/attendee:latest"

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env from .env.example (add PYAI/OPENAI/GEMINI keys locally if you have them)."
fi

attendee_image() {
  if [ -n "${ATTENDEE_IMAGE:-}" ]; then
    printf '%s' "$ATTENDEE_IMAGE"
    return
  fi
  if [ -f .env ]; then
    line="$(grep -E '^ATTENDEE_IMAGE=' .env | tail -n 1 || true)"
    val="${line#ATTENDEE_IMAGE=}"
    val="$(printf '%s' "$val" | tr -d '"' | tr -d "'")"
    if [ -n "$val" ]; then
      printf '%s' "$val"
      return
    fi
  fi
  printf '%s' "$DEFAULT_ATTENDEE_IMAGE"
}

IMAGE="$(attendee_image)"

if docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "Using cached Attendee image: $IMAGE"
elif docker pull "$IMAGE"; then
  echo "Pulled Attendee from GHCR: $IMAGE"
else
  echo "GHCR pull failed — building Attendee from source (several minutes)…"
  docker compose build attendee-app
fi

echo "Rebuilding api, web, and worker…"
docker compose build api web worker
docker compose up -d
echo
docker compose ps
echo
echo "Synced. Hard-refresh http://localhost:3000 (Cmd+Shift+R / Ctrl+Shift+R)."
echo "CallIQ bot: admit CallIQ Bot once (Meet → People)."
