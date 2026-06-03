"""Technical indicator features using pandas-ta."""
import pandas as pd
import pandas_ta as ta
from libs.core.features.base import Feature


class SMA(Feature):
    """Simple Moving Average of close price."""

    def __init__(self, period: int = 20):
        self.period = period

    def compute(self, klines: pd.DataFrame) -> pd.Series:
        return ta.sma(klines["close"], length=self.period)


class RSI(Feature):
    """Relative Strength Index."""

    def __init__(self, period: int = 14):
        self.period = period

    def compute(self, klines: pd.DataFrame) -> pd.Series:
        return ta.rsi(klines["close"], length=self.period)


class VolumeProfile(Feature):
    """Ratio of current volume to SMA of volume."""

    def __init__(self, period: int = 20):
        self.period = period

    def compute(self, klines: pd.DataFrame) -> pd.Series:
        vol_sma = ta.sma(klines["volume"], length=self.period)
        return klines["volume"] / vol_sma
