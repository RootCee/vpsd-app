from datetime import datetime, timedelta
import os
import random
from typing import Optional

import httpx
from fastapi import FastAPI, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, inspect, or_, text

from db import SessionLocal, engine, Base
from models import (
    Incident,
    HotspotCell,
    Client,
    ContactLog,
    ContactLogShare,
    FieldReport,
    FieldReportShare,
    Group,
    GroupMember,
    User,
)
from auth import hash_password, verify_password, create_access_token, get_current_user

# ArcGIS FeatureServer for SDPD NIBRS (City of San Diego hosted)
_ARCGIS_URL = (
    "https://webmaps.sandiego.gov/arcgis/rest/services"
    "/SDPD/SDPD_NIBRS_Crime_Offenses_Geo/FeatureServer/0/query"
)


app = FastAPI()


def _ensure_incident_columns() -> None:
    inspector = inspect(engine)
    if "incidents" not in inspector.get_table_names():
        return

    existing = {col["name"] for col in inspector.get_columns("incidents")}
    needed = {
        "block_address": "VARCHAR(255)",
        "code_section": "VARCHAR(255)",
        "offense_code": "VARCHAR(64)",
    }
    with engine.begin() as conn:
        for name, column_type in needed.items():
            if name not in existing:
                conn.execute(text(f"ALTER TABLE incidents ADD COLUMN {name} {column_type}"))


def _ensure_contact_log_columns() -> None:
    inspector = inspect(engine)
    if "contact_logs" not in inspector.get_table_names():
        return

    existing = {col["name"] for col in inspector.get_columns("contact_logs")}
    needed = {
        "created_by_user_id": "INTEGER",
    }
    with engine.begin() as conn:
        for name, column_type in needed.items():
            if name not in existing:
                conn.execute(text(f"ALTER TABLE contact_logs ADD COLUMN {name} {column_type}"))


def _ensure_client_columns() -> None:
    inspector = inspect(engine)
    if "clients" not in inspector.get_table_names():
        return

    existing = {col["name"] for col in inspector.get_columns("clients")}
    needed = {
        "created_by_user_id": "INTEGER",
    }
    with engine.begin() as conn:
        for name, column_type in needed.items():
            if name not in existing:
                conn.execute(text(f"ALTER TABLE clients ADD COLUMN {name} {column_type}"))


def _ensure_field_report_columns() -> None:
    inspector = inspect(engine)
    if "field_reports" not in inspector.get_table_names():
        return

    existing = {col["name"] for col in inspector.get_columns("field_reports")}
    needed = {
        "published_to_all": "BOOLEAN DEFAULT 0",
        "published_by_user_id": "INTEGER",
    }
    with engine.begin() as conn:
        for name, column_type in needed.items():
            if name not in existing:
                conn.execute(text(f"ALTER TABLE field_reports ADD COLUMN {name} {column_type}"))


def _ensure_user_columns() -> None:
    inspector = inspect(engine)
    if "users" not in inspector.get_table_names():
        return

    existing = {col["name"] for col in inspector.get_columns("users")}
    needed = {
        "must_reset_password": "BOOLEAN DEFAULT 0",
    }
    with engine.begin() as conn:
        for name, column_type in needed.items():
            if name not in existing:
                conn.execute(text(f"ALTER TABLE users ADD COLUMN {name} {column_type}"))


class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: Optional[str] = None
    email: str
    role: str
    is_active: bool
    created_at: datetime


