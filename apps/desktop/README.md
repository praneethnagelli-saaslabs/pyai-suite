# Desktop — macOS menu-bar Scrib

**Hold Control+Shift+1** to talk, **release** to transcribe and paste. A floating bezel above the Dock shows **Listening** (soft waveform) then **Understanding**. Works in TextEdit, VS Code, Slack, Docs in Chrome, terminals.

This is a **tray-only** Tauri 2 app (spec #70). It does not wrap the web UI. Provider keys stay in the API `.env` — this process never stores or logs them.

```
Hold Control+Shift+1  → bezel: Listening
Release               → bezel: Understanding
  → POST http://127.0.0.1:4000/api/scrib/transcribe
  → clipboard + Cmd+V (then restore clipboard)
```

## End-to-end setup

### 1. Once per machine

```bash
# Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source "$HOME/.cargo/env"

# Xcode command-line tools (if missing)
xcode-select --install
```

### 2. Suite API (required for transcribe)

Keys stay in repo-root `.env`. In a separate terminal:

```bash
pnpm --filter @pyai/api dev    # http://127.0.0.1:4000/health
```

Docker is fine too, as long as port **4000** is up.

### 3. Start Scrib

```bash
pnpm --filter @pyai/desktop dev
```

This builds one official **PyAI Scrib.app** and launches it. You should see **one** menu-bar mic (same Lucide Mic2 as the web UI). Hold Control+Shift+1 and the floating bezel appears above the Dock.

There is **no Dock icon**. If you see two icons, run `pnpm --filter @pyai/desktop quit` then start again.

Hot-reload during Rust work (shows as `pyai-desktop` in TCC — skip this for first-time permissions):

```bash
pnpm --filter @pyai/desktop tauri:dev
```

### 4. Grant permissions (first launch)

macOS will not list “Scrib”. Enable **PyAI Scrib** in both places:

1. **System Settings → Privacy & Security → Accessibility**
2. Remove **every** **PyAI Scrib** and **pyai-desktop** row (old debug copies do not count)
3. Click **+** and add **only** this app (Finder highlights it when paste fails):

   ```
   ~/Applications/PyAI Scrib.app
   # Finder → Go → Go to Folder… → ~/Applications
   ```

4. **Microphone** → allow **PyAI Scrib**
5. Quit Scrib and start it again (`pnpm --filter @pyai/desktop quit` then `dev`)

A toggle that is already on is almost always an **old path** (`…/target/debug/macos/…` or a `pyai_desktop-*` hash), not the live app.

If **PyAI Scrib** is not in the list yet:

1. Click **+** (you may need to unlock with the padlock)
2. Press **Cmd+Shift+G** and go to `~/Applications`, then choose **PyAI Scrib.app**
3. Toggle it on
4. Quit the tray (**Quit Scrib**) and run `pnpm --filter @pyai/desktop dev` again

Also allow **PyAI Scrib** if a mic banner appears on first hold of Control+Shift+1.

Without Accessibility: text is copied, the bezel says **Allow Accessibility**, and System Settings opens. Press **Cmd+V** this time; after you toggle **PyAI Scrib** on, the next dictate pastes at the caret.

### 5. Try it

On launch a floating bezel should flash above the Dock. Then:

1. Click the menu-bar mic → **Test bezel** if you want to see it again
2. Click into TextEdit / VS Code / Slack / a Doc
3. **Hold Control+Shift+1** — bezel **Listening** with waveform
4. Speak, **release** — **Understanding**, then paste

Hotkey uses keyboard HID state (not an Accessibility event tap). Accessibility is only required to auto-press Cmd+V.

**Quit** (no Dock icon — use one of these):

```bash
pnpm --filter @pyai/desktop quit
```

or menu-bar icon → **Quit Scrib**. `pnpm --filter @pyai/desktop dev` starts it again; it does not run in the background after quit.

## Insert

Same path Wispr Flow uses when AX insert is unavailable:

1. Save the current clipboard
2. Write the transcript
3. Synthesize **Cmd+V**
4. Restore the previous clipboard

## API

Default base is `http://127.0.0.1:4000` (loopback only). Override with `PYAI_API_BASE` if you must point elsewhere — non-localhost is refused unless that env var is set explicitly.

Each dictate sends the frontmost app name so cleanup can match Slack vs Mail vs VS Code:

```json
{
  "audioBase64": "…",
  "format": "wav",
  "appName": "Slack"
}
```

## IPC (spec #70)

[`src/bridge.ts`](src/bridge.ts) is the TypeScript contract. Rust implements the same command names:

| Command | Role |
|---------|------|
| `start_capture` / `stop_capture` | cpal → 16-bit mono WAV |
| `insert_text` | clipboard + Cmd+V + restore |
| `get_active_app` | `NSWorkspace` frontmost name |
| `has_provider_key` | always `false` — keys live in the API |

## Out of scope (this slice)

Windows / Linux, Brief system-audio capture, embedding `apps/web`, Keychain provider keys.

## Privacy

- Never logs transcripts, audio, or secrets
- Audio stays in memory until the transcribe POST
- No provider keys in this binary
