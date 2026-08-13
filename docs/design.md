# Design System

One shared design system for all four products. Goal feel:
**developer tool + premium AI product + open-source credibility.**

Think Linear × Raycast × Vercel × ChatGPT — not a generic AI landing page.

## Principles (spec #73)
- Excellent typography; dense but readable data.
- Strong, opinionated empty states (what / why / next action).
- Command palette (Cmd/Ctrl+K) for everything.
- Keyboard-first UX (`?` for shortcuts).
- Subtle motion only; `prefers-reduced-motion` respected.
- Dark mode is first-class (layered surfaces, not an invert).
- Avoid: generic dashboard templates, excessive gradients, gratuitous cards,
  noisy animations, "AI" gimmicks, neon glow.

## Tokens (light + dark)

CSS variables in `apps/web/src/index.css`, mapped through Tailwind.

| Token | Role |
|----|---|
| `--canvas` | App background |
| `--surface` / `--elevated` | Cards, panels, overlays |
| `--ink-50` … `--ink-950` | Neutrals (flip in dark) |
| `--accent` | Single restrained teal |
| `--status-*` | pass / warn / block / info |

Type: **IBM Plex Sans** for UI, **IBM Plex Mono** for JSON/traces.

Identity: charcoal surfaces + one teal accent. Dark is the hero. Volt lime was tried and reverted — see `docs/visual-direction.md`.

## Shared components
- `Shell` — collapsible sidebar, product + platform groups, theme toggle.
- `CommandPalette` — searchable command list (`⌘K`).
- `ShortcutsHelp` — `?`
- `EmptyState` — action-oriented (no data → "Upload a call", "Connect PyAI").
- `ErrorBanner` — friendly copy + technical details.
- `DemoStages` — real pipeline state (never fake progress).
- `InsightCard` / `ScoreOverview` — conversation intelligence, not a wall of text.
- `AiWorking` / `RecDot` — AI and recording indicators.
- `MetricCard`, `StatusBadge`, `Toast`, `Skeleton`.

## Command palette (spec #74)
Cmd/Ctrl+K opens a single palette used across products. Commands:
```
Open CallIQ / Scrib / Brief / Simulator
Open playground        Manage providers
Try CallIQ demo        Toggle theme
Open last runs         API health
```

## Shareable outputs (spec #75) — one click
- CallIQ:  deal notes page (summary, objections, evidence cards, follow-up).
- Scrib: before/after typing demo (raw → cleaned) with latency HUD.
- Brief: beautiful meeting summary (decisions, action items, memory).
- Simulator: adversarial callers → benchmark card.
- Simulator: benchmark card (score, failures, worst failure, latency) with a share
  URL. Subtle "Built with PyAI" attribution + project link on shared artifacts.

## Exports (spec #76)
Every artifact exports to Markdown, JSON, CSV (where tabular), and PDF (where
useful). Plus a share link. User data is never locked into the app.
