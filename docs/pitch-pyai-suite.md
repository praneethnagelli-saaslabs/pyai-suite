# PyAI Suite — Pitch + Demo (all products)

Use this for intros, judging rounds, and live demos. Swap **Team** if needed.

---

## 1. Introduction — Team & Product

| | |
|--|--|
| **Team** | SaaS Labs |
| **Product** | **PyAI Suite** |
| **Apps** | CallIQ · Scrib · Brief · Simulator |

**[SAY]**  
“Hi, we’re **SaaS Labs**. Our product is **PyAI Suite** — four AI apps on one shared voice platform: **CallIQ**, **Scrib**, **Brief**, and **Simulator**.”

---

## 2. Product in one line

**Suite**  
**Four AI products on one voice platform — PyAI first, with clear fallbacks.**

| Product | One-liner |
|---------|-----------|
| **CallIQ** | Listens to a sales call → evidence-backed deal notes |
| **Scrib** | You speak → cleaned text ready to paste |
| **Brief** | Listens to a meeting → notes + searchable memory |
| **Simulator** | Practice / stress-test a live voice agent |

**[SAY]**  
“In one line: four products, one platform. CallIQ for sales calls, Scrib for dictation, Brief for meeting memory, Simulator for agent practice.”

---

## 3. Tech stack

### PyAI products (capabilities)

| Capability | Used by |
|------------|---------|
| **PyAI Hear** (STT / diarize) | CallIQ, Scrib, Brief, Simulator |
| **PyAI Speak** (TTS) | Demos, Simulator agent voice, sample audio |
| **LLM / structured output** | CallIQ Recap, Scrib cleanup, Brief summary + memory Q&A, Simulator scoring |

### LLMs & AI providers

| Provider | Role |
|----------|------|
| **PyAI** | Primary Hear / Speak when configured |
| **OpenAI** | Fallback STT (Whisper / transcribe) + LLM notes / cleanup |
| **Google Gemini** | Optional LLM fallback |
| **Anthropic** | Optional LLM (when keyed) |
| **Mock** | Full demos with no API keys |

Provider order: **PyAI → OpenAI → Gemini → Mock**. The UI shows fallbacks when Hear misses or cools down.

### Third-party APIs & infrastructure

| Service | Role |
|---------|------|
| **Attendee** (meeting bot) | CallIQ Bot joins Google Meet / Zoom |
| **Google Meet** | Live rooms for CallIQ bot + Brief tab capture |
| **MinIO** (S3-compatible) | Recordings storage |
| **Postgres** | Meetings, runs, notes, memory |
| **Redis** | Background jobs |
| **Chrome** (tab audio + extension) | Brief Meet capture; Scrib paste helper |
| **Docker Compose** | Local full stack |

**[SAY — one breath]**  
“Stack: PyAI Hear and Speak first; OpenAI and Gemini as fallbacks; Attendee for the CallIQ bot; Postgres and MinIO for persistence; Docker to run the whole suite.”

---

## 4. Pitch + Demo

### Suite pitch (45 sec)

**[SAY]**  
“Voice apps usually mean four separate integrations. We built **one capability registry** and four products on top.

- **CallIQ** — leave a sales call with CRM-ready notes  
- **Scrib** — speak once, paste clean text anywhere  
- **Brief** — meeting notes and memory **without** a bot in every call  
- **Simulator** — call your agent, score it, ship with confidence  

PyAI is tried first. If it can’t, we fall back and show that in the UI — so demos keep moving.”

---

### Demo order (recommended ~12–15 min)

| # | Product | Time | Safest click |
|---|---------|------|--------------|
| 1 | CallIQ | 4–5 min | **Run product demo** |
| 2 | Scrib | 2 min | **Try demo** |
| 3 | Brief | 2–3 min | **Try sample demo** |
| 4 | Simulator | 2 min | **Start** a short call |
| 5 | Providers | 30 sec | Health + fallback story |

Open: http://localhost:3000

---

### CallIQ — pitch + demo

