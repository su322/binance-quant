"""Feature abstraction for computing derived data from klines."""
from abc import ABC, abstractmethod
import pandas as pd


class Feature(ABC):
    """Single-column feature computed from kline data."""

    @abstractmethod
    def compute(self, klines: pd.DataFrame) -> pd.Series:
        """Compute a single feature column from kline data."""
