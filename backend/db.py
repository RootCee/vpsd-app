import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

# Render's filesystem is read-only except /tmp
DEFAULT_SQLITE = "sqlite:////tmp/vpsd.db"
LOCAL_SQLITE = "sqlite:///./vpsd.db"

DATABASE_URL = os.getenv("DATABASE_URL")

if not DATABASE_URL:
    if os.getenv("RENDER"):
        DATABASE_URL = DEFAULT_SQLITE
    else:
        DATABASE_URL = LOCAL_SQLITE

if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql+psycopg2://", 1)

connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
engine = create_engine(DATABASE_URL, connect_args=connect_args, pool_pre_ping=True)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()
