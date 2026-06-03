import time
from datetime import datetime
from fastapi import APIRouter, Request, Query
import httpx
import pandas as pd
import pandas_ta as ta
import threading

router = APIRouter()
SPOT_REST = "https://api.binance.com"
FUTURES_REST = "https://fapi.binance.com"

# Permanent in-memory store for klines.
# Fetched once from Binance per (symbol, interval, mode).
# WebSocket pushes real-time updates via update_latest_kline().
# No TTL — data lives until symbol/interval/mode changes.
_kline_store = {}       # (symbol, interval, mode) -> pd.DataFrame
_kline_in_flight = {}   # same key -> threading.Event (dedup concurrent first-fetches)
_kline_lock = threading.Lock()


def _get_or_fetch_klines(symbol: str, interval: str, mode: str,
                         start: datetime, end: datetime) -> pd.DataFrame:
    """Return the permanent in-memory DataFrame, fetching from Binance on first access."""
    key = (symbol, interval, mode)

    with _kline_lock:
        if key in _kline_store:
            return _kline_store[key].copy()
        event = _kline_in_flight.get(key)
        if event is not None:
            _kline_lock.release()
            event.wait()
            _kline_lock.acquire()
            return _kline_store[key].copy()
        event = threading.Event()
        _kline_in_flight[key] = event

    try:
        if mode == "perpetual":
            df = _fetch_klines(FUTURES_REST, "/fapi/v1/klines", symbol, interval, start, end)
        else:
            df = _fetch_klines(SPOT_REST, "/api/v3/klines", symbol, interval, start, end)
        with _kline_lock:
            _kline_store[key] = df
        return df.copy()
    finally:
        with _kline_lock:
            _kline_in_flight.pop(key, None)
        event.set()


def update_latest_kline(symbol: str, interval: str, mode: str,
                        raw_kline: list) -> None:
    """Update/append the latest candle from a real-time kline tick (Binance REST format)."""
    key = (symbol, interval, mode)
    with _kline_lock:
        if key not in _kline_store:
            return
        df = _kline_store[key]
        kline_time = pd.to_datetime(raw_kline[0], unit="ms")

        if len(df) > 0 and df["timestamp"].iloc[-1] >= kline_time:
            # Same candle — update in place
            df.iloc[-1] = [kline_time, float(raw_kline[1]), float(raw_kline[2]),
                           float(raw_kline[3]), float(raw_kline[4]), float(raw_kline[5])]
        else:
            # New candle — append
            new_row = pd.DataFrame([[kline_time, float(raw_kline[1]), float(raw_kline[2]),
                                     float(raw_kline[3]), float(raw_kline[4]), float(raw_kline[5])]],
                                   columns=df.columns)
            _kline_store[key] = pd.concat([df, new_row], ignore_index=True)


def _fetch_klines(
    base_url: str, path: str, symbol: str, interval: str, start: datetime, end: datetime
) -> pd.DataFrame:
    all_rows = []
    start_ms = int(start.timestamp() * 1000)
    end_ms = int(end.timestamp() * 1000)

    with httpx.Client(timeout=10) as client:
        while start_ms < end_ms:
            resp = client.get(
                f"{base_url}{path}",
                params={
                    "symbol": symbol, "interval": interval, "limit": 1000,
                    "startTime": start_ms, "endTime": end_ms,
                },
            )
            resp.raise_for_status()
            klines = resp.json()
            if not klines:
                break
            all_rows.extend(klines)
            if len(klines) < 1000:
                break
            start_ms = klines[-1][6] + 1

    df = pd.DataFrame(all_rows, columns=[
        "timestamp", "open", "high", "low", "close", "volume",
        "close_time", "quote_asset_volume", "number_of_trades",
        "taker_buy_base_vol", "taker_buy_quote_vol", "ignore",
    ])
    df["timestamp"] = pd.to_datetime(df["timestamp"], unit="ms")
    df = df[["timestamp", "open", "high", "low", "close", "volume"]]
    for col in ["open", "high", "low", "close", "volume"]:
        df[col] = df[col].astype(float)
    return df


def _fetch_futures_klines(
    symbol: str, interval: str, start: datetime, end: datetime
) -> pd.DataFrame:
    return _fetch_klines(FUTURES_REST, "/fapi/v1/klines", symbol, interval, start, end)


