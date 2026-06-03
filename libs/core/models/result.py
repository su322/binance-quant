"""Data models for backtest results."""
from dataclasses import dataclass
import pandas as pd


@dataclass
class BacktestResult:
    """Standard output from any backtest evaluation."""
    total_trades: int
    win_rate: float
    total_return: float
    sharpe_ratio: float
    max_drawdown: float
    equity_curve: pd.Series
    signals: pd.DataFrame
