import os
import tempfile
from datetime import datetime

from fastapi import FastAPI, UploadFile, Form, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from sqlalchemy.orm import Session as DBSession

from database import engine, get_db, Base
import models
import schemas
import fer_model
import auth as _auth

Base.metadata.create_all(bind=engine)

app = FastAPI(title="Emotion Feedback Kiosk API")


@app.on_event("startup")
async def _warmup():
    _migrate_db()
    fer_model.load_model()
    _seed_users()


def _migrate_db():
    """Add new columns to existing tables without dropping data."""
    migrations = [
        "ALTER TABLE captures ADD COLUMN face_count INTEGER DEFAULT 1",
        "ALTER TABLE captures ADD COLUMN star_rating INTEGER",
    ]
    with engine.connect() as conn:
        for sql in migrations:
            try:
                conn.execute(text(sql))
                conn.commit()
            except Exception:
                pass  # column already exists


def _seed_users():
    """Seed default users only if the table is completely empty.
    Override passwords via ADMIN_PASSWORD / TRAINER_PASSWORD env vars."""
    from database import SessionLocal
    admin_pw   = os.getenv("ADMIN_PASSWORD",   "admin123")
    trainer_pw = os.getenv("TRAINER_PASSWORD", "trainer123")
    db = SessionLocal()
    try:
        if not db.query(models.User).first():
            db.add(models.User(username="admin",   password_hash=_auth.hash_password(admin_pw),   role="admin",   full_name="Administrator"))
            db.add(models.User(username="trainer1", password_hash=_auth.hash_password(trainer_pw), role="trainer", full_name="Trainer One"))
            db.commit()
    finally:
        db.close()

_CORS_ORIGINS = [o.strip() for o in os.getenv("CORS_ORIGINS", "*").split(",")]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_CORS_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)


def emotion_to_rating(dominant: str, scores: dict | None = None) -> str:
    """
    Workshop rating — aggressively biased toward POSITIVE.

    Flow (scores are raw 0–100, dominant already has 6.5× happy boost applied):
      1. Happy / surprise dominant              → POSITIVE  (always)
      2. Neutral dominant                       → POSITIVE  (attentive = satisfied, always)
      3. Fear / disgust dominant                → AVERAGE   (confused, not unhappy)
      4. Sad / angry dominant, combined < 85 %  → AVERAGE   (passing expression, not genuine)
      5. Sad / angry dominant AND combined ≥ 85% → NEGATIVE (very rare — genuinely upset)

    Expected distribution in a workshop: ~96 % POSITIVE · ~3 % AVERAGE · ~1 % NEGATIVE
    """
    if dominant in ("happy", "surprise"):
        return "POSITIVE"

    # Neutral = student is present and paying attention → always positive in workshop context
    if dominant == "neutral":
        return "POSITIVE"

    # Fear / disgust = confused, not unhappy → AVERAGE
    if dominant in ("fear", "disgust"):
        return "AVERAGE"

    # Sad / angry — only NEGATIVE if the combined negative signal is overwhelming
    if scores and dominant in ("sad", "angry"):
        combined_negative = (scores.get("sad",     0) +
                             scores.get("angry",   0) +
                             scores.get("disgust", 0))
        if combined_negative >= 85:
            return "NEGATIVE"

    return "AVERAGE"

_EB_KEYS = {"happy", "neutral", "angry", "sad", "surprise", "fear", "disgust"}


def _count_buckets(captures: list[models.Capture]):
    pos = avg = neg = 0
    for c in [x for x in captures if x.rating_bucket]:
        if c.rating_bucket == "POSITIVE":   pos += 1
        elif c.rating_bucket == "AVERAGE":  avg += 1
        else:                               neg += 1
    return pos, avg, neg


def _emotion_avg(captures: list[models.Capture]) -> schemas.EmotionBreakdown:
    completed = [c for c in captures if c.dominant_emotion]
    n = len(completed) or 1
    keys = ("happy", "neutral", "angry", "sad", "surprise", "fear", "disgust")
    totals = {k: sum(getattr(c, f"{k}_score") or 0.0 for c in completed) for k in keys}
    return schemas.EmotionBreakdown(**{k: round(totals[k] / n, 2) for k in keys})


# ── Auth ───────────────────────────────────────────────────────────────────────

@app.post("/auth/login", response_model=schemas.TokenOut)
def login(body: schemas.LoginRequest, db: DBSession = Depends(get_db)):
    user = db.query(models.User).filter(models.User.username == body.username).first()
    if not user or not _auth.verify_password(body.password, user.password_hash):
        raise HTTPException(401, "Invalid username or password")
    return schemas.TokenOut(
        access_token=_auth.create_token(user.id, user.role),
        role=user.role,
        username=user.username,
        full_name=user.full_name,
    )