class CreateUserPayload(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    email: str = Field(min_length=3, max_length=255)
    password: str = Field(min_length=6, max_length=255)
    role: str = Field(default="member")


class CreateUserResponse(BaseModel):
    user: UserResponse


class ResetPasswordPayload(BaseModel):
    email: str = Field(min_length=3, max_length=255)
    new_password: str = Field(min_length=6, max_length=255)


class ResetPasswordResponse(BaseModel):
    success: bool
    message: str


class UsersListResponse(BaseModel):
    users: list[UserResponse]


class ChangePasswordPayload(BaseModel):
    current_password: str = Field(min_length=1, max_length=255)
    new_password: str = Field(min_length=6, max_length=255)


class ShareContactLogPayload(BaseModel):
    user_ids: list[int] = Field(default_factory=list)


class CreateFieldReportPayload(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    message: str = Field(min_length=1, max_length=5000)
    location_text: Optional[str] = Field(default=None, max_length=255)
    severity: Optional[str] = Field(default=None)


class CreateGroupPayload(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    description: Optional[str] = Field(default=None, max_length=2000)


class GroupMembersPayload(BaseModel):
    user_ids: list[int] = Field(default_factory=list)


class ShareFieldReportPayload(BaseModel):
    user_ids: list[int] = Field(default_factory=list)
    group_ids: list[int] = Field(default_factory=list)


def _upsert_bootstrap_user(
    *,
    email_env: str,
    password_env: str,
    name_env: str,
    role: str,
    label: str,
) -> dict[str, object]:
    email = (os.getenv(email_env) or "").strip().lower()
    password = (os.getenv(password_env) or "").strip()
    name = (os.getenv(name_env) or "").strip()

    if not email and not password and not name:
        print(f"[startup] Skipped {label} user sync: {email_env}/{password_env} not set")
        return {"label": label, "synced": False, "reason": "env_not_set"}

    if not email or not password:
        print(f"[startup] Skipped {label} user sync: missing email or password env")
        return {"label": label, "synced": False, "reason": "missing_email_or_password"}

    if "@" not in email:
        print(f"[startup] Skipped {label} user sync: invalid email format")
        return {"label": label, "synced": False, "reason": "invalid_email"}

    db = SessionLocal()
    try:
        user = db.query(User).filter(User.email == email).first()
        created = user is None

        if user is None:
            user = User(
                email=email,
                hashed_password=hash_password(password),
                name=name or None,
                role=role,
                is_active=True,
                must_reset_password=False,
            )
            db.add(user)
        else:
            user.hashed_password = hash_password(password)
            user.role = role
            user.is_active = True
            user.must_reset_password = False
            if name:
                user.name = name

        db.commit()
        print(f"[startup] Synced {label} user: email={email} role={role} created={created}")
        result: dict[str, object] = {
            "label": label,
            "synced": True,
            "created": created,
            "email": email,
            "role": role,
        }
        return result
    except Exception as e:
        db.rollback()
        print(f"[startup] Failed {label} user sync: email={email or '<missing>'} error={e}")
        raise
    finally:
        db.close()


def _sync_bootstrap_users() -> list[dict[str, object]]:
    results = [
        _upsert_bootstrap_user(
            email_env="BOOTSTRAP_ADMIN_EMAIL",
            password_env="BOOTSTRAP_ADMIN_PASSWORD",
            name_env="BOOTSTRAP_ADMIN_NAME",
            role="admin",
            label="admin",
        ),
        _upsert_bootstrap_user(
            email_env="BOOTSTRAP_REVIEW_EMAIL",
            password_env="BOOTSTRAP_REVIEW_PASSWORD",
            name_env="BOOTSTRAP_REVIEW_NAME",
            role="member",
            label="review",
        ),
    ]
    print(f"[startup] Bootstrap user sync complete: {results}")
    return results

# ---------------------------
# STARTUP: CREATE TABLES
# ---------------------------
@app.on_event("startup")
def on_startup():
    # Creates tables automatically on boot (critical for Render)
    Base.metadata.create_all(bind=engine)
    _ensure_incident_columns()
    _ensure_contact_log_columns()
    _ensure_client_columns()
    _ensure_field_report_columns()
    _ensure_user_columns()
    _sync_bootstrap_users()


# ---------------------------
# CORS (ok for demo; tighten later)
# ---------------------------
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------
# ADMIN INIT (manual fallback)
# ---------------------------
@app.post("/admin/init")
def admin_init():
    # Manual “fix it now” endpoint
    Base.metadata.create_all(bind=engine)
    _ensure_incident_columns()
    _ensure_contact_log_columns()
    _ensure_client_columns()
    _ensure_field_report_columns()
    _ensure_user_columns()
    bootstrap = _sync_bootstrap_users()
    return {"status": "initialized", "users": bootstrap}


# ---------------------------
# HEALTH
# ---------------------------
@app.get("/health")
def health():
    return {"status": "ok"}


# ---------------------------
# AUTHENTICATION
# ---------------------------
@app.post("/auth/create-user", response_model=CreateUserResponse)
def create_user(payload: CreateUserPayload, current_user: User = Depends(get_current_user)):
    if current_user.role != "admin":
        raise HTTPException(403, "Admin access required")

    email = payload.email.strip().lower()
    password = payload.password.strip()
    name = payload.name.strip() or None
    role = payload.role.strip().lower()

    if not name:
        raise HTTPException(400, "Name is required.")

    if not email or "@" not in email:
        raise HTTPException(400, "Valid email is required.")

    if not password:
        raise HTTPException(400, "Password is required.")

    if role not in ("admin", "member", "police"):
        raise HTTPException(400, "Role must be 'admin', 'member', or 'police'.")

    db = SessionLocal()
    try:
        existing = db.query(User).filter(User.email == email).first()
        if existing:
            raise HTTPException(400, "That email is already registered.")

        hashed_pwd = hash_password(password)
        user = User(
            email=email,
            hashed_password=hashed_pwd,
            name=name,
            role=role,
            is_active=True,
            must_reset_password=True,
        )
        db.add(user)
        db.commit()
        db.refresh(user)

        return {"user": UserResponse.model_validate(user)}

    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Unable to create user: {e}")
    finally:
        db.close()


@app.post("/auth/reset-password", response_model=ResetPasswordResponse)
def reset_password(payload: ResetPasswordPayload, current_user: User = Depends(get_current_user)):
    if current_user.role != "admin":
        raise HTTPException(403, "Admin access required")

    email = payload.email.strip().lower()
    new_password = payload.new_password.strip()

    if not email or "@" not in email:
        raise HTTPException(400, "Valid email is required.")

    if not new_password:
        raise HTTPException(400, "New password is required.")

    db = SessionLocal()
    try:
        user = db.query(User).filter(User.email == email).first()
        if not user:
            raise HTTPException(404, "User not found.")

        user.hashed_password = hash_password(new_password)
        user.must_reset_password = True
        db.commit()

        return {"success": True, "message": "Password reset successful."}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Unable to reset password: {e}")
    finally:
        db.close()


@app.post("/auth/change-password")
def change_password(payload: ChangePasswordPayload, current_user: User = Depends(get_current_user)):
    current_password = payload.current_password.strip()
    new_password = payload.new_password.strip()

    if not current_password or not new_password:
        raise HTTPException(400, "Current password and new password are required.")

    db = SessionLocal()
    try:
        user = db.query(User).filter(User.id == current_user.id).first()
        if not user:
            raise HTTPException(404, "User not found.")

        if not verify_password(current_password, user.hashed_password):
            raise HTTPException(401, "Current password is incorrect.")

        user.hashed_password = hash_password(new_password)
        user.must_reset_password = False
        db.commit()
        db.refresh(user)

        return {
            "success": True,
            "user": {
                "id": user.id,
                "name": user.name,
                "email": user.email,
                "role": (user.role or "").strip().lower(),
                "is_active": user.is_active,
                "must_reset_password": bool(user.must_reset_password),
            },
        }
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Unable to change password: {e}")
    finally:
        db.close()

@app.get("/auth/users", response_model=UsersListResponse)
def list_users(current_user: User = Depends(get_current_user)):
    db = SessionLocal()
    try:
        users = (
            db.query(User)
            .filter(User.is_active.is_(True))
            .order_by(func.lower(func.coalesce(User.name, User.email)), User.id.asc())
            .all()
        )
        return {"users": [UserResponse.model_validate(user) for user in users]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Unable to load users: {e}")
    finally:
        db.close()


@app.delete("/auth/users/{user_id}")
def delete_user(user_id: int, current_user: User = Depends(get_current_user)):
    if not _is_admin(current_user):
        raise HTTPException(403, "Admin access required")

    if current_user.id == user_id:
        raise HTTPException(400, "You cannot delete your own account.")

    db = SessionLocal()
    try:
        user = db.query(User).filter(User.id == user_id).first()
        if not user:
            raise HTTPException(404, "User not found")

        blockers = []
        if db.query(FieldReport.id).filter(FieldReport.sender_user_id == user_id).first():
            blockers.append("field reports")
        if db.query(Group.id).filter(Group.created_by_user_id == user_id).first():
            blockers.append("groups")

        if blockers:
            joined = " and ".join(blockers)
            raise HTTPException(
                409,
                f"User cannot be deleted because they still own {joined}. Remove or reassign those records first.",
            )

        db.query(GroupMember).filter(GroupMember.user_id == user_id).delete(synchronize_session=False)
        db.query(FieldReportShare).filter(
            or_(
                FieldReportShare.shared_with_user_id == user_id,
                FieldReportShare.created_by_user_id == user_id,
            )
        ).delete(synchronize_session=False)
        db.query(ContactLogShare).filter(
            or_(
                ContactLogShare.shared_with_user_id == user_id,
                ContactLogShare.created_by_user_id == user_id,
            )
        ).delete(synchronize_session=False)
        db.query(Client).filter(Client.created_by_user_id == user_id).update(
            {Client.created_by_user_id: None},
            synchronize_session=False,
        )
        db.query(ContactLog).filter(ContactLog.created_by_user_id == user_id).update(
            {ContactLog.created_by_user_id: None},
            synchronize_session=False,
        )
        db.query(FieldReport).filter(FieldReport.published_by_user_id == user_id).update(
            {FieldReport.published_by_user_id: None},
            synchronize_session=False,
        )

        db.delete(user)
        db.commit()

        return {
            "success": True,
            "deleted_user_id": user_id,
            "message": "User deleted successfully.",
        }
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Unable to delete user: {e}")
    finally:
        db.close()


@app.get("/auth/me")
def auth_me(current_user: User = Depends(get_current_user)):
    return {
        "user": {
            "id": current_user.id,
            "name": current_user.name,
            "email": current_user.email,
            "role": (current_user.role or "").strip().lower(),
            "is_active": current_user.is_active,
            "must_reset_password": bool(current_user.must_reset_password),
        }
    }


@app.post("/auth/login")
def login(payload: dict):
    email = (payload.get("email") or "").strip().lower()
    password = (payload.get("password") or "").strip()

    if not email or not password:
        raise HTTPException(400, "Email and password are required")

    db = SessionLocal()
    try:
        user = db.query(User).filter(User.email == email).first()
        if not user:
            raise HTTPException(401, "Invalid email or password")

        if not verify_password(password, user.hashed_password):
            raise HTTPException(401, "Invalid email or password")

        if not user.is_active:
            raise HTTPException(403, "Account is inactive")

        # Generate access token (sub must be string per JWT spec)
        access_token = create_access_token(data={"sub": str(user.id)})

        return {
            "access_token": access_token,
            "token_type": "bearer",
            "user": {
                "id": user.id,
                "name": user.name,
                "email": user.email,
                "role": (user.role or "").strip().lower(),
                "is_active": user.is_active,
                "must_reset_password": bool(user.must_reset_password),
            }
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"login failed: {e}")
    finally:
        db.close()


# ---------------------------
# GROUPS
# ---------------------------
@app.post("/groups")
def create_group(payload: CreateGroupPayload, current_user: User = Depends(get_current_user)):
    if not _is_admin(current_user):
        raise HTTPException(403, "Admin access required")

    name = payload.name.strip()
    description = payload.description.strip() if payload.description else None
    if not name:
        raise HTTPException(400, "Group name is required.")

    db = SessionLocal()
    try:
        group = Group(
            name=name,
            description=description or None,
            created_by_user_id=current_user.id,
        )
        db.add(group)
        db.commit()
        db.refresh(group)
        return {
            "group": {
                "id": group.id,
                "name": group.name,
                "description": group.description,
                "created_by_user_id": group.created_by_user_id,
                "created_at": group.created_at.isoformat() if group.created_at else None,
                "members": [],
            }
        }
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"create_group failed: {e}")
    finally:
        db.close()


@app.get("/groups")
def list_groups(current_user: User = Depends(get_current_user)):
    if not _is_admin(current_user):
        raise HTTPException(403, "Admin access required")

    db = SessionLocal()
    try:
        groups = db.query(Group).order_by(func.lower(Group.name), Group.id.asc()).all()
        group_ids = [group.id for group in groups]
        members = (
            db.query(GroupMember)
            .filter(GroupMember.group_id.in_(group_ids))
            .order_by(GroupMember.group_id.asc(), GroupMember.id.asc())
            .all()
            if group_ids
            else []
        )
        members_by_group: dict[int, list[GroupMember]] = {}
        user_ids = {member.user_id for member in members}
        for member in members:
            members_by_group.setdefault(member.group_id, []).append(member)
        users_by_id = {
            user.id: user
            for user in db.query(User).filter(User.id.in_(user_ids)).all()
        } if user_ids else {}
        return {
            "groups": [
                _serialize_group(group, members_by_group.get(group.id, []), users_by_id)
                for group in groups
            ]
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"list_groups failed: {e}")
    finally:
        db.close()


@app.post("/groups/{group_id}/members")
def add_group_members(group_id: int, payload: GroupMembersPayload, current_user: User = Depends(get_current_user)):
    if not _is_admin(current_user):
        raise HTTPException(403, "Admin access required")

    requested_user_ids = list(dict.fromkeys(payload.user_ids))
    if not requested_user_ids:
        raise HTTPException(400, "At least one user_id is required.")

    db = SessionLocal()
    try:
        group = db.query(Group).filter(Group.id == group_id).first()
        if not group:
            raise HTTPException(404, "Group not found")

        users = (
            db.query(User)
            .filter(User.id.in_(requested_user_ids), User.is_active.is_(True))
            .all()
        )
        valid_user_ids = {user.id for user in users}
        if not valid_user_ids:
            raise HTTPException(400, "No valid users selected.")

        existing = (
            db.query(GroupMember)
            .filter(GroupMember.group_id == group_id, GroupMember.user_id.in_(valid_user_ids))
            .all()
        )
        existing_ids = {member.user_id for member in existing}

        for user_id in valid_user_ids:
            if user_id in existing_ids:
                continue
            db.add(GroupMember(group_id=group_id, user_id=user_id))

        db.commit()
        all_members = (
            db.query(GroupMember)
            .filter(GroupMember.group_id == group_id)
            .order_by(GroupMember.id.asc())
            .all()
        )
        users_by_id = {
            user.id: user
            for user in db.query(User).filter(User.id.in_({member.user_id for member in all_members})).all()
        } if all_members else {}
        return {"group": _serialize_group(group, all_members, users_by_id)}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"add_group_members failed: {e}")
    finally:
        db.close()


@app.delete("/groups/{group_id}/members/{user_id}")
def remove_group_member(group_id: int, user_id: int, current_user: User = Depends(get_current_user)):
    if not _is_admin(current_user):
        raise HTTPException(403, "Admin access required")

    db = SessionLocal()
    try:
        group = db.query(Group).filter(Group.id == group_id).first()
        if not group:
            raise HTTPException(404, "Group not found")

        member = (
            db.query(GroupMember)
            .filter(GroupMember.group_id == group_id, GroupMember.user_id == user_id)
            .first()
        )
        if not member:
            raise HTTPException(404, "Group member not found")

        db.delete(member)
        db.commit()
        return {"success": True, "group_id": group_id, "user_id": user_id}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"remove_group_member failed: {e}")
    finally:
        db.close()


@app.delete("/groups/{group_id}")
def delete_group(group_id: int, current_user: User = Depends(get_current_user)):
    if not _is_admin(current_user):
        raise HTTPException(403, "Admin access required")

    db = SessionLocal()
    try:
        group = db.query(Group).filter(Group.id == group_id).first()
        if not group:
            raise HTTPException(404, "Group not found")

        db.query(GroupMember).filter(GroupMember.group_id == group_id).delete(synchronize_session=False)
        db.query(FieldReportShare).filter(
            FieldReportShare.shared_with_group_id == group_id
        ).delete(synchronize_session=False)
        db.delete(group)
        db.commit()

        return {
            "success": True,
            "deleted_group_id": group_id,
            "message": "Group deleted successfully.",
        }
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"delete_group failed: {e}")
    finally:
        db.close()


