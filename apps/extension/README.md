# PyAI Suite Chrome Extension (Manifest V3)

## CallIQ — bot joins the call with you

1. Load unpacked from `apps/extension` (`chrome://extensions` → Developer mode). **Reload the extension after every pull.**
2. If you are **already in Meet**, click **Bring bot into this Meet** (or Start call — it now uses the open Meet tab).
3. If you are not in Meet, **Start call with CallIQ Bot** opens a new room, then sends the bot when the code appears.
4. Stay in Meet. The transcript opens in the **CallIQ side panel** (not a new tab every time). Admit **one** CallIQ Bot.

**I’m already in Meet — bring bot** finds your open Meet tab and sends the bot there.

## Brief — capture Meet (no bot)

1. Load unpacked from `apps/extension` (same as above)
2. Popup → **Open Meet + Brief** (opens Meet + Brief) or join Meet first → **Capture this Meet in Brief**
3. In Brief, click **Capture Meet audio** and share the **Meet Chrome tab** with **Also share tab audio** on
4. **End meeting → notes** when you’re done

The extension only hands Brief the Meet URL. Capture stays in the app (tab audio picker). No bot joins.

## Scrib dictation

Popup → **Record dictation** opens a small window (the popup cannot keep Chrome’s mic prompt open). Allow the microphone for PyAI Suite if asked. `Cmd/Ctrl+Shift+Space` still inserts a demo line into the focused field.

## Security

- Content script: DOM insert + page bridge only
- Background talks to `localhost:4000` / opens `localhost:3000`
- Provider keys stay in API `.env`

Reload the extension after every update.
