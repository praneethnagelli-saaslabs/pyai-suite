# PyAI Suite Chrome Extension (Manifest V3)

## CallIQ — bot joins the call with you

1. Load unpacked from `apps/extension` (`chrome://extensions` → Developer mode)
2. In CallIQ click **Start call with CallIQ Bot** (or the same button in the extension popup)
3. Google Meet opens — join the room
4. When Meet gets a real room code, the extension sends CallIQ Bot into **that same meeting**
5. Admit **CallIQ Bot** in the waiting room

**I’m already in Meet — bring bot** finds your open Meet tab and sends the bot there.

## Brief — capture Meet (no bot)

1. Load unpacked from `apps/extension` (same as above)
2. Popup → **Open Meet + Brief** (opens Meet + Brief) or join Meet first → **Capture this Meet in Brief**
3. In Brief, click **Capture Meet audio** and share the **Meet Chrome tab** with **Also share tab audio** on
4. **End meeting → notes** when you’re done

The extension only hands Brief the Meet URL. Capture stays in the app (tab audio picker). No bot joins.

## Scrib dictation

Hold-to-record in the popup, or `Cmd/Ctrl+Shift+Space` for a demo insert into the focused field.

## Security

- Content script: DOM insert + page bridge only
- Background talks to `localhost:4000` / opens `localhost:3000`
- Provider keys stay in API `.env`

Reload the extension after every update.