# ---------------------------
# HOTSPOTS
# ---------------------------
@app.post("/hotspots/seed")
def seed_hotspots(source: str = "sdpd_demo", n: int = 120, current_user: User = Depends(get_current_user)):
    db = SessionLocal()

    centers = [
        (32.7157, -117.1611),  # Downtown
        (32.7406, -117.0840),  # City Heights
        (32.7007, -117.0825),  # SE SD
        (32.7831, -117.1192),  # Clairemont
    ]

    now = datetime.utcnow()
    inserted = 0

    try:
        for _ in range(n):
            base_lat, base_lon = random.choice(centers)
            lat = base_lat + random.uniform(-0.01, 0.01)
            lon = base_lon + random.uniform(-0.01, 0.01)

            days_ago = random.choice([1, 1, 2, 3, 5, 7, 10, 14, 21, 28])
            occurred_at = now - timedelta(days=days_ago, hours=random.randint(0, 23))

            db.add(
                Incident(
                    source=source,
                    incident_type="demo",
                    occurred_at=occurred_at,
                    lat=lat,
                    lon=lon,
                )
            )
            inserted += 1

        db.commit()
        return {"status": "seeded", "inserted": inserted, "source": source}

    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"seed_hotspots failed: {e}")
    finally:
        db.close()


@app.post("/hotspots/run")
def compute_hotspots(source: str = "sdpd_demo", current_user: User = Depends(get_current_user)):
    db = SessionLocal()
    try:
        # clear previous cells
        db.query(HotspotCell).delete()
        db.commit()

        incidents = db.query(Incident).filter(Incident.source == source).all()
        if not incidents:
            return {"status": "no_incidents", "cells": 0}

        grid = {}
        now = datetime.utcnow()

        for inc in incidents:
            cell_lat = round(float(inc.lat), 2)
            cell_lon = round(float(inc.lon), 2)
            key = (cell_lat, cell_lon)

            if key not in grid:
                grid[key] = {"recent": 0, "baseline": 0}

            if (now - inc.occurred_at).days <= 7:
                grid[key]["recent"] += 1
            else:
                grid[key]["baseline"] += 1

        for (cell_lat, cell_lon), vals in grid.items():
            risk = vals["recent"] * 2 + vals["baseline"]
            db.add(
                HotspotCell(
                    grid_lat=cell_lat,
                    grid_lon=cell_lon,
                    recent_count=vals["recent"],
                    baseline_count=vals["baseline"],
                    risk_score=risk,
                )
            )

        db.commit()
        return {"status": "computed", "cells": len(grid)}

    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"compute_hotspots failed: {e}")
    finally:
        db.close()


