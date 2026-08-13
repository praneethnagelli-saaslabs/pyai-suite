# Desktop (Tauri)

Native shell for Scrib + Brief.

```
Tauri (Rust)
  → global hotkeys
  → mic / system audio capture
  → clipboard + text insertion
  → secure credential storage
  → React UI (apps/web)
```

## Status

TypeScript IPC bridge + stub is in `src/`. Full `src-tauri/` Rust project is next — requires the Rust toolchain:

```bash
# https://v2.tauri.app/start/create-project/
cargo install create-tauri-app
```

Privacy: audio stays local until the user selects a remote STT provider.
