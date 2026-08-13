#!/bin/sh
# After every git pull: rebuild suite images and restart the stack.
# Builds Attendee (Chrome) only when pyai-attendee:local is missing.
set -eu
cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env from .env.example (add PYAI/OPENAI/GEMINI keys locally if you have them)."
fi

if ! docker image inspect pyai-attendee:local >/dev/null 2>&1; then
  echo "No pyai-attendee:local image — building Attendee once (several minutes)…"
  docker compose build attendee-app
fi

echo "Rebuilding api, web, and worker…"
docker compose build api web worker
docker compose up -d
echo
docker compose ps
echo
echo "Synced. Hard-refresh http://localhost:3000 (Cmd+Shift+R / Ctrl+Shift+R)."
echo "CallIQ bot: admit CallIQ Bot and turn on Meet captions (English)."
