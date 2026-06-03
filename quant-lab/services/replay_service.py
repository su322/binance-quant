"""Replay service — stateless, stores engine state per session."""
import pandas as pd
from sqlalchemy.orm import Session
from libs.core.data.provider import DataProvider
from libs.core.features.base import Feature
from libs.core.strategies.base import Strategy
from libs.core.engines.replay import ReplayEngine
from quant_lab.database.models import ReplaySession

_engines: dict[int, ReplayEngine] = {}
_klines_cache: dict[int, pd.DataFrame] = {}


def _dummy_strategy() -> Strategy:
    import numpy as np
    import pandas as pd
    class S(Strategy):
        def predict(self, features):
            return pd.Series(np.zeros(len(features)), index=features.index)
        def parameters(self):
            return {"name": "dummy"}
    return S()


class ReplayService:
    def __init__(self, db: Session, provider: DataProvider):
        self._db = db
        self._provider = provider

    def start(self, account_id: int, symbol: str, interval: str,
              data_range: dict) -> ReplaySession:
        session = ReplaySession(
            account_id=account_id, symbol=symbol,
            interval=interval, current_index=0, status="playing",
        )
        self._db.add(session)
        self._db.commit()

        start = pd.to_datetime(data_range.get("start"))
        end = pd.to_datetime(data_range.get("end"))
        klines = self._provider.load_klines(symbol, interval, start, end)

        engine = ReplayEngine()
        engine.init(klines, [], _dummy_strategy())
        _engines[session.id] = engine
        _klines_cache[session.id] = klines
        return session

    def step(self, session_id: int) -> dict | None:
        engine = _engines.get(session_id)
        if engine is None:
            return None
        result = engine.step()
        if result:
            row = self._db.query(ReplaySession).get(session_id)
            if row:
                row.current_index = result["position"]
                self._db.commit()
        return result

    def seek(self, session_id: int, index: int):
        engine = _engines.get(session_id)
        if engine:
            engine.seek(index)
            row = self._db.query(ReplaySession).get(session_id)
            if row:
                row.current_index = index
                self._db.commit()

    def pause(self, session_id: int):
        row = self._db.query(ReplaySession).get(session_id)
        if row:
            row.status = "paused"
            self._db.commit()

    def resume(self, session_id: int):
        row = self._db.query(ReplaySession).get(session_id)
        if row:
            row.status = "playing"
            self._db.commit()

    def state(self, session_id: int) -> dict | None:
        engine = _engines.get(session_id)
        if engine is None:
            return None
        s = engine.state()
        row = self._db.query(ReplaySession).get(session_id)
        status = row.status if row else "stopped"
        return {
            "current_index": s.current_index,
            "total_klines": s.total_klines,
            "is_finished": s.is_finished,
            "status": status,
        }
