from datetime import datetime, timedelta
from jose import jwt, JWTError
from passlib.context import CryptContext
from fastapi import Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session as DBSession
from database import get_db
import models

SECRET_KEY = "emotion-kiosk-jwt-secret-2026"
ALGORITHM  = "HS256"
TOKEN_TTL_HOURS = 12

pwd_context  = CryptContext(schemes=["bcrypt"], deprecated="auto")
bearer_scheme = HTTPBearer()


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def create_token(user_id: str, role: str) -> str:
    exp = datetime.utcnow() + timedelta(hours=TOKEN_TTL_HOURS)
    return jwt.encode({"sub": user_id, "role": role, "exp": exp}, SECRET_KEY, ALGORITHM)


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    db: DBSession = Depends(get_db),
) -> models.User:
    try:
        payload  = jwt.decode(credentials.credentials, SECRET_KEY, algorithms=[ALGORITHM])
        user_id  = payload.get("sub")
    except JWTError:
        raise HTTPException(401, "Invalid or expired token")
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(401, "User not found")
    return user


def require_admin(user: models.User = Depends(get_current_user)) -> models.User:
    if user.role != "admin":
        raise HTTPException(403, "Admin access required")
    return user
