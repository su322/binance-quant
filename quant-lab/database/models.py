"""SQLAlchemy ORM models for quant-lab persistence."""
import os
from datetime import datetime
from sqlalchemy import (
    create_engine, Column, Integer, Float, String, DateTime, Boolean, ForeignKey,
    Text, JSON, Enum as SAEnum, NullPool,
)
from sqlalchemy.orm import DeclarativeBase, relationship
import enum


class Base(DeclarativeBase):
    pass


class OrderStatus(enum.Enum):
    PENDING = "pending"
    FILLED = "filled"
    CANCELED = "canceled"


class Account(Base):
    __tablename__ = "accounts"

    id = Column(Integer, primary_key=True)
    name = Column(String(128), nullable=False)
    balance = Column(Float, default=10000.0)
    initial_balance = Column(Float, default=10000.0)
    is_active = Column(Boolean, default=False)
    default_leverage = Column(Integer, default=3)
    created_at = Column(DateTime, default=datetime.utcnow)

    orders = relationship("Order", back_populates="account")
    positions = relationship("Position", back_populates="account")


class Order(Base):
    __tablename__ = "orders"

    id = Column(Integer, primary_key=True)
    account_id = Column(Integer, ForeignKey("accounts.id"), nullable=False)
    symbol = Column(String(32), nullable=False)
    side = Column(String(8), nullable=False)  # buy/sell
    type = Column(String(16), default="market")
    mode = Column(String(16), default="spot")  # spot / perpetual / event
    price = Column(Float, nullable=True)
    quantity = Column(Float, nullable=False)
    status = Column(SAEnum(OrderStatus), default=OrderStatus.PENDING)
    filled_qty = Column(Float, default=0.0)
    filled_price = Column(Float, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    duration = Column(String(8), nullable=True)  # event contract duration: 10m, 30m, 1h, 1d

    account = relationship("Account", back_populates="orders")


class Position(Base):
    __tablename__ = "positions"

    id = Column(Integer, primary_key=True)
    account_id = Column(Integer, ForeignKey("accounts.id"), nullable=False)
    symbol = Column(String(32), nullable=False)
    mode = Column(String(16), default="spot")  # spot / perpetual
    side = Column(String(8), default="long")  # long / short
    quantity = Column(Float, default=0.0)
    avg_entry_price = Column(Float, default=0.0)
    realized_pnl = Column(Float, default=0.0)
    used_margin = Column(Float, default=0.0)
    take_profit = Column(Float, nullable=True)
    stop_loss = Column(Float, nullable=True)

    account = relationship("Account", back_populates="positions")


class Trade(Base):
    __tablename__ = "trades"

    id = Column(Integer, primary_key=True)
    order_id = Column(Integer, nullable=False)
    account_id = Column(Integer, nullable=False)
    symbol = Column(String(32), nullable=False)
    side = Column(String(8), nullable=False)
    fill_price = Column(Float, nullable=False)
    fill_qty = Column(Float, nullable=False)
    timestamp = Column(DateTime, default=datetime.utcnow)
    fee = Column(Float, default=0.0)
    realized_pnl = Column(Float, default=0.0)


class ReplaySession(Base):
    __tablename__ = "replay_sessions"

    id = Column(Integer, primary_key=True)
    account_id = Column(Integer, nullable=False)
    symbol = Column(String(32), nullable=False)
    interval = Column(String(8), nullable=False)
    current_index = Column(Integer, default=0)
    speed = Column(Integer, default=1)
    status = Column(String(16), default="stopped")  # playing/paused/stopped
    created_at = Column(DateTime, default=datetime.utcnow)


class BacktestHistory(Base):
    __tablename__ = "backtest_history"

    id = Column(Integer, primary_key=True)
    name = Column(String(128), default="")
    symbol = Column(String(32), nullable=False)
    interval = Column(String(8), nullable=False)
    product_type = Column(String(32), nullable=False)
    strategy_name = Column(String(128), nullable=False)
    params = Column(JSON, default=dict)
    result_summary = Column(JSON, default=dict)
    created_at = Column(DateTime, default=datetime.utcnow)


class Favorite(Base):
    __tablename__ = "symbol_favorites"

    id = Column(Integer, primary_key=True)
    symbol = Column(String(32), nullable=False)
    mode = Column(String(16), nullable=False, default="spot")
    created_at = Column(DateTime, default=datetime.utcnow)


def init_db(db_path: str | None = None):
    """Create engine and all tables."""
    if db_path is None:
        db_path = os.path.join(os.path.dirname(__file__), "quantlab.db")
    engine = create_engine(f"sqlite:///{db_path}", poolclass=NullPool)
    Base.metadata.create_all(engine)
    # Dev migrations for new columns
    with engine.connect() as conn:
        from sqlalchemy import text
        for stmt in [
            "ALTER TABLE symbol_favorites ADD COLUMN mode VARCHAR(16) NOT NULL DEFAULT 'spot'",
            "ALTER TABLE accounts ADD COLUMN is_active BOOLEAN DEFAULT 0",
            "ALTER TABLE accounts ADD COLUMN initial_balance FLOAT DEFAULT 10000.0",
            "ALTER TABLE orders ADD COLUMN duration VARCHAR(8)",
            "ALTER TABLE positions ADD COLUMN realized_pnl FLOAT DEFAULT 0.0",
            "ALTER TABLE trades ADD COLUMN fee FLOAT DEFAULT 0.0",
            "ALTER TABLE trades ADD COLUMN realized_pnl FLOAT DEFAULT 0.0",
            "ALTER TABLE positions ADD COLUMN take_profit FLOAT",
            "ALTER TABLE positions ADD COLUMN stop_loss FLOAT",
            "ALTER TABLE positions ADD COLUMN mode VARCHAR(16) DEFAULT 'spot'",
            "ALTER TABLE orders ADD COLUMN mode VARCHAR(16) DEFAULT 'spot'",
            "ALTER TABLE positions ADD COLUMN side VARCHAR(8) DEFAULT 'long'",
            "ALTER TABLE positions ADD COLUMN used_margin FLOAT DEFAULT 0.0",
            "ALTER TABLE accounts ADD COLUMN default_leverage INTEGER DEFAULT 3",
        ]:
            try:
                conn.execute(text(stmt))
                conn.commit()
            except Exception:
                pass  # column already exists
    # Data migration: backfill used_margin for legacy perpetual positions
    # (opened before margin accounting — full cost was deducted from balance)
    with engine.connect() as conn:
        from sqlalchemy import text
        try:
            conn.execute(text(
                "UPDATE positions SET used_margin = quantity * avg_entry_price "
                "WHERE mode = 'perpetual' AND quantity > 0 "
                "AND (used_margin IS NULL OR used_margin = 0) AND avg_entry_price > 0"
            ))
            conn.commit()
        except Exception:
            pass
    return engine