def _fetch_spot_klines(
    symbol: str, interval: str, start: datetime, end: datetime
) -> pd.DataFrame:
    return _fetch_klines(SPOT_REST, "/api/v3/klines", symbol, interval, start, end)


@router.get("/klines")
def get_klines(
    symbol: str = Query(...),
    interval: str = Query("1m"),
    start: datetime = Query(...),
    end: datetime = Query(...),
    mode: str = Query("spot"),
    request: Request = None,
):
    if mode == "perpetual":
        df = _fetch_futures_klines(symbol, interval, start, end)
    else:
        provider = request.app.state.provider
        df = provider.load_klines(symbol, interval, start, end)
    data = df.to_dict(orient="records")
    for row in data:
        row["timestamp"] = int(row["timestamp"].timestamp())
    return {
        "symbol": symbol,
        "interval": interval,
        "data": data,
    }


@router.get("/indicators")
def get_indicators(
    symbol: str = Query(...),
    interval: str = Query("1m"),
    start: datetime = Query(...),
    end: datetime = Query(...),
    name: str = Query("rsi"),
    mode: str = Query("spot"),
):
    df = _get_or_fetch_klines(symbol, interval, mode, start, end)

    close = df["close"]

    if name == "rsi":
        rsi = ta.rsi(close, length=6)
        data = []
        if rsi is not None:
            for i in range(len(rsi)):
                v = rsi.iloc[i]
                if pd.isna(v): continue
                data.append({
                    "time": int(df.iloc[i]["timestamp"].timestamp()),
                    "value": round(float(v), 2),
                })
        return {"symbol": symbol, "name": "RSI", "params": {"length": 6}, "data": data}
    elif name == "macd":
        m = ta.macd(close)
        data = []
        if m is not None:
            for i in range(len(m)):
                if any(pd.isna(m.iloc[i, c]) for c in range(len(m.columns))): continue
                data.append({
                    "time": int(df.iloc[i]["timestamp"].timestamp()),
                    "macd": round(float(m.iloc[i, 0]), 4),
                    "signal": round(float(m.iloc[i, 2]), 4),
                    "histogram": round(float(m.iloc[i, 1]), 4),
                })
        return {"symbol": symbol, "name": "MACD", "params": {"fast": 12, "slow": 26, "signal": 9}, "data": data}
    elif name == "kdj":
        stoch = ta.stoch(df["high"], df["low"], close, k=9, d=3, smooth_k=3)
        data = []
        if stoch is not None:
            k_col = [c for c in stoch.columns if "STOCHk" in c][0]
            d_col = [c for c in stoch.columns if "STOCHd" in c][0]
            for i in range(len(stoch)):
                if any(pd.isna(stoch.iloc[i, c]) for c in range(len(stoch.columns))): continue
                k = float(stoch.iloc[i][k_col])
                d_val = float(stoch.iloc[i][d_col])
                data.append({
                    "time": int(df.iloc[i]["timestamp"].timestamp()),
                    "k": round(k, 2), "d": round(d_val, 2),
                    "j": round(3 * k - 2 * d_val, 2),
                })
        return {"symbol": symbol, "name": "KDJ", "params": {"k_period": 9, "d_period": 3, "smooth_k": 3}, "data": data}
    elif name == "bb":
        bb = ta.bbands(close)
        data = []
        if bb is not None:
            upper = [c for c in bb.columns if "BBU" in c][0]
            middle = [c for c in bb.columns if "BBM" in c][0]
            lower = [c for c in bb.columns if "BBL" in c][0]
            for i in range(len(bb)):
                if any(pd.isna(bb.iloc[i, c]) for c in range(len(bb.columns))): continue
                data.append({
                    "time": int(df.iloc[i]["timestamp"].timestamp()),
                    "upper": round(float(bb.iloc[i][upper]), 2),
                    "middle": round(float(bb.iloc[i][middle]), 2),
                    "lower": round(float(bb.iloc[i][lower]), 2),
                })
        return {"symbol": symbol, "name": "BB", "params": {"length": 20, "std": 2}, "data": data}
    return {"symbol": symbol, "name": name, "data": []}