@app.get("/hotspots")
def get_hotspots(current_user: User = Depends(get_current_user)):
    db = SessionLocal()
    try:
        cells = (
            db.query(HotspotCell)
            .order_by(HotspotCell.risk_score.desc())
            .limit(50)
            .all()
        )

        # Enrich each cell with incident intelligence
        all_incidents = db.query(Incident).all()
        # Build a grid lookup: (rounded_lat, rounded_lon) -> list of incidents
        grid_incidents: dict[tuple[float, float], list] = {}
        for inc in all_incidents:
            key = (round(float(inc.lat), 2), round(float(inc.lon), 2))
            grid_incidents.setdefault(key, []).append(inc)

        enriched = []
        for c in cells:
            key = (float(c.grid_lat), float(c.grid_lon))
            cell_incs = grid_incidents.get(key, [])

            # Top crime type by frequency
            type_counts: dict[str, int] = {}
            last_at = None
            for inc in cell_incs:
                t = str(inc.incident_type or "unknown")
                type_counts[t] = type_counts.get(t, 0) + 1
                if last_at is None or inc.occurred_at > last_at:
                    last_at = inc.occurred_at

            top_crime = max(type_counts, key=type_counts.get) if type_counts else None  # type: ignore[arg-type]
            top_crime_types = sorted(type_counts, key=lambda k: type_counts[k], reverse=True)[:3] if type_counts else []

            # Trend
            if c.baseline_count and c.baseline_count > 0:
                trend_pct = round(((c.recent_count - c.baseline_count) / c.baseline_count) * 100)
            elif c.recent_count > 0:
                trend_pct = None  # "New Spike"
            else:
                trend_pct = 0

            # Build human-readable summary
            trend_word = "increasing" if (trend_pct is not None and trend_pct > 0) else (
                "decreasing" if (trend_pct is not None and trend_pct < 0) else "new activity"
            )
            rc: int = getattr(c, "recent_count", 0)  # type: ignore[assignment]
            summary = f"Hot because {rc} recent incident{'s' if rc != 1 else ''}"
            if top_crime:
                summary += f", mostly {top_crime}"
            summary += f", with activity {trend_word} vs baseline."

            enriched.append({
                "id": c.id,
                "grid_lat": c.grid_lat,
                "grid_lon": c.grid_lon,
                "risk_score": c.risk_score,
                "recent_count": c.recent_count,
                "baseline_count": c.baseline_count,
                "top_crime_type": top_crime,
                "top_crime_types": top_crime_types,
                "last_incident_at": last_at.isoformat() if last_at else None,
                "trend_pct": trend_pct,
                "summary": summary,
            })

        return {"cells": enriched}

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"get_hotspots failed: {e}")
    finally:
        db.close()


@app.get("/hotspots/forecast")
def hotspot_forecast(source: str = "sdpd_nibrs", current_user: User = Depends(get_current_user)):
    """Lightweight predictive layer: which cells stay hot in the next 12h."""
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        now = datetime.utcnow()
        incidents = db.query(Incident).filter(Incident.source == source).all()
        if not incidents:
            return {"cells": []}

        grid: dict[tuple[float, float], dict] = {}
        for inc in incidents:
            key = (round(float(inc.lat), 2), round(float(inc.lon), 2))
            if key not in grid:
                grid[key] = {"recent": 0, "very_recent": 0, "baseline": 0}

            age_hours = max(0, (now - inc.occurred_at).total_seconds() / 3600)
            if age_hours <= 24:
                grid[key]["very_recent"] += 1
            if age_hours <= 168:  # 7 days
                grid[key]["recent"] += 1
            else:
                grid[key]["baseline"] += 1

        forecast_cells = []
        for (lat, lon), v in grid.items():
            score = (v["very_recent"] * 5) + (v["recent"] * 2) + v["baseline"]
            if score > 0:
                forecast_cells.append({
                    "grid_lat": lat,
                    "grid_lon": lon,
                    "forecast_score": score,
                    "very_recent_24h": v["very_recent"],
                    "recent_7d": v["recent"],
                    "baseline": v["baseline"],
                })

        forecast_cells.sort(key=lambda x: x["forecast_score"], reverse=True)
        return {"cells": forecast_cells[:30]}

    except Exception as e:
        raise HTTPException(500, f"hotspot_forecast failed: {e}")
    finally:
        db.close()


# ---------------------------
# TRIAGE
# ---------------------------
def _is_admin(user: User) -> bool:
    return (user.role or "").strip().lower() == "admin"


def _can_manage_client(client: Client, current_user: User) -> bool:
    if _is_admin(current_user):
        return True
    return client.created_by_user_id is not None and client.created_by_user_id == current_user.id


def _can_share_contact_log(contact_log: ContactLog, current_user: User) -> bool:
    if _is_admin(current_user):
        return True
    return (
        contact_log.created_by_user_id is not None
        and contact_log.created_by_user_id == current_user.id
    )


def _get_user_group_ids(db, user_id: int) -> list[int]:
    rows = db.query(GroupMember.group_id).filter(GroupMember.user_id == user_id).all()
    return [group_id for group_id, in rows]


def _serialize_group(group: Group, members: list[GroupMember], users_by_id: dict[int, User]):
    return {
        "id": group.id,
        "name": group.name,
        "description": group.description,
        "created_by_user_id": group.created_by_user_id,
        "created_at": group.created_at.isoformat() if group.created_at else None,
        "members": [
            {
                "id": member.user_id,
                "name": (users_by_id.get(member.user_id).name if users_by_id.get(member.user_id) else None),
                "email": (users_by_id.get(member.user_id).email if users_by_id.get(member.user_id) else None),
            }
            for member in members
            if users_by_id.get(member.user_id)
        ],
    }


def _serialize_field_report(
    report: FieldReport,
    sender: User | None,
    *,
    shared_with_users: Optional[list[dict[str, object]]] = None,
    shared_with_groups: Optional[list[dict[str, object]]] = None,
):
    share_users = shared_with_users or []
    share_groups = shared_with_groups or []
    is_shared = bool(share_users or share_groups)
    return {
        "id": report.id,
        "sender_user_id": report.sender_user_id,
        "sender_name": sender.name if sender else None,
        "sender_email": sender.email if sender else None,
        "title": report.title,
        "message": report.message,
        "location_text": report.location_text,
        "severity": report.severity,
        "status": report.status,
        "published_to_all": bool(report.published_to_all),
        "published_by_user_id": report.published_by_user_id,
        "visibility": "published" if report.published_to_all else "shared" if is_shared else "private",
        "shared_with_users": share_users,
        "shared_with_groups": share_groups,
        "created_at": report.created_at.isoformat() if report.created_at else None,
        "published_at": report.published_at.isoformat() if report.published_at else None,
    }


