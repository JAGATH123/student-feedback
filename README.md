# Emotion Feedback Kiosk

Student-facing webcam kiosk that detects facial expressions after workshops and stores anonymous emotion data for trainer review.

## Stack

| Layer | Tech |
|-------|------|
| Frontend | Next.js 14 + TypeScript + Tailwind |
| Design | LOF design system — Orbitron / Rajdhani / Fira Code |
| Backend | FastAPI (Python 3.10) |
| Emotion AI | DeepFace (7-emotion classification) |
| Database | PostgreSQL 16 |
| Charts | Recharts |
| Deploy | Docker Compose + Cloudflare Tunnel |

## Quick Start

```bash
# 1. Clone / enter project
cd STUDENT_FEEDBACK

# 2. Copy env
cp .env.example .env

# 3. Build and start
docker compose up --build

# 4. Open admin at http://localhost:3000/admin
# 5. Create a workshop → generate a session URL → open on kiosk device
```

> First backend startup downloads DeepFace model weights (~100 MB, cached in image layer).

## URLs

| URL | Purpose |
|-----|---------|
| `http://localhost:3000/admin` | Trainer / admin dashboard |
| `http://localhost:3000/kiosk/<session-id>` | Student kiosk (generated per batch) |
| `http://localhost:8000/docs` | FastAPI Swagger UI |

## Kiosk Flow

1. **Welcome** — tap to begin  
2. **Consent** — camera disclosure, skip option  
3. **Countdown** — 3-second timer with live webcam preview  
4. **Analyze** — DeepFace classifies emotion (<1 sec)  
5. **Result** — emotion + POSITIVE / NEUTRAL / NEGATIVE badge  
6. **Auto-reset** — returns to welcome after 7 seconds  

## Privacy

- Images are **never stored** — deleted immediately after DeepFace processes them  
- Only the emotion label + 7 confidence scores saved  
- No names, no faces, no cross-session tracking  
- Compliant with DPDP Act (India)

## Cloudflare Tunnel (public URL)

```bash
# Install cloudflared on the VM, then:
cloudflared tunnel --url http://localhost:3000
# → gives you a public HTTPS URL, no firewall changes needed
```

## Development (without Docker)

```bash
# Backend
cd backend
pip install -r requirements.txt
uvicorn main:app --reload

# Frontend (separate terminal)
cd frontend
npm install
npm run dev
```
