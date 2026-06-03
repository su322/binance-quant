"""Step-by-step replay engine — processes one kline at a time."""
from dataclasses import dataclass
import pandas as pd
from libs.core.features.base import Feature
from libs.core.strategies.base import Strategy


@dataclass
class ReplayState:
    current_index: int
    total_klines: int
    is_finished: bool


class ReplayEngine:
    def __init__(self):
        self._klines: pd.DataFrame | None = None
        self._features: list[Feature] | None = None
        self._strategy: Strategy | None = None
        self._index: int = 0
        self._feature_cache: pd.DataFrame | None = None

    def init(
        self, klines: pd.DataFrame,
        features: list[Feature], strategy: Strategy,
    ):
        self._klines = klines
        self._features = features
        self._strategy = strategy
        self._index = 0
        self._feature_cache = None

    def step(self) -> dict | None:
        """Advance one kline, return signal at current position."""
        if self._klines is None or self._index >= len(self._klines):
            return None

        current_kline = self._klines.iloc[: self._index + 1]

        # Compute features up to current position
        feature_dict = {}
        for f in self._features:
            feature_dict[f.__class__.__name__] = f.compute(current_kline)
        feature_df = pd.DataFrame(feature_dict, index=current_kline.index)

        # Get signal for current position
        all_signals = self._strategy.predict(feature_df)
        current_signal = all_signals.iloc[-1]

        result = {
            "kline": current_kline.iloc[-1].to_dict(),
            "signal": float(current_signal),
            "position": int(self._index),
        }
        self._index += 1
        return result

    def seek(self, index: int):
        """Jump to a specific position."""
        if self._klines is not None:
            self._index = min(max(0, index), len(self._klines) - 1)

    def state(self) -> ReplayState:
        total = len(self._klines) if self._klines is not None else 0
        return ReplayState(
            current_index=self._index,
            total_klines=total,
            is_finished=self._index >= total,
        )