def serialize_client(c: Client, current_user: Optional[User] = None):
    can_view_private_notes = current_user is None or _can_manage_client(c, current_user)
    return {
        "id": c.id,
        "display_name": c.display_name,
        "created_by_user_id": c.created_by_user_id,
        "neighborhood": c.neighborhood,
        "notes": c.notes if can_view_private_notes else None,
        "created_at": c.created_at.isoformat() if c.created_at else None,
        "follow_up_at": c.follow_up_at.isoformat() if c.follow_up_at else None,
        "need_housing": c.need_housing,
        "need_food": c.need_food,
        "need_therapy": c.need_therapy,
        "need_job": c.need_job,
        "need_transport": c.need_transport,
        "home_lat": c.home_lat,
        "home_lon": c.home_lon,
    }


def _serialize_field_reports_for_rows(db, rows: list[tuple[FieldReport, User]]):
    report_ids = [report.id for report, _ in rows]
    share_rows = (
        db.query(FieldReportShare)
        .filter(FieldReportShare.field_report_id.in_(report_ids))
        .order_by(FieldReportShare.id.asc())
        .all()
        if report_ids
        else []
    )
    shares_by_report: dict[int, list[FieldReportShare]] = {}
    shared_user_ids: set[int] = set()
    shared_group_ids: set[int] = set()
    for share in share_rows:
        shares_by_report.setdefault(share.field_report_id, []).append(share)
        if share.shared_with_user_id is not None:
            shared_user_ids.add(share.shared_with_user_id)
        if share.shared_with_group_id is not None:
            shared_group_ids.add(share.shared_with_group_id)

    shared_users = {
        user.id: {"id": user.id, "name": user.name, "email": user.email}
        for user in db.query(User).filter(User.id.in_(shared_user_ids)).all()
    } if shared_user_ids else {}
    shared_groups = {
        group.id: {"id": group.id, "name": group.name}
        for group in db.query(Group).filter(Group.id.in_(shared_group_ids)).all()
    } if shared_group_ids else {}

    serialized = []
    for report, sender in rows:
        report_shares = shares_by_report.get(report.id, [])
        serialized.append(
            _serialize_field_report(
                report,
                sender,
                shared_with_users=[
                    shared_users[share.shared_with_user_id]
                    for share in report_shares
                    if share.shared_with_user_id in shared_users
                ],
                shared_with_groups=[
                    shared_groups[share.shared_with_group_id]
                    for share in report_shares
                    if share.shared_with_group_id in shared_groups
                ],
            )
        )
    return serialized


@app.post("/triage/clients")
def create_client(payload: dict, current_user: User = Depends(get_current_user)):
    name = (payload.get("display_name") or "").strip()
    if not name:
        raise HTTPException(400, "display_name is required")

    follow_raw = payload.get("follow_up_at")
    follow: Optional[datetime] = None
    if follow_raw not in (None, "", "null"):
        follow = datetime.fromisoformat(str(follow_raw))

    db = SessionLocal()
    try:
        c = Client(
            display_name=name,
            created_by_user_id=current_user.id,
            neighborhood=(payload.get("neighborhood") or "").strip() or None,
            notes=(payload.get("notes") or "").strip() or None,
            follow_up_at=follow,
            need_housing=bool(payload.get("need_housing", False)),
            need_food=bool(payload.get("need_food", False)),
            need_therapy=bool(payload.get("need_therapy", False)),
            need_job=bool(payload.get("need_job", False)),
            need_transport=bool(payload.get("need_transport", False)),
            home_lat=payload.get("home_lat"),
            home_lon=payload.get("home_lon"),
        )
        db.add(c)
        db.commit()
        db.refresh(c)
        return {"client": serialize_client(c, current_user)}

    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"create_client failed: {e}")
    finally:
        db.close()


@app.patch("/triage/clients/{client_id}")
def update_client(client_id: int, payload: dict, current_user: User = Depends(get_current_user)):
    db = SessionLocal()
    try:
        c = db.query(Client).filter(Client.id == client_id).first()
        if not c:
            raise HTTPException(404, "Client not found")

        if "display_name" in payload:
            v = payload.get("display_name")
            if v and str(v).strip():
                c.display_name = str(v).strip()

        if "neighborhood" in payload:
            v = payload.get("neighborhood") or ""
            c.neighborhood = str(v).strip() or None

        if "notes" in payload:
            v = payload.get("notes") or ""
            c.notes = str(v).strip() or None

        if "follow_up_at" in payload:
            raw = payload.get("follow_up_at")
            if raw in (None, "", "null"):
                c.follow_up_at = None
            else:
                c.follow_up_at = datetime.fromisoformat(str(raw))

        for key in ["need_housing", "need_food", "need_therapy", "need_job", "need_transport"]:
            if key in payload:
                setattr(c, key, bool(payload.get(key)))

        if "home_lat" in payload:
            c.home_lat = payload.get("home_lat")
        if "home_lon" in payload:
            c.home_lon = payload.get("home_lon")

        db.commit()
        db.refresh(c)
        return {"client": serialize_client(c, current_user)}

    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"update_client failed: {e}")
    finally:
        db.close()


@app.get("/triage/clients/{client_id}")
def get_client(client_id: int, current_user: User = Depends(get_current_user)):
    db = SessionLocal()
    try:
        c = db.query(Client).filter(Client.id == client_id).first()
        if not c:
            raise HTTPException(404, "Client not found")

        contacts_query = db.query(ContactLog).filter(ContactLog.client_id == client_id)
        if _is_admin(current_user):
            contacts_query = contacts_query.filter(ContactLog.created_by_user_id.is_not(None))
        else:
            shared_contact_ids = (
                db.query(ContactLogShare.contact_log_id)
                .filter(ContactLogShare.shared_with_user_id == current_user.id)
                .subquery()
            )
            contacts_query = contacts_query.filter(
                (ContactLog.created_by_user_id == current_user.id)
                | (ContactLog.id.in_(shared_contact_ids))
            )

        contacts = contacts_query.order_by(ContactLog.contacted_at.desc()).all()
        contact_owner_ids = {
            cl.created_by_user_id for cl in contacts if cl.created_by_user_id is not None
        }
        contact_ids = [cl.id for cl in contacts]
        shares_by_log: dict[int, list[ContactLogShare]] = {}
        shared_user_ids: set[int] = set()
        if contact_ids:
            share_rows = (
                db.query(ContactLogShare)
                .filter(ContactLogShare.contact_log_id.in_(contact_ids))
                .order_by(ContactLogShare.id.asc())
                .all()
            )
            for share in share_rows:
                shares_by_log.setdefault(share.contact_log_id, []).append(share)
                shared_user_ids.add(share.shared_with_user_id)

        user_lookup_ids = contact_owner_ids | shared_user_ids
        user_lookup = {}
        if user_lookup_ids:
            users = (
                db.query(User.id, User.name, User.email)
                .filter(User.id.in_(user_lookup_ids))
                .all()
            )
            user_lookup = {
                user_id: {"id": user_id, "name": user_name, "email": user_email}
                for user_id, user_name, user_email in users
            }

        return {
            "client": serialize_client(c, current_user),
            "contacts": [
                {
                    "id": cl.id,
                    "contacted_at": cl.contacted_at.isoformat(),
                    "outcome": cl.outcome,
                    "note": cl.note,
                    "created_by_user_id": cl.created_by_user_id,
                    "created_by_name": (user_lookup.get(cl.created_by_user_id) or {}).get("name"),
                    "visibility": "shared" if shares_by_log.get(cl.id) else "private",
                    "shared_with_users": [
                        user_lookup.get(share.shared_with_user_id)
                        for share in shares_by_log.get(cl.id, [])
                        if user_lookup.get(share.shared_with_user_id)
                    ],
                }
                for cl in contacts
            ],
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"get_client failed: {e}")
    finally:
        db.close()


