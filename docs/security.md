# Security

## Secrets (spec #25, #72)

- **Provider API keys are NEVER present in browser content scripts or the
  extension bundle.** The Chrome MV3 extension ships zero secrets.
- The extension talks ONLY to the **local Scrib app / backend** over a
  native-messaging or localhost bridge. The backend holds the keys.
- Keys live in **secure native storage** (OS keychain via the Tauri Rust layer
  on desktop; backend env/secret store in Docker). They are read at runtime and
  never written to logs, the frontend bundle, or `localStorage`.
- API responses never include raw secrets. The `/api/config` endpoint exposes
  only `{ id, configured }` — never the key value.

## Extension attack surface

- Content script: read focused editable element, send audio chunks / finalized
  text to the local app. No network egress to third parties.
- Background service worker: relay only; no vendor SDKs; no `fetch` to provider
  hosts.
- Permissions kept minimal (activeTab, scripting, storage). No host permissions
  broadened beyond what push-to-talk requires.

## General (spec #25)

- Secrets never logged (API keys, auth headers, raw tokens).
- Rate limiting + request validation on all API routes.
- CORS restricted in production (not `*`).
- Signed upload URLs for object storage; audit log for deletes/exports.
- Per-provider credential isolation; RBAC-ready architecture.
