"""Strategy abstraction for prediction models."""
from abc import ABC, abstractmethod
import pandas as pd


class Strategy(ABC):
    """Predictor that maps features to trading signals."""

    @abstractmethod
    def predict(self, features: pd.DataFrame) -> pd.Series:
        """Output signal series (-1 to 1)."""

    @abstractmethod
    def parameters(self) -> dict:
        """Return current strategy parameters (for display/serialization)."""
