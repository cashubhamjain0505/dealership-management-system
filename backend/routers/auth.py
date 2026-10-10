"""Shared staff login: one password protects the app; the session rides an httpOnly cookie."""

import os
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Cookie, Depends, HTTPException, Response
from pydantic import BaseModel

from lib.db import db

router = APIRouter(prefix="/auth", tags=["auth"])

SESSION_COOKIE = "session_token"


class LoginIn(BaseModel):
    password: str
    staff_name: str = "Staff"


class MeOut(BaseModel):
    logged_in: bool
    staff_name: str


async def require_staff(session_token: str | None = Cookie(default=None)) -> dict:
    if not session_token:
        raise HTTPException(status_code=401, detail="Not signed in")
    session = await db.sessions.find_one({"token": session_token})
    if not session:
        raise HTTPException(status_code=401, detail="Session expired — sign in again")
    return session


@router.post("/login", response_model=MeOut)
async def login(body: LoginIn, response: Response) -> MeOut:
    expected = os.environ.get("STAFF_PASSWORD", "suzuki123")
    if body.password != expected:
        raise HTTPException(status_code=401, detail="Incorrect password")
    staff_name = body.staff_name.strip() or "Staff"
    token = uuid.uuid4().hex
    await db.sessions.insert_one({"token": token, "staff_name": staff_name, "created_at": datetime.now(timezone.utc)})
    response.set_cookie(
        SESSION_COOKIE, token, httponly=True, samesite="lax", max_age=60 * 60 * 24 * 30, path="/"
    )
    return MeOut(logged_in=True, staff_name=staff_name)


@router.get("/me", response_model=MeOut)
async def me(session: dict = Depends(require_staff)) -> MeOut:
    return MeOut(logged_in=True, staff_name=session.get("staff_name", "Staff"))


@router.post("/logout")
async def logout(response: Response, session_token: str | None = Cookie(default=None)) -> dict:
    if session_token:
        await db.sessions.delete_one({"token": session_token})
    response.delete_cookie(SESSION_COOKIE, path="/")
    return {"ok": True}
