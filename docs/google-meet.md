# CallIQ + Google Meet (no extension)

Create a Google Meet from CallIQ and send **CallIQ Bot** into the **same** room — no Chrome extension, no paste.

## 1. Google Cloud setup

1. Open [Google Cloud Console](https://console.cloud.google.com/)
2. Create/select a project
3. **APIs & Services → Enable APIs** → enable **Google Calendar API**
4. **Credentials → Create credentials → OAuth client ID**
   - Application type: **Web application**
   - Authorized redirect URIs:
     - `http://localhost:4000/api/google/oauth/callback`
5. Copy Client ID + Client secret into `.env`:

```bash
WEB_ORIGIN=http://localhost:3000
GOOGLE_OAUTH_CLIENT_ID=....apps.googleusercontent.com
GOOGLE_OAUTH_CLIENT_SECRET=....
GOOGLE_OAUTH_REDIRECT_URI=http://localhost:4000/api/google/oauth/callback
```

6. Restart API (`docker compose up -d api` or local `pnpm --filter @pyai/api dev`)

## 2. Use CallIQ

1. Open http://localhost:3000/calliq
2. **Connect Google** (one-time consent for Calendar events)
3. **Start call with CallIQ Bot**
   - CallIQ creates a Meet
   - Opens Meet in a new tab for you
   - Sends CallIQ Bot to that same link
4. Admit **CallIQ Bot** in the waiting room (or turn off waiting room in Meet host controls)

## API

- `GET /api/google/status`
- `GET /api/google/oauth/start` → redirect to Google
- `GET /api/google/oauth/callback`
- `POST /api/google/disconnect`
- `POST /api/calliq/start-call` → `{ meetingUrl, bot }`

Tokens stay on the API (HttpOnly session cookie). Never logged.

## Security notes

- Use empty placeholders in `.env.example` only
- Rotate the client secret if it leaks
- Production: set `WEB_ORIGIN` to your HTTPS app origin and add that redirect URI in Google Cloud
