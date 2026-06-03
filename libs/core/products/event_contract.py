"""Event contract product — predict whether price moves X% in N minutes."""
from dataclasses import dataclass
from typing import Literal
import pandas as pd
import numpy as np
from libs.core.products.base import Product
from libs.core.models.result import BacktestResult


@dataclass
class EventContract(Product):
    symbol: str
    horizon: int
    direction: Literal["up", "down"]
    threshold_pct: float

    def _generate_labels(self, klines: pd.DataFrame) -> pd.Series:
        """Create labels: did price move threshold_pct in direction within horizon steps?"""
        future_high = klines["high"].shift(-self.horizon).rolling(self.horizon).max()
        future_low = klines["low"].shift(-self.horizon).rolling(self.horizon).min()
        entry = klines["close"]

        if self.direction == "up":
            return ((future_high - entry) / entry >= self.threshold_pct / 100).astype(float)
        else:
            return ((entry - future_low) / entry >= self.threshold_pct / 100).astype(float)

    def evaluate(
        self, klines: pd.DataFrame, signals: pd.Series,
    ) -> BacktestResult:
        labels = self._generate_labels(klines)
        # Align signals with labels
        common_idx = signals.index.intersection(labels.index)
        signals_aligned = signals.loc[common_idx]
        labels_aligned = labels.loc[common_idx]

        trades = signals_aligned[signals_aligned != 0]
        if len(trades) == 0:
            return BacktestResult(
                total_trades=0, win_rate=0.0, total_return=0.0,
                sharpe_ratio=0.0, max_drawdown=0.0,
                equity_curve=pd.Series(dtype="float64"),
                signals=pd.DataFrame(),
            )

        outcomes = labels_aligned.loc[trades.index] * np.sign(trades)
        wins = (outcomes > 0).sum()
        total = len(outcomes)
        win_rate = wins / total if total > 0 else 0.0

        equity = 100 + np.cumsum(outcomes.values)
        total_return = (equity[-1] - 100) / 100
        max_drawdown = float(np.min(equity - np.maximum.accumulate(equity))) / 100
        sharpe = (
            (outcomes.mean() / outcomes.std() * np.sqrt(252))
            if outcomes.std() > 0 else 0.0
        )

        return BacktestResult(
            total_trades=total, win_rate=win_rate,
            total_return=total_return, sharpe_ratio=sharpe,
            max_drawdown=max_drawdown,
            equity_curve=pd.Series(equity, index=trades.index, name="equity"),
            signals=pd.DataFrame({"signal": signals_aligned}),
        )
