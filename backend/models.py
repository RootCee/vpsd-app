from datetime import datetime
from sqlalchemy import Column, Integer, String, Float, DateTime, Boolean, Text, ForeignKey
from sqlalchemy.orm import relationship

from db import Base


class Incident(Base):
    __tablename__ = "incidents"

    id = Column(Integer, primary_key=True, index=True)
    source = Column(String(64), index=True, nullable=False, default="sdpd_demo")
    incident_type = Column(String(64), nullable=False, default="demo")
    occurred_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    lat = Column(Float, nullable=False)
    lon = Column(Float, nullable=False)


class HotspotCell(Base):
    __tablename__ = "hotspot_cells"

    id = Column(Integer, primary_key=True, index=True)
    grid_lat = Column(Float, nullable=False)
    grid_lon = Column(Float, nullable=False)
    recent_count = Column(Integer, nullable=False, default=0)
    baseline_count = Column(Integer, nullable=False, default=0)
    risk_score = Column(Integer, nullable=False, default=0)


class Client(Base):
    __tablename__ = "clients"

    id = Column(Integer, primary_key=True, index=True)
    display_name = Column(String(120), nullable=False)
    neighborhood = Column(String(120), nullable=True)
    notes = Column(Text, nullable=True)

    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    follow_up_at = Column(DateTime, nullable=True)

    need_housing = Column(Boolean, nullable=False, default=False)
    need_food = Column(Boolean, nullable=False, default=False)
    need_therapy = Column(Boolean, nullable=False, default=False)
    need_job = Column(Boolean, nullable=False, default=False)
    need_transport = Column(Boolean, nullable=False, default=False)

    home_lat = Column(Float, nullable=True)
    home_lon = Column(Float, nullable=True)

    contacts = relationship("ContactLog", back_populates="client", cascade="all, delete-orphan")


class ContactLog(Base):
    __tablename__ = "contact_logs"

    id = Column(Integer, primary_key=True, index=True)
    client_id = Column(Integer, ForeignKey("clients.id"), nullable=False, index=True)

    contacted_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    outcome = Column(String(32), nullable=False)  # reached|no_answer|referral|other
    note = Column(Text, nullable=True)

    client = relationship("Client", back_populates="contacts")
