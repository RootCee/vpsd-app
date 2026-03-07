# TESTING — Events Layer

All commands assume `vpsd/` as the repo root.

---

## 1. Run backend locally

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

---

## 2. Initialize DB

```bash
curl -s -X POST http://localhost:8000/admin/init | python3 -m json.tool
# expect: {"status": "initialized"}
```

---

## 3. Pull events (seeds demo data if ArcGIS is unreachable)

```bash
curl -s -X POST "http://localhost:8000/events/pull?days=7" | python3 -m json.tool
# expect: {"status": "ok", "source": "demo"|"arcgis", "inserted": 150}
```

---

## 4. Verify /events returns items

```bash
curl -s "http://localhost:8000/events?days=7" | python3 -m json.tool | head -40
# expect: {"items": [{"id": ..., "lat": ..., "lon": ..., "occurred_at": "...", "incident_type": "..."}, ...]}
```

Quick count check:

```bash
curl -s "http://localhost:8000/events?days=7" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d['items']), 'events')"
```

---

## 5. Run Expo with tunnel and confirm markers

```bash
cd mobile/vpsd-mobile
npx expo start --tunnel
```

- Scan QR in Expo Go
- Open **Hotspots** tab → tap **Refresh**
- Status line should read `Cells: N · Incidents: 150`
- Yellow pins appear on the map; tap any pin to see offense type + date in callout

**If markers are missing:**
- Confirm `API_BASE` in `src/config.ts` matches your backend URL (Render URL or `http://<your-ip>:8000`)
- Hit `POST /events/pull` first if the DB is fresh
