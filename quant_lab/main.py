"""quant-lab FastAPI application."""
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import sessionmaker

from quant_lab.database.models import init_db, Favorite
from quant_lab.routers import klines, accounts, orders, backtest, replay, live, symbol_favorites, trades, exchange
from libs.exchanges.binance.data_provider import BinanceDataProvider


def _seed_default_favorites(session):
    for mode in ["spot", "perpetual"]:
        exists = session.query(Favorite).filter(Favorite.mode == mode).first()
        if not exists:
            session.add_all([
                Favorite(symbol="BTCUSDT", mode=mode),
                Favorite(symbol="ETHUSDT", mode=mode),
            ])
    session.commit()


@asynccontextmanager
async def lifespan(app: FastAPI):
    engine = init_db()
    app.state.db_session = sessionmaker(bind=engine)
    app.state.provider = BinanceDataProvider()
    with sessionmaker(bind=engine)() as session:
        _seed_default_favorites(session)
    yield
    engine.dispose()


app = FastAPI(title="quant-lab", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(klines.router, prefix="/api/v1")
app.include_router(accounts.router, prefix="/api/v1")
app.include_router(orders.router, prefix="/api/v1")
app.include_router(backtest.router, prefix="/api/v1")
app.include_router(replay.router, prefix="/api/v1")
app.include_router(exchange.router, prefix="/api/v1")
app.include_router(symbol_favorites.router, prefix="/api/v1")
app.include_router(trades.router, prefix="/api/v1")
app.include_router(live.router)
