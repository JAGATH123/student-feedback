import uuid
from datetime import datetime, date
from sqlalchemy import Column, String, Float, Integer, Date, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from database import Base


def _uuid():
    return str(uuid.uuid4())


class User(Base):
    __tablename__ = "users"

    id         = Column(String, primary_key=True, default=_uuid)
    username   = Column(String, unique=True, nullable=False)
    password_hash = Column(String, nullable=False)
    role       = Column(String, nullable=False, default="trainer")  # "admin" | "trainer"
    full_name  = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    workshops  = relationship("Workshop", back_populates="creator")


class Workshop(Base):
    __tablename__ = "workshops"

    id = Column(String, primary_key=True, default=_uuid)
    title = Column(String, nullable=False)
    trainer = Column(String, nullable=False)
    conducted_on = Column(Date, nullable=False, default=date.today)
    created_at = Column(DateTime, default=datetime.utcnow)
    created_by = Column(String, ForeignKey("users.id"), nullable=True)

    creator   = relationship("User", back_populates="workshops")
    sessions  = relationship("Session", back_populates="workshop", cascade="all, delete")
    captures  = relationship("Capture", back_populates="workshop", cascade="all, delete")


class Session(Base):
    __tablename__ = "sessions"

    id = Column(String, primary_key=True, default=_uuid)
    workshop_id = Column(String, ForeignKey("workshops.id"), nullable=False)
    batch_name  = Column(String, nullable=False)
    started_at  = Column(DateTime, default=datetime.utcnow)
    ended_at    = Column(DateTime, nullable=True)

    workshop = relationship("Workshop", back_populates="sessions")
    captures = relationship("Capture", back_populates="session", cascade="all, delete")


class Capture(Base):
    __tablename__ = "captures"

    id          = Column(String, primary_key=True, default=_uuid)
    workshop_id = Column(String, ForeignKey("workshops.id"), nullable=False)
    session_id  = Column(String, ForeignKey("sessions.id"),  nullable=False)

    started_at  = Column(DateTime, default=datetime.utcnow, nullable=False)

    dominant_emotion = Column(String,  nullable=True)
    rating_bucket    = Column(String,  nullable=True)
    face_confidence  = Column(Float,   nullable=True)
    captured_at      = Column(DateTime, nullable=True)

    face_count     = Column(Integer, nullable=True, default=1)
    happy_score    = Column(Float, nullable=True)
    neutral_score  = Column(Float, nullable=True)
    angry_score    = Column(Float, nullable=True)
    sad_score      = Column(Float, nullable=True)
    surprise_score = Column(Float, nullable=True)
    fear_score     = Column(Float, nullable=True)
    disgust_score  = Column(Float, nullable=True)

    workshop = relationship("Workshop", back_populates="captures")
    session  = relationship("Session",  back_populates="captures")
