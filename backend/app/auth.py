import base64
import hashlib
import hmac
import time
from collections import deque
from threading import Lock

from fastapi import Header, HTTPException, status

from app.config import settings

TOKEN_LIFETIME_SECONDS = 365 * 24 * 60 * 60
MAX_FAILED_LOGINS = 10
FAILED_LOGIN_WINDOW_SECONDS = 15 * 60

_failed_logins: deque[float] = deque()
_failed_logins_lock = Lock()


def auth_enabled() -> bool:
    return bool(settings.app_password)


def _signing_key() -> bytes:
    # Derived from the password: changing APP_PASSWORD logs out every device
    return hashlib.sha256(f"ernaehrungstagebuch-token:{settings.app_password}".encode()).digest()


def _sign(payload: str) -> str:
    digest = hmac.new(_signing_key(), payload.encode(), hashlib.sha256).digest()
    return base64.urlsafe_b64encode(digest).decode().rstrip("=")


def create_token(now: float | None = None) -> str:
    expires_at = int((time.time() if now is None else now) + TOKEN_LIFETIME_SECONDS)
    payload = str(expires_at)
    return f"{payload}.{_sign(payload)}"


def is_valid_token(token: str, now: float | None = None) -> bool:
    payload, _, signature = token.partition(".")
    if not payload.isdigit() or not signature:
        return False
    if not hmac.compare_digest(signature, _sign(payload)):
        return False
    return int(payload) > (time.time() if now is None else now)


def _prune_failed_logins(now: float):
    while _failed_logins and _failed_logins[0] < now - FAILED_LOGIN_WINDOW_SECONDS:
        _failed_logins.popleft()


def check_password(password: str) -> bool:
    """Compares in constant time. After too many failures, all logins are blocked for a while
    (behind the reverse proxy every client has the same IP, so the limit is global)."""
    now = time.time()
    with _failed_logins_lock:
        _prune_failed_logins(now)
        if len(_failed_logins) >= MAX_FAILED_LOGINS:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Zu viele Fehlversuche. Bitte in 15 Minuten erneut versuchen.",
            )

    if hmac.compare_digest(password.encode(), settings.app_password.encode()):
        return True

    with _failed_logins_lock:
        _failed_logins.append(now)
    return False


def reset_failed_logins():
    with _failed_logins_lock:
        _failed_logins.clear()


def require_auth(authorization: str | None = Header(default=None)):
    if not auth_enabled():
        return

    scheme, _, token = (authorization or "").partition(" ")
    if scheme.lower() != "bearer" or not is_valid_token(token.strip()):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Anmeldung erforderlich",
            headers={"WWW-Authenticate": "Bearer"},
        )
