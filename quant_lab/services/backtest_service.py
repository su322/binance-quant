from datetime import datetime
from sqlalchemy.orm import Session
from pydantic import BaseModel
from libs.core.data.provider import DataProvider
from libs.core.features.base import Feature
from libs.core.strategies.base import Strategy
from libs.core.products.base import Product
from libs.core.engines.backtest import BacktestEngine
from quant_lab.database.models import BacktestHistory


class BacktestRequest(BaseModel):
    symbol: str
    interval: str = "1m"
    start: datetime
    end: datetime
    features: list[str] = []
    strategy_params: dict = {}
    product_type: str = "event_contract"
    product_params: dict = {}


class BacktestService:
    def __init__(self, db: Session, provider: DataProvider):
        self._db = db
        self._provider = provider

    def run(self, req: BacktestRequest) -> dict:
        # Resolve features by name (stub -- expand later)
        feature_list: list[Feature] = []

        # Resolve product
        from libs.core.products.event_contract import EventContract
        product: Product = EventContract(
            symbol=req.symbol,
            horizon=req.product_params.get("horizon", 5),
            direction=req.product_params.get("direction", "up"),
            threshold_pct=req.product_params.get("threshold_pct", 1.0),
        )

        engine = BacktestEngine()
        result = engine.run(
            self._provider, feature_list, _dummy_strategy(),
            product, req.start, req.end, req.interval,
        )

        # Save to history
        history = BacktestHistory(
            symbol=req.symbol, interval=req.interval,
            product_type=req.product_type, strategy_name="dummy",
            params=req.strategy_params,
            result_summary={
                "total_trades": result.total_trades,
                "win_rate": result.win_rate,
                "total_return": result.total_return,
                "sharpe_ratio": result.sharpe_ratio,
                "max_drawdown": result.max_drawdown,
            },
        )
        self._db.add(history)
        self._db.commit()

        return {
            "result": {
                "total_trades": result.total_trades,
                "win_rate": result.win_rate,
                "total_return": result.total_return,
                "sharpe_ratio": result.sharpe_ratio,
                "max_drawdown": result.max_drawdown,
            },
            "signals": result.signals.to_dict() if not result.signals.empty else {},
            "equity_curve": result.equity_curve.to_dict() if not result.equity_curve.empty else {},
        }


def _dummy_strategy() -> Strategy:
    import pandas as pd
    import numpy as np
    class DummyStrat(Strategy):
        def predict(self, features):
            return pd.Series(np.zeros(len(features)), index=features.index)
        def parameters(self):
            return {"name": "dummy"}
    return DummyStrat()