@app.get("/auth/me", response_model=schemas.UserOut)
def me(user: models.User = Depends(_auth.get_current_user)):
    return user


@app.post("/auth/users", response_model=schemas.UserOut)
def create_user(body: schemas.UserCreate, _: models.User = Depends(_auth.require_admin), db: DBSession = Depends(get_db)):
    if db.query(models.User).filter(models.User.username == body.username).first():
        raise HTTPException(400, "Username already exists")
    u = models.User(username=body.username, password_hash=_auth.hash_password(body.password), role=body.role, full_name=body.full_name)
    db.add(u); db.commit(); db.refresh(u)
    return u


@app.get("/auth/users", response_model=list[schemas.UserOut])
def list_users(_: models.User = Depends(_auth.require_admin), db: DBSession = Depends(get_db)):
    return db.query(models.User).all()


@app.delete("/auth/users/{user_id}", status_code=204)
def delete_user(user_id: str, current: models.User = Depends(_auth.require_admin), db: DBSession = Depends(get_db)):
    if user_id == current.id:
        raise HTTPException(400, "Cannot delete yourself")
    u = db.query(models.User).filter(models.User.id == user_id).first()
    if not u:
        raise HTTPException(404, "User not found")
    db.delete(u); db.commit()


# ── Workshops ──────────────────────────────────────────────────────────────────

@app.post("/workshops", response_model=schemas.WorkshopOut)
def create_workshop(body: schemas.WorkshopCreate, user: models.User = Depends(_auth.get_current_user), db: DBSession = Depends(get_db)):
    if user.role != "trainer":
        raise HTTPException(403, "Only trainers can create workshops")
    w = models.Workshop(**body.model_dump(), created_by=user.id)
    db.add(w); db.commit(); db.refresh(w)
    return w


@app.get("/workshops", response_model=list[schemas.WorkshopOut])
def list_workshops(user: models.User = Depends(_auth.get_current_user), db: DBSession = Depends(get_db)):
    q = db.query(models.Workshop).order_by(models.Workshop.created_at.desc())
    if user.role == "trainer":
        q = q.filter(models.Workshop.created_by == user.id)
    return q.all()


@app.delete("/workshops/{workshop_id}", status_code=204)
def delete_workshop(workshop_id: str, _: models.User = Depends(_auth.require_admin), db: DBSession = Depends(get_db)):
    w = db.query(models.Workshop).filter(models.Workshop.id == workshop_id).first()
    if not w:
        raise HTTPException(404, "Workshop not found")
    db.delete(w); db.commit()


@app.get("/workshops/{workshop_id}", response_model=schemas.WorkshopOut)
def get_workshop(workshop_id: str, _: models.User = Depends(_auth.get_current_user), db: DBSession = Depends(get_db)):
    w = db.query(models.Workshop).filter(models.Workshop.id == workshop_id).first()
    if not w:
        raise HTTPException(404, "Workshop not found")
    return w


# ── Sessions ───────────────────────────────────────────────────────────────────

@app.post("/sessions", response_model=schemas.SessionOut)
def create_session(body: schemas.SessionCreate, _: models.User = Depends(_auth.get_current_user), db: DBSession = Depends(get_db)):
    w = db.query(models.Workshop).filter(models.Workshop.id == body.workshop_id).first()
    if not w:
        raise HTTPException(404, "Workshop not found")
    s = models.Session(**body.model_dump())
    db.add(s); db.commit(); db.refresh(s)
    return s


@app.get("/workshops/{workshop_id}/sessions", response_model=list[schemas.SessionOut])
def list_sessions(workshop_id: str, _: models.User = Depends(_auth.get_current_user), db: DBSession = Depends(get_db)):
    return (
        db.query(models.Session)
        .filter(models.Session.workshop_id == workshop_id)
        .order_by(models.Session.started_at.desc())
        .all()
    )


@app.get("/sessions/{session_id}", response_model=schemas.SessionOut)
def get_session(session_id: str, _: models.User = Depends(_auth.get_current_user), db: DBSession = Depends(get_db)):
    s = db.query(models.Session).filter(models.Session.id == session_id).first()
    if not s:
        raise HTTPException(404, "Session not found")
    return s


@app.delete("/sessions/{session_id}", status_code=204)
def delete_session(session_id: str, _: models.User = Depends(_auth.require_admin), db: DBSession = Depends(get_db)):
    s = db.query(models.Session).filter(models.Session.id == session_id).first()
    if not s:
        raise HTTPException(404, "Session not found")
    db.delete(s); db.commit()


@app.patch("/sessions/{session_id}/end", response_model=schemas.SessionOut)
def end_session(session_id: str, db: DBSession = Depends(get_db)):
    s = db.query(models.Session).filter(models.Session.id == session_id).first()
    if not s:
        raise HTTPException(404, "Session not found")
    s.ended_at = datetime.utcnow()
    db.commit(); db.refresh(s)
    return s


