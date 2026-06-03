"""Data provider abstraction for kline data."""
from abc import ABC, abstractmethod
from datetime import datetime

import pandas as pd


class DataProvider(ABC):
    """Abstract interface for loading kline/candlestick data."""

    @abstractmethod
    def load_klines(
        self,
        symbol: str,
        interval: str,
        start: datetime,
        end: datetime,
    ) -> pd.DataFrame:
        """Load kline data. Return DataFrame with columns:
        timestamp, open, high, low, close, volume."""
