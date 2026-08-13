#!/usr/bin/env bash
# Stop every PyAI Scrib / pyai-desktop copy.
set -u
killed=0
if killall -9 "PyAI Scrib" 2>/dev/null; then
  killed=1
fi
if pkill -9 -x pyai-desktop 2>/dev/null; then
  killed=1
fi
if pkill -9 -f "PyAI Scrib.app/Contents/MacOS" 2>/dev/null; then
  killed=1
fi
sleep 0.3
if pgrep -fl "PyAI Scrib|pyai-desktop" >/dev/null 2>&1; then
  echo "Still running:"
  pgrep -fl "PyAI Scrib|pyai-desktop" || true
  exit 1
fi
if [[ "$killed" -eq 1 ]]; then
  echo "PyAI Scrib quit."
else
  echo "PyAI Scrib was not running."
fi
