# Sample recordings

Local audio files for CallIQ / Brief upload demos (no TTS generation required).

| File | Format | ~Length | What it is |
|------|--------|---------|------------|
| [`calliq-sample-sales-call.mp3`](./calliq-sample-sales-call.mp3) | MP3 | ~33s | Short synthetic-style **sales call** for quick CallIQ demos |
| [`mba-ai-inquiry.wav`](./mba-ai-inquiry.wav) | WAV | ~32 min | Prospect interested in **MBA with AI specialization** |
| [`follow-up-rachel.wav`](./follow-up-rachel.wav) | WAV | ~30 min | Advisor **follow-up** outreach after email |
| [`bs-ai-business-inquiry.wav`](./bs-ai-business-inquiry.wav) | WAV | ~19 min | **B.S. in AI for Business** inquiry / application specialist |
| [`mba-ai-reinquiry.wav`](./mba-ai-reinquiry.wav) | WAV | ~21 min | Re-inquiry — preference shift to **MBA AI** vs prior MS AI program |
| [`admission-credit-transfer.wav`](./admission-credit-transfer.wav) | WAV | ~19 min | **Post-acceptance** walkthrough of credit transfer / onboarding |

> The longer `*.wav` files were downloaded as `.mp3` but are RIFF/WAV — stored with the correct extension.

## How to use

1. Open http://localhost:3000 → **CallIQ** or **Brief**
2. Use **Upload** (or drag-and-drop) and pick a file from this folder
3. Wait for Hear + notes

For a one-click in-app sample (synthesized via PyAI/OpenAI TTS when keys are set), use **Use sample recording** on the product page instead.

## Tips

- Prefer `calliq-sample-sales-call.mp3` for live pitches — short and small (~0.5 MB).
- Use any of the longer WAV files for a fuller CallIQ upload demo.
- WAV files are large (~35–60 MB each); cloning the repo will download them.
