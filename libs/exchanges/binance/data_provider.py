"""Binance exchange data provider."""
from datetime import datetime
import pandas as pd
from binance.spot import Spot as BinanceClient
from libs.core.data.provider import DataProvider


class BinanceDataProvider(DataProvider):
    """Fetch kline data from Binance spot API."""

    def __init__(self, api_key: str = "", api_secret: str = ""):
        self._client = BinanceClient(api_key=api_key, api_secret=api_secret)

    def load_klines(
        self,
        symbol: str,
        interval: str,
        start: datetime,
        end: datetime,
    ) -> pd.DataFrame:
        all_rows = []
        start_ms = int(start.timestamp() * 1000)
        end_ms = int(end.timestamp() * 1000)

        while start_ms < end_ms:
            klines = self._client.klines(
                symbol=symbol,
                interval=interval,
                startTime=start_ms,
                endTime=end_ms,
                limit=1000,
            )
            if not klines:
                break
            all_rows.extend(klines)
            if len(klines) < 1000:
                break
            # Advance to the next batch after the last candle's close_time
            start_ms = klines[-1][6] + 1

        df = pd.DataFrame(all_rows, columns=[
            "timestamp", "open", "high", "low", "close", "volume",
            "close_time", "quote_asset_volume", "number_of_trades",
            "taker_buy_base_vol", "taker_buy_quote_vol", "ignore",
        ])
        df["timestamp"] = pd.to_datetime(df["timestamp"], unit="ms")
        # Exclude the current in-progress candle — WebSocket provides live updates
        now = datetime.utcnow()
        df = df[pd.to_datetime(df["close_time"], unit="ms") <= now]
        df = df[["timestamp", "open", "high", "low", "close", "volume"]]
        for col in ["open", "high", "low", "close", "volume"]:
            df[col] = df[col].astype(float)
        return df


class FileDataProvider(DataProvider):
    """Load kline data from a CSV file (for testing/offline use)."""

    def __init__(self, path: str):
        self._path = path

    def load_klines(
        self, symbol: str, interval: str,
        start: datetime, end: datetime,
    ) -> pd.DataFrame:
        df = pd.read_csv(self._path, parse_dates=["timestamp"])
        df = df[(df["timestamp"] >= start) & (df["timestamp"] <= end)]
        return df
