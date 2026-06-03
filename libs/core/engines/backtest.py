"""Batch backtest engine — computes everything in one pass."""
from datetime import datetime
import pandas as pd
from libs.core.data.provider import DataProvider
from libs.core.features.base import Feature
from libs.core.strategies.base import Strategy
from libs.core.products.base import Product
from libs.core.models.result import BacktestResult


class BacktestEngine:
    def run(
        self,
        data_provider: DataProvider,
        features: list[Feature],
        strategy: Strategy,
        product: Product,
        start: datetime,
        end: datetime,
        interval: str = "1m",
    ) -> BacktestResult:
        klines = data_provider.load_klines(
            product.symbol, interval, start, end,
        )
        # Compute all features
        feature_df = pd.DataFrame(index=klines.index)
        for f in features:
            feature_df[f.__class__.__name__] = f.compute(klines)
        # Run strategy
        signals = strategy.predict(feature_df)
        # Evaluate
        return product.evaluate(klines, signals)
