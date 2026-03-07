from datetime import datetime, timedelta
import random
from typing import Optional

import httpx
from fastapi import FastAPI, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import func

from db import SessionLocal, engine, Base
from models import Incident, HotspotCell, Client, ContactLog, User
from auth import hash_password, verify_password, create_access_token, get_current_user

# ArcGIS FeatureServer for SDPD NIBRS (City of San Diego hosted)
_ARCGIS_URL = (
    "https://webmaps.sandiego.gov/arcgis/rest/services"
    "/SDPD/SDPD_NIBRS_Crime_Offenses_Geo/FeatureServer/0/query"
)


app = FastAPI()

# ---------------------------
# STARTUP: CREATE TABLES
# ---------------------------
@app.on_event("startup")
def on_startup():
    # Creates tables automatically on boot (critical for Render)
    Base.metadata.create_all(bind=engine)


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
    return {"status": "initialized"}


# ---------------------------
# HEALTH
# ---------------------------
@app.get("/health")
def health():
    return {"status": "ok"}


# ---------------------------
# AUTHENTICATION
# ---------------------------
@app.post("/auth/register")
def register(payload: dict):
    email = (payload.get("email") or "").strip().lower()
    password = (payload.get("password") or "").strip()

    if not email or "@" not in email:
        raise HTTPException(400, "Valid email is required")

    if not password or len(password) < 6:
        raise HTTPException(400, "Password must be at least 6 characters")

    db = SessionLocal()
    try:
        # Check if user already exists
        existing = db.query(User).filter(User.email == email).first()
        if existing:
            raise HTTPException(400, "Email already registered")

        # Create new user
        hashed_pwd = hash_password(password)
        user = User(email=email, hashed_password=hashed_pwd, is_active=True)
        db.add(user)
        db.commit()
        db.refresh(user)

        # Generate access token
        access_token = create_access_token(data={"sub": user.id})

        return {
            "access_token": access_token,
            "token_type": "bearer",
            "user": {
                "id": user.id,
                "email": user.email,
                "is_active": user.is_active,
            }
        }

    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"register failed: {e}")
    finally:
        db.close()


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

        # Generate access token
        access_token = create_access_token(data={"sub": user.id})

        return {
            "access_token": access_token,
            "token_type": "bearer",
            "user": {
                "id": user.id,
                "email": user.email,
                "is_active": user.is_active,
            }
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"login failed: {e}")
    finally:
        db.close()


# ---------------------------
# HOTSPOTS
# ---------------------------
@app.post("/hotspots/seed")
def seed_hotspots(source: str = "sdpd_demo", n: int = 120):
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
def compute_hotspots(source: str = "sdpd_demo"):
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
def get_hotspots():
    db = SessionLocal()
    try:
        cells = (
            db.query(HotspotCell)
            .order_by(HotspotCell.risk_score.desc())
            .limit(50)
            .all()
        )

        return {
            "cells": [
                {
                    "id": c.id,
                    "grid_lat": c.grid_lat,
                    "grid_lon": c.grid_lon,
                    "risk_score": c.risk_score,
                    "recent_count": c.recent_count,
                    "baseline_count": c.baseline_count,
                }
                for c in cells
            ]
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"get_hotspots failed: {e}")
    finally:
        db.close()


# ---------------------------
# TRIAGE
# ---------------------------
def serialize_client(c: Client):
    return {
        "id": c.id,
        "display_name": c.display_name,
        "neighborhood": c.neighborhood,
        "notes": c.notes,
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
        return {"client": serialize_client(c)}

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
        return {"client": serialize_client(c)}

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

        contacts = (
            db.query(ContactLog)
            .filter(ContactLog.client_id == client_id)
            .order_by(ContactLog.contacted_at.desc())
            .all()
        )

        return {
            "client": serialize_client(c),
            "contacts": [
                {
                    "id": cl.id,
                    "contacted_at": cl.contacted_at.isoformat(),
                    "outcome": cl.outcome,
                    "note": cl.note,
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

        cl = ContactLog(client_id=client_id, outcome=outcome, note=note)
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
def pull_events(days: int = 7):
    """Fetch SDPD NIBRS incidents from ArcGIS; fall back to demo data."""
    Base.metadata.create_all(bind=engine)

    since = datetime.utcnow() - timedelta(days=days)

    params: dict[str, str] = {
        "f": "json",
        "outFields": "NIBRS_UNIQ,OCCURED_ON,IBR_OFFENSE_DESCRIPTION,PD_OFFENSE_CATEGORY,X,Y",
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
                    skipped += 1
                else:
                    db.add(Incident(
                        external_id=external_id,
                        source="sdpd_nibrs",
                        incident_type=incident_type,
                        offense_category=offense_category,
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
def get_events(days: int = 7):
    """Return incidents from the last `days` days for the map."""
    Base.metadata.create_all(bind=engine)
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
                    "lat": inc.lat,
                    "lon": inc.lon,
                    "occurred_at": inc.occurred_at.isoformat(),
                    "incident_type": inc.incident_type,
                    "offense_category": inc.offense_category,
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
def screening_submit(payload: dict):
    notes = (payload.get("notes") or "").lower()
    risk_words = ["weapon", "kill", "gun", "danger", "suicidal", "harm"]
    is_escalated = any(w in notes for w in risk_words)

    return {
        "is_escalated": is_escalated,
        "escalation_reason": "High-risk keywords detected" if is_escalated else None,
        "next_steps": "Immediate outreach recommended" if is_escalated else "Routine follow-up",
    }