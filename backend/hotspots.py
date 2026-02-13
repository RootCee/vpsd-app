from datetime import datetime, timedelta
from math import floor
from db import SessionLocal
from models import Incident, HotspotCell

GRID_SIZE = 0.005  # ≈ 500m

def grid(val):
    return floor(val / GRID_SIZE) * GRID_SIZE

def compute_hotspots(source: str):
    db = SessionLocal()
    db.query(HotspotCell).delete()

    now = datetime.utcnow()
    recent_cut = now - timedelta(days=7)
    baseline_cut = now - timedelta(days=35)

    incidents = db.query(Incident).filter(Incident.source == source).all()
    cells = {}

    for i in incidents:
        key = (grid(i.lat), grid(i.lon))
        cells.setdefault(key, {"recent": 0, "baseline": 0})

        if i.occurred_at >= recent_cut:
            cells[key]["recent"] += 1
        elif i.occurred_at >= baseline_cut:
            cells[key]["baseline"] += 1

    for (lat, lon), c in cells.items():
        risk = c["recent"] - (c["baseline"] // 4)
        db.add(HotspotCell(
            grid_lat=lat,
            grid_lon=lon,
            recent_count=c["recent"],
            baseline_count=c["baseline"],
            risk_score=risk
        ))

    db.commit()
    db.close()
