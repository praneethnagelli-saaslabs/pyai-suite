# Meeting bots (CallIQ)

| Mode | Provider |
|----|---|
| **Primary** | Attendee (always started with `docker compose up`) |
| **Demo fallback** | Simulated bot for product demo only (not for real Join) |

Attendee **joins an existing** Meet/Zoom URL. It does not create Google Meet meetings.

**One bot, one transcript:** admit a single CallIQ Bot. Only the browser that sent it receives captions. A second Send Bot is rejected (no extra guest, no shared transcript).

## Setup

See **[attendee-selfhost.md](./attendee-selfhost.md)**.

```bash
docker compose up --build -d
# Attendee is healthy first; suite API loads ATTENDEE_API_KEY from the bootstrap volume
```

Default in Compose: `ATTENDEE_BASE_URL=http://attendee-app:8000`

## API

- `GET /api/calliq/bot/providers`
- `POST /api/calliq/bot/join`
- `GET /api/calliq/bot/:id`
