#!/usr/bin/env bash
# Build the official Tauri .app (UI + tray + hotkey) and launch one instance.
set -euo pipefail

export PATH="${HOME}/.cargo/bin:/opt/homebrew/bin:/usr/local/bin:${PATH}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TAURI="$ROOT/src-tauri"
# Keep the .app inside the repo even if the shell exported CARGO_TARGET_DIR.
export CARGO_TARGET_DIR="$TAURI/target"
APP="$CARGO_TARGET_DIR/debug/bundle/macos/PyAI Scrib.app"
STABLE="${HOME}/Applications/PyAI Scrib.app"

if ! command -v cargo >/dev/null 2>&1; then
  echo "Rust/cargo not found. Install once:"
  echo "  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"
  echo "  source \"\$HOME/.cargo/env\""
  exit 1
fi

if curl -sf --max-time 2 "http://127.0.0.1:4000/health" >/dev/null; then
  echo "API ok — http://127.0.0.1:4000"
else
  echo "WARNING: suite API is not up on http://127.0.0.1:4000"
  echo "  Start it first:  pnpm --filter @pyai/api dev"
fi

echo "Stopping any previous Scrib…"
bash "$ROOT/scripts/quit.sh" || true

echo "Building PyAI Scrib.app…"
(
  cd "$ROOT"
  PATH="$HOME/.cargo/bin:$PATH" pnpm exec tauri build --debug --bundles app
)

if [[ ! -d "$APP" ]]; then
  echo "Build did not produce $APP"
  exit 1
fi

# Bind identifier com.pyai.suite so System Settings is not a random pyai_desktop-* hash.
codesign --force --deep --sign - --identifier com.pyai.suite "$APP" >/dev/null 2>&1 || true

mkdir -p "$HOME/Applications"
rm -rf "$STABLE"
ditto "$APP" "$STABLE"
codesign --force --deep --sign - --identifier com.pyai.suite "$STABLE" >/dev/null 2>&1 || true

echo
echo "Starting PyAI Scrib from $STABLE"
echo "  (That is your user Applications folder, not /Applications in the sidebar.)"
echo "  Hold Control+Shift+1 — bezel should say Listening"
echo "  Release — Transcribing, then paste"
echo "  Quit: tray → Quit Scrib   or   pnpm --filter @pyai/desktop quit"
echo "  Accessibility: remove every PyAI Scrib / pyai-desktop, then + add:"
echo "  $STABLE"
open "$STABLE"
open -R "$STABLE"
