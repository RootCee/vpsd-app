import pandas as pd
from io import StringIO

def parse_csv(content: bytes):
    df = pd.read_csv(StringIO(content.decode("utf-8")))
    df.columns = [c.strip().lower() for c in df.columns]

    date_col = next(c for c in df.columns if "date" in c or "time" in c)
    lat_col = next(c for c in df.columns if c in ["lat", "latitude"])
    lon_col = next(c for c in df.columns if c in ["lon", "lng", "longitude"])

    df["occurred_at"] = pd.to_datetime(df[date_col], errors="coerce")
    df["lat"] = pd.to_numeric(df[lat_col], errors="coerce")
    df["lon"] = pd.to_numeric(df[lon_col], errors="coerce")

    df = df.dropna(subset=["occurred_at", "lat", "lon"])
    return df