@app.delete("/triage/clients/{client_id}")
def delete_client(client_id: int, current_user: User = Depends(get_current_user)):
    db = SessionLocal()
    try:
        c = db.query(Client).filter(Client.id == client_id).first()
        if not c:
            raise HTTPException(404, "Client not found")

        if not _can_manage_client(c, current_user):
            raise HTTPException(403, "You do not have permission to delete this client.")

        db.query(ContactLog).filter(ContactLog.client_id == client_id).delete()
        db.delete(c)
        db.commit()

        return {"success": True, "client_id": client_id}

    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"delete_client failed: {e}")
    finally:
        db.close()


@app.post("/triage/clients/{client_id}/contacts")
def log_contact(client_id: int, payload: dict, current_user: User = Depends(get_current_user)):
    outcome = (payload.get("outcome") or "").strip()
    if outcome not in ["reached", "no_answer", "referral", "other"]:
        raise HTTPException(400, "Invalid outcome")

    note = (payload.get("note") or "").strip() or None

    db = SessionLocal()
    try:
        c = db.query(Client).filter(Client.id == client_id).first()
        if not c:
            raise HTTPException(404, "Client not found")

        cl = ContactLog(
            client_id=client_id,
            created_by_user_id=current_user.id,
            outcome=outcome,
            note=note,
        )
        db.add(cl)
        db.commit()
        db.refresh(cl)

        return {
            "contact": {
                "id": cl.id,
                "client_id": client_id,
                "contacted_at": cl.contacted_at.isoformat(),
                "outcome": cl.outcome,
                "note": cl.note,
            }
        }

    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"log_contact failed: {e}")
    finally:
        db.close()


@app.post("/triage/contact-logs/{log_id}/share")
def share_contact_log(log_id: int, payload: ShareContactLogPayload, current_user: User = Depends(get_current_user)):
    requested_user_ids = list(dict.fromkeys(payload.user_ids))
    if not requested_user_ids:
        raise HTTPException(400, "At least one user_id is required.")

    db = SessionLocal()
    try:
        contact_log = db.query(ContactLog).filter(ContactLog.id == log_id).first()
        if not contact_log or contact_log.created_by_user_id is None:
            raise HTTPException(404, "Contact log not found")

        if not _can_share_contact_log(contact_log, current_user):
            raise HTTPException(403, "You do not have permission to share this note.")

        target_users = (
            db.query(User)
            .filter(User.id.in_(requested_user_ids), User.is_active.is_(True))
            .all()
        )
        valid_target_ids = {
            user.id for user in target_users if user.id != contact_log.created_by_user_id
        }
        if not valid_target_ids:
            raise HTTPException(400, "No valid users selected for sharing.")

        existing_shares = (
            db.query(ContactLogShare)
            .filter(ContactLogShare.contact_log_id == log_id)
            .all()
        )
        existing_by_user = {share.shared_with_user_id: share for share in existing_shares}

        for share in existing_shares:
            if share.shared_with_user_id not in valid_target_ids:
                db.delete(share)

        for user_id in valid_target_ids:
            if user_id in existing_by_user:
                continue
            db.add(
                ContactLogShare(
                    contact_log_id=log_id,
                    shared_with_user_id=user_id,
                    created_by_user_id=current_user.id,
                )
            )

        db.commit()

        shared_with_users = [
            {"id": user.id, "name": user.name, "email": user.email}
            for user in target_users
            if user.id in valid_target_ids
        ]
        return {
            "success": True,
            "contact_log_id": log_id,
            "visibility": "shared",
            "shared_with_users": shared_with_users,
        }
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"share_contact_log failed: {e}")
    finally:
        db.close()


@app.post("/field-reports")
def create_field_report(payload: CreateFieldReportPayload, current_user: User = Depends(get_current_user)):
    title = payload.title.strip()
    message = payload.message.strip()
    location_text = payload.location_text.strip() if payload.location_text else None
    severity = payload.severity.strip().lower() if payload.severity else None

    if severity not in (None, "low", "medium", "high"):
        raise HTTPException(400, "Severity must be low, medium, or high.")

    db = SessionLocal()
    try:
        report = FieldReport(
            sender_user_id=current_user.id,
            title=title,
            message=message,
            location_text=location_text or None,
            severity=severity,
            status="new",
        )
        db.add(report)
        db.commit()
        db.refresh(report)
        return {"report": _serialize_field_report(report, current_user)}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"create_field_report failed: {e}")
    finally:
        db.close()


@app.get("/field-reports/inbox")
def field_reports_inbox(current_user: User = Depends(get_current_user)):
    if not _is_admin(current_user):
        raise HTTPException(403, "Admin access required")

    db = SessionLocal()
    try:
        rows = (
            db.query(FieldReport, User)
            .join(User, User.id == FieldReport.sender_user_id)
            .order_by(FieldReport.created_at.desc(), FieldReport.id.desc())
            .all()
        )
        return {"reports": _serialize_field_reports_for_rows(db, rows)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"field_reports_inbox failed: {e}")
    finally:
        db.close()


@app.get("/field-reports")
def field_reports(current_user: User = Depends(get_current_user)):
    db = SessionLocal()
    try:
        rows_query = db.query(FieldReport, User).join(User, User.id == FieldReport.sender_user_id)
        if _is_admin(current_user):
            pass
        else:
            shared_report_ids = (
                db.query(FieldReportShare.field_report_id)
                .filter(FieldReportShare.shared_with_user_id == current_user.id)
            )
            group_ids = _get_user_group_ids(db, current_user.id)
            if group_ids:
                shared_report_ids = shared_report_ids.union(
                    db.query(FieldReportShare.field_report_id).filter(FieldReportShare.shared_with_group_id.in_(group_ids))
                )

            visibility_filter = or_(
                FieldReport.published_to_all.is_(True),
                FieldReport.id.in_(shared_report_ids.subquery()),
            )
            if (current_user.role or "").strip().lower() == "police":
                visibility_filter = or_(visibility_filter, FieldReport.sender_user_id == current_user.id)
            rows_query = rows_query.filter(
                visibility_filter
            )

        rows = rows_query.order_by(FieldReport.created_at.desc(), FieldReport.id.desc()).all()
        return {"reports": _serialize_field_reports_for_rows(db, rows)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"field_reports failed: {e}")
    finally:
        db.close()


@app.post("/field-reports/{report_id}/mark-reviewed")
def mark_field_report_reviewed(report_id: int, current_user: User = Depends(get_current_user)):
    if not _is_admin(current_user):
        raise HTTPException(403, "Admin access required")

    db = SessionLocal()
    try:
        report = db.query(FieldReport).filter(FieldReport.id == report_id).first()
        if not report:
            raise HTTPException(404, "Field report not found")

        report.status = "reviewed"
        db.commit()
        db.refresh(report)

        sender = db.query(User).filter(User.id == report.sender_user_id).first()
        return {"report": _serialize_field_report(report, sender)}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"mark_field_report_reviewed failed: {e}")
    finally:
        db.close()


@app.delete("/field-reports/{report_id}")
def delete_field_report(report_id: int, current_user: User = Depends(get_current_user)):
    if not _is_admin(current_user):
        raise HTTPException(403, "Admin access required")

    db = SessionLocal()
    try:
        report = db.query(FieldReport).filter(FieldReport.id == report_id).first()
        if not report:
            raise HTTPException(404, "Field report not found")

        db.query(FieldReportShare).filter(
            FieldReportShare.field_report_id == report_id
        ).delete(synchronize_session=False)
        db.delete(report)
        db.commit()

        return {
            "success": True,
            "deleted_field_report_id": report_id,
            "message": "Field report deleted successfully.",
        }
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"delete_field_report failed: {e}")
    finally:
        db.close()


