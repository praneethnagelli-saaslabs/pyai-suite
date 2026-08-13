#!/bin/sh
# Load ATTENDEE_API_KEY from the Compose bootstrap volume when .env is empty.
# Never prints the token.
set -e
KEY_FILE="${ATTENDEE_BOOTSTRAP_KEY_FILE:-/shared/attendee_api_key}"

if [ -z "${ATTENDEE_API_KEY:-}" ]; then
  i=0
  while [ ! -s "$KEY_FILE" ] && [ "$i" -lt 90 ]; do
    i=$((i + 1))
    sleep 2
  done
  if [ -s "$KEY_FILE" ]; then
    ATTENDEE_API_KEY="$(tr -d '\r\n' < "$KEY_FILE")"
    export ATTENDEE_API_KEY
    echo "api: ATTENDEE_API_KEY loaded from Attendee bootstrap volume"
  else
    echo "api: Attendee bootstrap key not ready; CallIQ bots stay unconfigured"
  fi
else
  echo "api: using ATTENDEE_API_KEY from environment"
fi

if [ "$#" -eq 0 ]; then
  echo "api: no command given after loading Attendee key" >&2
  exit 1
fi
exec "$@"