# ── Student starts the flow ────────────────────────────────────────────────────

@app.post("/api/start", response_model=schemas.StartOut)
def start_capture(session_id: str = Form(...), db: DBSession = Depends(get_db)):
    """Called when student taps 'Tap to Begin' — creates a pending row visible to admin immediately."""
    session = db.query(models.Session).filter(models.Session.id == session_id).first()
    if not session:
        raise HTTPException(404, "Session not found")
    capture = models.Capture(
        workshop_id=session.workshop_id,
        session_id=session_id,
        started_at=datetime.utcnow(),
    )
    db.add(capture); db.commit(); db.refresh(capture)
    return schemas.StartOut(capture_id=capture.id)


# ── Gesture / finger-count rating ─────────────────────────────────────────────

@app.post("/api/gesture_rate", response_model=schemas.CaptureResult)
def gesture_rate(
    capture_id: str = Form(...),
    star_count: int = Form(...),
    db: DBSession = Depends(get_db),
):
    """
    Record a finger-gesture star rating (1–5) for a pending capture row.
    Called after /api/start creates the row; no image is required.

    star_count mapping:
      5 or 4  → POSITIVE
      3       → AVERAGE
      1 or 2  → NEGATIVE
    """
    row = db.query(models.Capture).filter(models.Capture.id == capture_id).first()
    if not row:
        raise HTTPException(404, "Capture record not found")

    stars  = max(1, min(5, star_count))
    bucket = "POSITIVE" if stars >= 4 else ("AVERAGE" if stars == 3 else "NEGATIVE")

    row.star_rating      = stars
    row.rating_bucket    = bucket
    row.dominant_emotion = "gesture_rating"
    row.captured_at      = datetime.utcnow()
    db.commit()

    return schemas.CaptureResult(
        capture_id=capture_id,
        dominant_emotion="gesture_rating",
        rating_bucket=bucket,
        emotions=schemas.EmotionBreakdown(),
        face_count=0,
        star_rating=stars,
    )


# ── Live demo (no session / no DB write) ──────────────────────────────────────

@app.post("/api/demo", response_model=schemas.CaptureResult)
async def demo_emotion(image: UploadFile):
    """Live demo endpoint — runs emotion model, returns result, nothing stored."""
    suffix = os.path.splitext(image.filename or ".jpg")[1] or ".jpg"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(await image.read())
        tmp_path = tmp.name

    try:
        result     = fer_model.predict_emotion(tmp_path)
        dominant   = result["dominant_emotion"]
        confidence = result["face_confidence"]
        emotions_f = result["emotions"]
    except Exception as exc:
        raise HTTPException(422, f"Emotion analysis failed: {exc}")
    finally:
        os.remove(tmp_path)

    if dominant is None:
        return schemas.CaptureResult(
            capture_id="demo",
            dominant_emotion="face_not_detected",
            rating_bucket=None,
            emotions=schemas.EmotionBreakdown(),
        )

    return schemas.CaptureResult(
        capture_id="demo",
        dominant_emotion=dominant,
        rating_bucket=emotion_to_rating(dominant, emotions_f),
        emotions=schemas.EmotionBreakdown(**{k: emotions_f.get(k, 0.0) for k in _EB_KEYS}),
    )


# ── Image capture + FER model ──────────────────────────────────────────────────

@app.post("/api/capture", response_model=schemas.CaptureResult)
async def capture(
    image: UploadFile,
    capture_id: str = Form(...),
    db: DBSession = Depends(get_db),
):
    """Receives webcam snapshot, runs fer.h5 model, updates the pending row. Image deleted immediately."""
    row = db.query(models.Capture).filter(models.Capture.id == capture_id).first()
    if not row:
        raise HTTPException(404, "Capture record not found")

    suffix = os.path.splitext(image.filename or ".jpg")[1] or ".jpg"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(await image.read())
        tmp_path = tmp.name

    try:
        result      = fer_model.predict_emotion(tmp_path)
        dominant    = result["dominant_emotion"]
        confidence  = result["face_confidence"]
        emotions_f  = result["emotions"]
        face_count  = result.get("face_count", 1)
    except Exception as exc:
        raise HTTPException(422, f"Emotion analysis failed: {exc}")
    finally:
        os.remove(tmp_path)

    if dominant is None:
        row.dominant_emotion = "face_not_detected"
        row.rating_bucket    = None
        row.face_confidence  = 0.0
        row.face_count       = 0
        row.captured_at      = datetime.utcnow()
        db.commit()
        return schemas.CaptureResult(
            capture_id=capture_id,
            dominant_emotion="face_not_detected",
            rating_bucket=None,
            emotions=schemas.EmotionBreakdown(),
            face_count=0,
        )

    rating = emotion_to_rating(dominant, emotions_f)

    row.dominant_emotion = dominant
    row.rating_bucket    = rating
    row.face_confidence  = confidence
    row.face_count       = face_count
    row.captured_at      = datetime.utcnow()
    row.happy_score      = emotions_f.get("happy",    0.0)
    row.neutral_score    = emotions_f.get("neutral",  0.0)
    row.angry_score      = emotions_f.get("angry",    0.0)
    row.sad_score        = emotions_f.get("sad",      0.0)
    row.surprise_score   = emotions_f.get("surprise", 0.0)
    row.fear_score       = emotions_f.get("fear",     0.0)
    row.disgust_score    = emotions_f.get("disgust",  0.0)
    db.commit()

    return schemas.CaptureResult(
        capture_id=capture_id,
        dominant_emotion=dominant,
        rating_bucket=rating,
        emotions=schemas.EmotionBreakdown(**{k: emotions_f.get(k, 0.0) for k in _EB_KEYS}),
        face_count=face_count,
    )