@app.post("/field-reports/{report_id}/share")
def share_field_report(report_id: int, payload: ShareFieldReportPayload, current_user: User = Depends(get_current_user)):
    if not _is_admin(current_user):
        raise HTTPException(403, "Admin access required")

    requested_user_ids = list(dict.fromkeys(payload.user_ids))
    requested_group_ids = list(dict.fromkeys(payload.group_ids))
    if not requested_user_ids and not requested_group_ids:
        raise HTTPException(400, "At least one user_id or group_id is required.")

    db = SessionLocal()
    try:
        report = db.query(FieldReport).filter(FieldReport.id == report_id).first()
        if not report:
            raise HTTPException(404, "Field report not found")

        target_users = (
            db.query(User)
            .filter(User.id.in_(requested_user_ids), User.is_active.is_(True))
            .all()
            if requested_user_ids
            else []
        )
        valid_user_ids = {user.id for user in target_users}
        target_groups = (
            db.query(Group)
            .filter(Group.id.in_(requested_group_ids))
            .all()
            if requested_group_ids
            else []
        )
        valid_group_ids = {group.id for group in target_groups}

        if not valid_user_ids and not valid_group_ids:
            raise HTTPException(400, "No valid users or groups selected.")

        existing_shares = (
            db.query(FieldReportShare)
            .filter(FieldReportShare.field_report_id == report_id)
            .all()
        )
        keep_pairs = {
            ("user", user_id) for user_id in valid_user_ids
        } | {
            ("group", group_id) for group_id in valid_group_ids
        }

        existing_pairs = set()
        for share in existing_shares:
            pair = (
                "user",
                share.shared_with_user_id,
            ) if share.shared_with_user_id is not None else (
                "group",
                share.shared_with_group_id,
            )
            if pair not in keep_pairs:
                db.delete(share)
            else:
                existing_pairs.add(pair)

        for user_id in valid_user_ids:
            pair = ("user", user_id)
            if pair in existing_pairs:
                continue
            db.add(
                FieldReportShare(
                    field_report_id=report_id,
                    shared_with_user_id=user_id,
                    created_by_user_id=current_user.id,
                )
            )

        for group_id in valid_group_ids:
            pair = ("group", group_id)
            if pair in existing_pairs:
                continue
            db.add(
                FieldReportShare(
                    field_report_id=report_id,
                    shared_with_group_id=group_id,
                    created_by_user_id=current_user.id,
                )
            )

        db.commit()

        return {
            "success": True,
            "field_report_id": report_id,
            "visibility": "shared",
            "shared_with_users": [
                {"id": user.id, "name": user.name, "email": user.email}
                for user in target_users
            ],
            "shared_with_groups": [
                {"id": group.id, "name": group.name}
                for group in target_groups
            ],
        }
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"share_field_report failed: {e}")
    finally:
        db.close()


@app.post("/field-reports/{report_id}/publish")
def publish_field_report(report_id: int, current_user: User = Depends(get_current_user)):
    if not _is_admin(current_user):
        raise HTTPException(403, "Admin access required")

    db = SessionLocal()
    try:
        report = db.query(FieldReport).filter(FieldReport.id == report_id).first()
        if not report:
            raise HTTPException(404, "Field report not found")

        report.published_to_all = True
        report.published_by_user_id = current_user.id
        report.published_at = datetime.utcnow()
        db.commit()
        db.refresh(report)

        sender = db.query(User).filter(User.id == report.sender_user_id).first()
        return {"report": _serialize_field_report(report, sender)}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"publish_field_report failed: {e}")
    finally:
        db.close()


@app.get("/triage/queue")
def triage_queue(current_user: User = Depends(get_current_user)):
    db = SessionLocal()
    now = datetime.utcnow()
    cutoff = now - timedelta(days=30)

    try:
        last_contact = (
            db.query(ContactLog.client_id, func.max(ContactLog.contacted_at).label("last_time"))
            .group_by(ContactLog.client_id)
            .subquery()
        )

        misses = (
            db.query(ContactLog.client_id, func.count(ContactLog.id).label("misses_30d"))
            .filter(ContactLog.outcome == "no_answer", ContactLog.contacted_at >= cutoff)
            .group_by(ContactLog.client_id)
            .subquery()
        )

        rows = (
            db.query(Client, last_contact.c.last_time, misses.c.misses_30d)
            .outerjoin(last_contact, last_contact.c.client_id == Client.id)
            .outerjoin(misses, misses.c.client_id == Client.id)
            .all()
        )

        items = []
        for c, last_time, miss_count in rows:
            miss_count = int(miss_count or 0)
            days_since = 9999 if not last_time else max(0, (now - last_time).days)

            base_urgency = (miss_count * 5) + min(days_since, 60)

            follow_up_urgency = 0
            if c.follow_up_at:
                diff_days = (now - c.follow_up_at).days
                if diff_days >= 0:
                    follow_up_urgency = 50 + min(diff_days, 30)
                else:
                    soon = abs(diff_days)
                    if soon <= 2:
                        follow_up_urgency = 15
                    elif soon <= 7:
                        follow_up_urgency = 8

            urgency = base_urgency + follow_up_urgency

            needs_count = (
                int(bool(c.need_housing))
                + int(bool(c.need_food))
                + int(bool(c.need_therapy))
                + int(bool(c.need_job))
                + int(bool(c.need_transport))
            )

            items.append({
                "client_id": c.id,
                "display_name": c.display_name,
                "neighborhood": c.neighborhood,
                "days_since_last": days_since,
                "misses_30d": miss_count,
                "urgency_score": urgency,
                "follow_up_at": c.follow_up_at.isoformat() if c.follow_up_at else None,
                "needs_count": needs_count,
            })

        items.sort(key=lambda x: x["urgency_score"], reverse=True)
        return {"items": items}

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"triage_queue failed: {e}")
    finally:
        db.close()


# ---------------------------
# CONTEXT (nearest hotspot for client)
# ---------------------------
def _dist2(a_lat, a_lon, b_lat, b_lon):
    return (a_lat - b_lat) ** 2 + (a_lon - b_lon) ** 2


@app.get("/triage/clients/{client_id}/context")
def client_context(client_id: int, current_user: User = Depends(get_current_user)):
    db = SessionLocal()
    try:
        c = db.query(Client).filter(Client.id == client_id).first()
        if not c:
            raise HTTPException(404, "Client not found")

        if c.home_lat is None or c.home_lon is None:
            return {"nearest_hotspot": None}

        cells = db.query(HotspotCell).all()
        if not cells:
            return {"nearest_hotspot": None}

        best = None
        best_d = None
        for cell in cells:
            d = _dist2(c.home_lat, c.home_lon, cell.grid_lat, cell.grid_lon)
            if best_d is None or d < best_d:
                best_d = d
                best = cell

        return {
            "nearest_hotspot": {
                "id": best.id,
                "grid_lat": best.grid_lat,
                "grid_lon": best.grid_lon,
                "risk_score": best.risk_score,
                "recent_count": best.recent_count,
                "baseline_count": best.baseline_count,
            }
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"client_context failed: {e}")
    finally:
        db.close()


