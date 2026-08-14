# Desktop — macOS menu-bar Scrib

A small **menu-bar** app (no Dock icon). Hold a hotkey, speak, release — cleaned text pastes where your cursor is. The floating bezel appears at the **top**, just below the menu bar.

```
Hold Control+Shift+1  → Listening
Release               → Understanding → paste
Hold again soon       → say “shorter” / “as an email” → rewrite
```

Works in TextEdit, VS Code, Slack, Docs in Chrome, terminals, etc.

Provider keys stay in the suite API `.env`. This app never stores or logs them.

---

## What you need

| Need | Why |
|------|-----|
| **macOS** | This app is Mac-only |
| **Rust** | Builds the tray app |
| **Xcode Command Line Tools** | Compiles native code |
| **Suite API on port 4000** | Does the Hear + cleanup |

You do **not** need the web UI (`:3000`) for Scrib tray — only the API.

---

## Setup (do once, then daily use)

### 1. Install build tools (once per Mac)

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source "$HOME/.cargo/env"
xcode-select --install   # if macOS says tools are missing
```

### 2. Start the suite API (required)

From the **repo root** — pick one:

**Docker (same as main README):**

```bash
pnpm docker:sync
# API must be up: http://127.0.0.1:4000/health
```

**Or local API only:**

```bash
pnpm --filter @pyai/api dev
```

Keys (optional for Mock; needed for real Hear):

- Put `PYAI_API_KEY` / `OPENAI_API_KEY` in the **repo root** `.env`
- Restart API after changing keys

### 3. Start Scrib tray

```bash
pnpm --filter @pyai/desktop dev
```

You should see **one** mic icon in the menu bar.

| Command | What it does |
|---------|----------------|
| `pnpm --filter @pyai/desktop dev` | Build + launch **PyAI Scrib** (normal use) |
| `pnpm --filter @pyai/desktop quit` | Quit the tray app |
| `pnpm --filter @pyai/desktop tauri:dev` | Hot-reload for Rust work (skip for first permissions) |

If you see **two** icons: quit, then start again.

### 4. Grant macOS permissions (first launch)

macOS will **not** show a product named just “Scrib”. Look for **PyAI Scrib**.

1. **System Settings → Privacy & Security → Accessibility**
2. Remove old **PyAI Scrib** / **pyai-desktop** rows (stale paths break paste)
3. Click **+** and add:

   ```
   ~/Applications/PyAI Scrib.app
   ```

   Finder → **Go → Go to Folder…** → paste that path

4. **Microphone** → allow **PyAI Scrib**
5. Quit Scrib, start again:

   ```bash
   pnpm --filter @pyai/desktop quit
   pnpm --filter @pyai/desktop dev
   ```

If paste fails but copy works: Accessibility is still pointing at an old app path. Remove all Scrib rows and add `~/Applications/PyAI Scrib.app` again.

Without Accessibility, the bezel says **Allow Accessibility** and text is only on the clipboard — press **Cmd+V** once.

### 5. Try it

1. Click into TextEdit (or Slack, VS Code, …)
2. **Hold Control+Shift+1** → speak
3. **Release** → text pastes
4. Hold again within ~60s in the same app → say **“make it shorter”** → it rewrites

Menu-bar mic → **Test bezel** if you want to see the floating UI again.

**Quit:** menu-bar → **Quit Scrib**, or `pnpm --filter @pyai/desktop quit`.

---

## How paste works

Same idea as Wispr Flow when direct insert isn’t available:

1. Save clipboard  
2. Put transcript on clipboard  
3. Fake **Cmd+V**  
4. Restore old clipboard  

Accessibility is only needed for that Cmd+V. The hotkey itself does not need an Accessibility event tap.

---

## API

Default: `http://127.0.0.1:4000` (localhost only).

Override only if you must: `PYAI_API_BASE=…` (non-localhost is refused unless this is set on purpose).

Each dictate sends the frontmost app name (Slack vs Mail vs VS Code). A second hold within 60s can send `lastText` so “make it shorter” becomes a refine, not a new paste.

---

## For developers

TypeScript contract: [`src/bridge.ts`](src/bridge.ts). Rust commands:

| Command | Role |
|---------|------|
| `start_capture` / `stop_capture` | Mic → WAV |
| `insert_text` | Clipboard + Cmd+V |
| `get_active_app` | Frontmost app name |
| `has_provider_key` | Always `false` — keys live in the API |

**Not in this app:** Windows/Linux, Brief tab-audio capture, embedding `apps/web`, storing provider keys.

## Privacy

- Does not log transcripts, audio, or secrets  
- Audio stays in memory until the transcribe request  
- No provider keys in this binary  

Main suite guide: [../../README.md](../../README.md)