**Pitch**  
“After a sales call, someone still rewrites the CRM by hand. CallIQ **listens**, **Hear** builds a transcript, **Recap** writes deal notes — summary, risks, next steps — grounded in the call.”

**Demo**

1. Open **CallIQ**  
2. Click **Run product demo**  
3. Point at stages (Hear → Recap); mention fallback banner if it appears  
4. Show transcript + conversation shape  
5. Show deal notes (summary / risk / next steps)  
6. *(Optional)* Paste Meet URL → **Join Meet as bot** → admit **CallIQ Bot** once  

**Close**  
“CallIQ: from call to CRM-ready notes.”

---

### Scrib — pitch + demo

**Pitch**  
“Typing kills flow. Scrib is dictation with cleanup: Speak → Hear → clean text you can paste into email, CRM, or Slack.”

**Demo**

1. Open **Scrib**  
2. Click **Try demo** (guided Speak → Hear → cleanup)  
3. *(Optional)* Hold-to-talk on web, or mention Chrome extension / desktop tray  

**Close**  
“Scrib: speak once, paste clean text.”

---

### Brief — pitch + demo

**Pitch**  
“Not every meeting needs a bot in the room. Brief captures the Meet **tab** (and optionally your mic), writes notes, and keeps **meeting memory** you can search later.”

**Demo**

1. Open **Brief**  
2. Click **Try sample demo** (safest on stage)  
3. Show notes + past meetings list  
4. *(Optional)* Search: “What did we decide about launch?”  
5. *(Optional live)* **Capture Meet audio** → Chrome Tab + tab audio → mic for Me: → **End meeting → notes**  

**Close**  
“Brief: meetings → notes + searchable memory — no bot required.”

---

### Simulator — pitch + demo

**Pitch**  
“Before customers hear your voice agent, you should. Simulator lets you **call the agent**, score the run, and compare versions — same Hear/Speak stack as the rest of the suite.”

**Demo**

1. Open **Simulator**  
2. Start a short live / persona call  
3. Show score or dashboard / compare if available  

**Close**  
“Simulator: practice and score the agent before you ship it.”

---

### Platform beat (30 sec)

Open **Providers**.

**[SAY]**  
“Under the hood: one registry. Healthy means the key works. Fallback banners mean we kept going. That’s how four products stay consistent.”

---

### Full close

**[SAY]**  
“**PyAI Suite** — CallIQ for sales notes, Scrib for dictation, Brief for meeting memory, Simulator for agent practice. One voice platform. PyAI first. Questions?”

---

## Cheat sheets

### Slide bullets

**Intro**  
- Team: SaaS Labs  
- Product: PyAI Suite (CallIQ · Scrib · Brief · Simulator)

**One-liners**  
- CallIQ — sales call → deal notes  
- Scrib — speak → clean text  
- Brief — meeting → notes + memory  
- Simulator — practice / score voice agent  

**Stack**  
- PyAI: Hear, Speak, LLM  
- Fallbacks: OpenAI, Gemini (+ optional Anthropic)  
- 3rd party: Attendee, Google Meet, MinIO, Postgres, Redis, Docker  

**Demo**  
1. CallIQ → Run product demo  
2. Scrib → Try demo  
3. Brief → Sample demo  
4. Simulator → Start call  
5. Providers → health / fallbacks  

### If something fails live

1. Stay on **Mock** / sample demo paths  
2. Open **Providers** — explain healthy vs Hear cooldown  
3. Fallback banner = expected, not broken  
4. Skip live Meet; finish on product demos  

### Timing

| Block | Time |
|-------|------|
| Intro + one-liners + stack | 2 min |
| CallIQ | 4–5 min |
| Scrib | 2 min |
| Brief | 2–3 min |
| Simulator | 2 min |
| Providers + close | 1 min |

### 60-second lightning version

1. Team + suite one-liner  
2. Four product one-liners  
3. “Stack: PyAI Hear/Speak, OpenAI/Gemini fallback, Attendee, Postgres/MinIO”  
4. CallIQ → **Run product demo** → show notes  
5. “Same platform powers Scrib, Brief, Simulator — questions?”
