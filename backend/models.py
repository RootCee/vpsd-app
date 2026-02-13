from datetime import datetime

from sqlalchemy import (
    Column,
    Integer,
    String,
    DateTime,
    Text,
    ForeignKey,
    Float,
    Boolean,
)
from sqlalchemy.orm import relationship

from db import Base


# ------------------------------------------------------------
# HOTSPOTS
# ------------------------------------------------------------

class Incident(Base):
    __tablename__ = "incidents"

    id = Column(Integer, primary_key=True)

    source = Column(String, nullable=False)
    incident_type = Column(String, nullable=True)
    occurred_at = Column(DateTime, nullable=False)

    lat = Column(Float, nullable=False)
    lon = Column(Float, nullable=False)


class HotspotCell(Base):
    __tablename__ = "hotspot_cells"

    id = Column(Integer, primary_key=True)

    grid_lat = Column(Float, nullable=False)
    grid_lon = Column(Float, nullable=False)

    recent_count = Column(Integer, default=0, nullable=False)
    baseline_count = Column(Integer, default=0, nullable=False)
    risk_score = Column(Integer, default=0, nullable=False)


# ------------------------------------------------------------
# TRIAGE
# ------------------------------------------------------------

class Client(Base):
    __tablename__ = "clients"

    id = Column(Integer, primary_key=True)

    display_name = Column(String, nullable=False)
    neighborhood = Column(String, nullable=True)
    notes = Column(Text, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    # follow-up scheduling
    follow_up_at = Column(DateTime, nullable=True)

    # needs checklist
    need_housing = Column(Boolean, default=False, nullable=False)
    need_food = Column(Boolean, default=False, nullable=False)
    need_therapy = Column(Boolean, default=False, nullable=False)
    need_job = Column(Boolean, default=False, nullable=False)
    need_transport = Column(Boolean, default=False, nullable=False)

    # NEW: client location (for hotspots context)
    home_lat = Column(Float, nullable=True)
    home_lon = Column(Float, nullable=True)

    contacts = relationship(
        "ContactLog",
        back_populates="client",
        cascade="all, delete-orphan"
    )


class ContactLog(Base):
    __tablename__ = "contact_logs"

    id = Column(Integer, primary_key=True)

    client_id = Column(Integer, ForeignKey("clients.id"), nullable=False)
    contacted_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    outcome = Column(String, nullable=False)  # reached | no_answer | referral | other
    note = Column(Text, nullable=True)

    client = relationship("Client", back_populates="contacts")
