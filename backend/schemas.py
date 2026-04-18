from datetime import date, datetime
from typing import Optional
from pydantic import BaseModel


class LoginRequest(BaseModel):
    username: str
    password: str


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    role: str
    username: str
    full_name: Optional[str] = None


class UserOut(BaseModel):
    id: str
    username: str
    role: str
    full_name: Optional[str] = None

    class Config:
        from_attributes = True


class UserCreate(BaseModel):
    username: str
    password: str
    role: str = "trainer"
    full_name: Optional[str] = None


class WorkshopCreate(BaseModel):
    title: str
    trainer: str
    conducted_on: date


class WorkshopOut(BaseModel):
    id: str
    title: str
    trainer: str
    conducted_on: date
    created_at: datetime

    class Config:
        from_attributes = True


class SessionCreate(BaseModel):
    workshop_id: str
    batch_name: str


class SessionOut(BaseModel):
    id: str
    workshop_id: str
    batch_name: str
    started_at: datetime
    ended_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class StartOut(BaseModel):
    capture_id: str


class EmotionBreakdown(BaseModel):
    happy:    float = 0.0
    neutral:  float = 0.0
    angry:    float = 0.0
    sad:      float = 0.0
    surprise: float = 0.0
    fear:     float = 0.0
    disgust:  float = 0.0


class CaptureResult(BaseModel):
    capture_id: str
    dominant_emotion: str
    rating_bucket: Optional[str] = None
    emotions: EmotionBreakdown
    face_count: int = 1
    star_rating: Optional[int] = None


class FeedEntry(BaseModel):
    capture_id: str
    session_id: str
    batch_name: str
    workshop_title: str
    started_at: datetime
    captured_at: Optional[datetime] = None
    dominant_emotion: Optional[str] = None
    rating_bucket: Optional[str] = None
    duration_seconds: Optional[float] = None
    face_count: int = 1
    star_rating: Optional[int] = None
    status: str


class SessionAnalytics(BaseModel):
    session_id: str
    batch_name: str
    total: int
    positive: int
    average: int
    negative: int
    emotions: EmotionBreakdown


class WorkshopAnalytics(BaseModel):
    workshop_id: str
    title: str
    total_captures: int
    positive: int
    average: int
    negative: int
    emotions: EmotionBreakdown
    sessions: list[SessionAnalytics]
