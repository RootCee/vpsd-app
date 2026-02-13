from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from datetime import datetime, timedelta
from sqlalchemy import func
from db import SessionLocal
from models import Incident, HotspotCell, Client, ContactLog
import random

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------
# HEALTH
# ---------------------------
@app.get("/health")
def health():
    return {"status": "ok"}


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
    finally:
        db.close()


@app.post("/hotspots/run")
def compute_hotspots(source: str = "sdpd_demo"):
    db = SessionLocal()
    try:
        db.query(HotspotCell).delete()
        db.commit()

        incidents = db.query(Incident).filter(Incident.source == source).all()
        if not incidents:
            return {"status": "no_incidents", "cells": 0}

        grid = {}
        now = datetime.utcnow()

        for inc in incidents:
            cell_lat = round(inc.lat, 2)
            cell_lon = round(inc.lon, 2)
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
        "created_at": c.created_at.isoformat(),
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
def create_client(payload: dict):
    name = (payload.get("display_name") or "").strip()
    if not name:
        raise HTTPException(400, "display_name is required")

    follow_raw = payload.get("follow_up_at")
    follow = None
    if follow_raw not in (None, "", "null"):
        follow = datetime.fromisoformat(follow_raw)

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
    finally:
        db.close()


@app.patch("/triage/clients/{client_id}")
def update_client(client_id: int, payload: dict):
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

        # location
        if "home_lat" in payload:
            c.home_lat = payload.get("home_lat")
        if "home_lon" in payload:
            c.home_lon = payload.get("home_lon")

        db.commit()
        db.refresh(c)
        return {"client": serialize_client(c)}
    finally:
        db.close()


@app.get("/triage/clients/{client_id}")
def get_client(client_id: int):
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
    finally:
        db.close()


@app.post("/triage/clients/{client_id}/contacts")
def log_contact(client_id: int, payload: dict):
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
    finally:
        db.close()


@app.get("/triage/queue")
def triage_queue():
    db = SessionLocal()
    now = datetime.utcnow()
    cutoff = now - timedelta(days=30)

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
    db.close()
    return {"items": items}


def _dist2(a_lat, a_lon, b_lat, b_lon):
    return (a_lat - b_lat) ** 2 + (a_lon - b_lon) ** 2


@app.get("/triage/clients/{client_id}/context")
def client_context(client_id: int):
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
