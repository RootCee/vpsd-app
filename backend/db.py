import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

def _default_sqlite_url() -> str:
    # Render filesystem is writable in /tmp
    # If we detect Render, use /tmp; otherwise local file
    if os.getenv("RENDER") or os.path.exists("/opt/render"):
        return "sqlite:////tmp/vpsd.db"
    return "sqlite:///./vpsd.db"

DATABASE_URL = os.getenv("DATABASE_URL") or _default_sqlite_url()

# Render sometimes provides old postgres://
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql+psycopg2://", 1)

connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}

engine = create_engine(
    DATABASE_URL,
    connect_args=connect_args,
    pool_pre_ping=True,
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()