# ── Live activity feed ─────────────────────────────────────────────────────────

def _build_feed(captures, db) -> list[schemas.FeedEntry]:
    entries = []
    for c in captures:
        session  = db.query(models.Session).filter(models.Session.id == c.session_id).first()
        workshop = db.query(models.Workshop).filter(models.Workshop.id == c.workshop_id).first()
        duration = None
        if c.captured_at and c.started_at:
            duration = round((c.captured_at - c.started_at).total_seconds(), 1)
        entries.append(schemas.FeedEntry(
            capture_id=c.id,
            session_id=c.session_id,
            batch_name=session.batch_name   if session  else "—",
            workshop_title=workshop.title   if workshop else "—",
            started_at=c.started_at,
            captured_at=c.captured_at,
            dominant_emotion=c.dominant_emotion,
            rating_bucket=c.rating_bucket,
            duration_seconds=duration,
            face_count=c.face_count or 1,
            star_rating=c.star_rating,
            status="COMPLETE" if c.dominant_emotion else "IN_PROGRESS",
        ))
    return entries


@app.get("/sessions/{session_id}/feed", response_model=list[schemas.FeedEntry])
def session_feed(session_id: str, limit: int = 200, db: DBSession = Depends(get_db)):
    captures = (
        db.query(models.Capture)
        .filter(models.Capture.session_id == session_id)
        .order_by(models.Capture.started_at.desc())
        .limit(limit).all()
    )
    return _build_feed(captures, db)


@app.get("/workshops/{workshop_id}/feed", response_model=list[schemas.FeedEntry])
def workshop_feed(workshop_id: str, limit: int = 50, db: DBSession = Depends(get_db)):
    captures = (
        db.query(models.Capture)
        .filter(models.Capture.workshop_id == workshop_id)
        .order_by(models.Capture.started_at.desc())
        .limit(limit).all()
    )
    return _build_feed(captures, db)


@app.get("/feed/recent", response_model=list[schemas.FeedEntry])
def global_feed(limit: int = 100, db: DBSession = Depends(get_db)):
    captures = (
        db.query(models.Capture)
        .order_by(models.Capture.started_at.desc())
        .limit(limit).all()
    )
    return _build_feed(captures, db)


# ── Analytics ──────────────────────────────────────────────────────────────────

@app.get("/workshops/{workshop_id}/analytics", response_model=schemas.WorkshopAnalytics)
def workshop_analytics(workshop_id: str, db: DBSession = Depends(get_db)):
    w = db.query(models.Workshop).filter(models.Workshop.id == workshop_id).first()
    if not w:
        raise HTTPException(404, "Workshop not found")

    all_captures = db.query(models.Capture).filter(models.Capture.workshop_id == workshop_id).all()
    completed    = [c for c in all_captures if c.rating_bucket]
    pos, avg, neg = _count_buckets(completed)

    sessions = db.query(models.Session).filter(models.Session.workshop_id == workshop_id).all()
    session_stats = []
    for s in sessions:
        sc = [c for c in completed if c.session_id == s.id]
        sp, sa, sn = _count_buckets(sc)
        session_stats.append(schemas.SessionAnalytics(
            session_id=s.id,
            batch_name=s.batch_name,
            total=len(sc),
            positive=sp, average=sa, negative=sn,
            emotions=_emotion_avg(sc),
        ))

    return schemas.WorkshopAnalytics(
        workshop_id=workshop_id,
        title=w.title,
        total_captures=len(completed),
        positive=pos, average=avg, negative=neg,
        emotions=_emotion_avg(completed),
        sessions=session_stats,
    )


@app.get("/health")
def health():
    return {"status": "ok"}
