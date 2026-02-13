# Copilot / AI Agent Instructions — VP San Diego (vpsd)

Purpose: quickly orient an AI editing agent so it can make safe, high-impact changes.

Overview
- Backend: FastAPI + SQLite located in `backend/`. Main entry: [backend/main.py](backend/main.py#L1-L400).
- Mobile: Expo React Native app in [mobile/vpsd-mobile](mobile/vpsd-mobile/README.md). API client config is in [mobile/vpsd-mobile/src/config.ts](mobile/vpsd-mobile/src/config.ts#L1).

Where to look first
- `backend/main.py` — implement/adjust API behavior; triage/hotspots/screening logic lives here.
- `backend/models.py` — DB models; `Client` and `ContactLog` shapes are relied upon by triage features.
- `backend/hotspots.py` — grid bucketing and hotspot scoring (`GRID_SIZE = 0.005`).
- `backend/ingest.py` — CSV parsing rules: expects a date/time column and lat/lon columns.
- `backend/db.py` — `SessionLocal` factory and `Base` for models.

Developer workflows (copy-paste)
- Start backend (dev):
  ```bash
  cd backend
  source .venv/bin/activate   # or create venv: python3 -m venv .venv
  pip install -r requirements.txt
  python init_db.py
  uvicorn main:app --reload --host 0.0.0.0 --port 8000
  ```
- Start mobile (Expo):
  ```bash
  cd mobile/vpsd-mobile
  npm install
  npm start
  ```
- Device testing: set your machine LAN IP in [mobile/vpsd-mobile/src/config.ts](mobile/vpsd-mobile/src/config.ts#L1) as `API_BASE` and restart both backend + Expo.

Project-specific conventions
- SQLite is the single source of truth in dev: `backend/vpsd.db`. To reset DB: remove it and run `python init_db.py`.
- DB session pattern: call `db = SessionLocal()` and always `db.close()` in finally blocks (see `main.py`).
- Endpoint payloads are simple dicts (no Pydantic models used in `main.py`). Follow existing validation style (manual checks + HTTPException).
- CSV ingestion normalizes headers to lowercase and looks for columns with "date"/"time" and lat/lon variants — modifying `parse_csv()` changes what CSVs are accepted.

Integration points & examples
- Hotspots workflow:
  - Seed demo: POST `/hotspots/seed?source=sdpd_demo&n=120`
  - Upload CSV: POST `/hotspots/upload` (multipart form `file`) — parsed by `ingest.parse_csv()`
  - Compute: POST `/hotspots/run?source=<source>` calls `compute_hotspots()` which writes `HotspotCell` rows.
- Triage workflow:
  - Create client: POST `/triage/clients` with `display_name` and optional `follow_up_at` ISO string and boolean `need_*` fields.
  - Queue: GET `/triage/queue` — implements urgency scoring (misses, days since last contact, overdue follow_up_at). See `main.py` for exact formula.
- Screening: POST `/screening/submit` — simple keyword-based escalation; keywords include `suicide`, `gun`, `kill`.

Testing & safety
- There are no automated tests in repo — validate changes manually by running the backend + Expo client.
- For DB schema edits: update `models.py` and then recreate DB using `rm backend/vpsd.db && python init_db.py` (development-only).

When editing
- Small, local changes preferred: modify the smallest file that implements behavior (e.g., change scoring in `hotspots.py` rather than changing UI).
- Preserve the `SessionLocal()` / commit / refresh patterns in `main.py` to avoid subtle DB issues.
- If adding new endpoints, follow the lightweight validation style in `main.py` and keep responses JSON-serializable primitives.

If unclear or you need a deeper walk-through, ask for which feature to explore (Hotspots / Triage / Screening / Mobile config).
