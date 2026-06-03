"""Product abstraction for different trading product types."""
from abc import ABC, abstractmethod
import pandas as pd
from libs.core.models.result import BacktestResult


class Product(ABC):
    """A tradeable product/instrument type.

    Subclasses define how strategy signals map to P&L
    for that specific product (event contracts, futures, etc.).
    """
    symbol: str

    @abstractmethod
    def evaluate(
        self, klines: pd.DataFrame, signals: pd.Series,
    ) -> BacktestResult:
        """Evaluate signals on historical klines, return P&L results."""
