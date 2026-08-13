# Design System

One shared design system for all four products. Goal feel:
**developer tool + premium AI product + open-source credibility.**

## Principles (spec #73)
- Excellent typography; dense but readable data.
- Strong, opinionated empty states.
- Command palette (Cmd/Ctrl+K) for everything.
- Keyboard-first UX.
- Subtle motion only; beautiful timelines; high-quality diff views.
- Avoid: generic dashboard templates, excessive gradients, gratuitous cards,
  noisy animations, "AI" gimmicks.

## Tokens (light + dark)
- Type: a clean grotesk for UI, a mono for JSON/traces/timings.
- Spacing scale, radius scale, 1px hairline borders over shadows.
- Accent: a single restrained brand color; status colors for PASS/WARN/BLOCK,
  provider health, run status.

## Shared components
- `Timeline` — trace explorer (per-run provider calls, TTFB, latency).
- `DiffView` — Run A vs Run B / provider A vs provider B, aligned by segment.
- `GateBadge` — PASS / WARN / BLOCK with hover reason + evidence.
- `ProviderDot` — health + latency.
- `EmptyState` — action-oriented (no data → "Upload a call", "Connect PyAI").
- `CommandPalette` — searchable command list (see below).
- `Stat` — latency P50/P90/P95/P99.
- `Kbd` — keyboard hint chips.

## Command palette (spec #74)
Cmd/Ctrl+K opens a single palette used across products. Commands:
```
Start recording        Stop recording
Open playground        Change provider
Run benchmark           Search meetings
Search calls           Open last run
Toggle privacy mode    Open settings
```
Implemented once, shared by web + desktop; extension mirrors the relevant
subset via the local-app bridge.

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