# ---------------------------
# EVENTS (SDPD NIBRS via ArcGIS, with demo fallback)
# ---------------------------

_DEMO_INCIDENT_TYPES = [
    "assault", "burglary", "theft", "vandalism", "robbery",
    "dui", "drug_offense", "trespassing", "disturbance", "vehicle_theft",
]

_SD_CENTERS = [
    (32.7157, -117.1611),  # Downtown
    (32.7406, -117.0840),  # City Heights
    (32.7007, -117.0825),  # SE SD
    (32.7831, -117.1192),  # Clairemont
    (32.7484, -117.1325),  # North Park
]


def _seed_demo_events(db, days: int, n: int = 150) -> int:
    """Wipe and repopulate demo events. Returns count inserted."""
    db.query(Incident).filter(Incident.source == "sdpd_demo_events").delete()
    now = datetime.utcnow()
    for i in range(n):
        base_lat, base_lon = _SD_CENTERS[i % len(_SD_CENTERS)]
        lat = base_lat + random.uniform(-0.025, 0.025)
        lon = base_lon + random.uniform(-0.025, 0.025)
        days_ago = random.uniform(0, days)
        occurred_at = now - timedelta(days=days_ago, hours=random.randint(0, 23))
        db.add(Incident(
            source="sdpd_demo_events",
            incident_type=random.choice(_DEMO_INCIDENT_TYPES),
            offense_category=random.choice(_DEMO_INCIDENT_TYPES).replace("_", " ").title(),
            occurred_at=occurred_at,
            lat=lat,
            lon=lon,
        ))
    return n


@app.post("/events/pull")
def pull_events(days: int = 7, current_user: User = Depends(get_current_user)):
    """Fetch SDPD NIBRS incidents from ArcGIS; fall back to demo data."""
    Base.metadata.create_all(bind=engine)
    _ensure_incident_columns()

    since = datetime.utcnow() - timedelta(days=days)

    params: dict[str, str] = {
        "f": "json",
        "outFields": (
            "NIBRS_UNIQ,OCCURED_ON,IBR_OFFENSE_DESCRIPTION,PD_OFFENSE_CATEGORY,"
            "BLOCK_ADDR,CODE_SECTION,IBR_OFFENSE,X,Y"
        ),
        "returnGeometry": "true",
        "outSR": "4326",
        "where": f"OCCURED_ON >= TIMESTAMP '{since.strftime('%Y-%m-%d %H:%M:%S')}'",
        "resultRecordCount": "2000",
    }

    features: list = []
    arcgis_error: str | None = None
    try:
        resp = httpx.get(_ARCGIS_URL, params=params, timeout=30)
        resp.raise_for_status()
        body = resp.json()
        if "error" in body:
            arcgis_error = str(body["error"])
        else:
            features = body.get("features") or []
    except Exception as e:
        arcgis_error = str(e)

    db = SessionLocal()
    try:
        if features:
            inserted = 0
            skipped = 0
            for feat in features:
                attrs = feat.get("attributes") or {}
                geom = feat.get("geometry") or {}

                # --- external_id from NIBRS_UNIQ ---
                nibrs_uniq = attrs.get("NIBRS_UNIQ")
                if not nibrs_uniq:
                    skipped += 1
                    continue
                external_id = f"sdpd_{nibrs_uniq}"

                # --- coordinates: prefer geometry x/y, fall back to X/Y attrs ---
                lon = geom.get("x") if geom.get("x") is not None else attrs.get("X")
                lat = geom.get("y") if geom.get("y") is not None else attrs.get("Y")
                if lat is None or lon is None:
                    skipped += 1
                    continue

                # --- occurred_at from OCCURED_ON (epoch ms) ---
                ts_raw = attrs.get("OCCURED_ON")
                if ts_raw:
                    occurred_at = datetime.utcfromtimestamp(int(ts_raw) / 1000)
                else:
                    occurred_at = datetime.utcnow()

                # --- incident_type / offense_category ---
                incident_type = str(
                    attrs.get("IBR_OFFENSE_DESCRIPTION")
                    or attrs.get("PD_OFFENSE_CATEGORY")
                    or "unknown"
                )
                offense_category = str(
                    attrs.get("PD_OFFENSE_CATEGORY")
                    or attrs.get("IBR_OFFENSE_DESCRIPTION")
                    or "unknown"
                )
                block_address = attrs.get("BLOCK_ADDR")
                code_section = attrs.get("CODE_SECTION")
                offense_code = attrs.get("IBR_OFFENSE")

                # --- upsert by external_id ---
                existing = db.query(Incident).filter(
                    Incident.external_id == external_id
                ).first()
                if existing:
                    existing.lat = lat
                    existing.lon = lon
                    existing.occurred_at = occurred_at
                    existing.offense_category = offense_category
                    existing.incident_type = incident_type
                    existing.block_address = str(block_address) if block_address else None
                    existing.code_section = str(code_section) if code_section else None
                    existing.offense_code = str(offense_code) if offense_code else None
                    skipped += 1
                else:
                    db.add(Incident(
                        external_id=external_id,
                        source="sdpd_nibrs",
                        incident_type=incident_type,
                        offense_category=offense_category,
                        block_address=str(block_address) if block_address else None,
                        code_section=str(code_section) if code_section else None,
                        offense_code=str(offense_code) if offense_code else None,
                        occurred_at=occurred_at,
                        lat=float(lat),
                        lon=float(lon),
                    ))
                    inserted += 1

            db.commit()
            return {"inserted": inserted, "skipped": skipped, "source": "sdpd_nibrs"}

        # --- Demo fallback when ArcGIS is unreachable / empty ---
        n = _seed_demo_events(db, days)
        db.commit()
        return {
            "inserted": n,
            "skipped": 0,
            "source": "demo",
            "arcgis_note": arcgis_error or "no features returned",
        }

    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(500, f"pull_events failed: {e}")
    finally:
        db.close()


@app.get("/events")
def get_events(days: int = 7, current_user: User = Depends(get_current_user)):
    """Return incidents from the last `days` days for the map."""
    Base.metadata.create_all(bind=engine)
    _ensure_incident_columns()
    since = datetime.utcnow() - timedelta(days=days)
    db = SessionLocal()
    try:
        incidents = (
            db.query(Incident)
            .filter(Incident.occurred_at >= since)
            .order_by(Incident.occurred_at.desc())
            .limit(2000)
            .all()
        )
        return {
            "items": [
                {
                    "id": inc.id,
                    "external_id": inc.external_id,
                    "lat": inc.lat,
                    "lon": inc.lon,
                    "occurred_at": inc.occurred_at.isoformat(),
                    "incident_type": inc.incident_type,
                    "offense_category": inc.offense_category,
                    "block_address": inc.block_address,
                    "code_section": inc.code_section,
                    "offense_code": inc.offense_code,
                    "source": inc.source,
                }
                for inc in incidents
            ]
        }
    except Exception as e:
        raise HTTPException(500, f"get_events failed: {e}")
    finally:
        db.close()


# ---------------------------
# SCREENING (placeholder)
# ---------------------------
@app.post("/screening/submit")
def screening_submit(payload: dict, current_user: User = Depends(get_current_user)):
    notes = (payload.get("notes") or "").lower()
    risk_words = ["weapon", "kill", "gun", "danger", "suicidal", "harm"]
    is_escalated = any(w in notes for w in risk_words)

    return {
        "is_escalated": is_escalated,
        "escalation_reason": "High-risk keywords detected" if is_escalated else None,
        "next_steps": "Immediate outreach recommended" if is_escalated else "Routine follow-up",
    }
