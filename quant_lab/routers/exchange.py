"""Proxy Binance exchange info — server-side search, no cache."""
from fastapi import APIRouter, Query
import httpx
from binance.spot import Spot

router = APIRouter()
_spot_client = Spot()
FUTURES_REST = "https://fapi.binance.com"

EVENT_SYMBOLS = ["BTCUSDT", "ETHUSDT"]


@router.get("/exchange-info")
def exchange_info(
    q: str = Query("", description="Search symbols by keyword"),
    mode: str = Query("spot", description="spot / perpetual / event"),
    symbol: str = Query("", description="Get min notional for a specific symbol"),
):
    if symbol:
        # Return min notional for a specific symbol
        if mode == "perpetual":
            resp = httpx.get(f"{FUTURES_REST}/fapi/v1/exchangeInfo", timeout=10)
            resp.raise_for_status()
            data = resp.json()
            for s in data.get("symbols", []):
                if s["symbol"] == symbol and s["status"] == "TRADING":
                    for f in s["filters"]:
                        if f["filterType"] == "MIN_NOTIONAL":
                            return {"symbol": symbol, "min_notional": float(f["notional"])}
            return {"symbol": symbol, "min_notional": 5}
        # spot min notional
        return {"symbol": symbol, "min_notional": 5}

    if mode == "event":
        symbols = EVENT_SYMBOLS
    elif mode == "perpetual":
        resp = httpx.get(f"{FUTURES_REST}/fapi/v1/exchangeInfo", timeout=10)
        resp.raise_for_status()
        data = resp.json()
        symbols = [
            s["symbol"]
            for s in data.get("symbols", [])
            if s["status"] == "TRADING"
        ]
    else:
        data = _spot_client.exchange_info()
        symbols = [
            s["symbol"]
            for s in data.get("symbols", [])
            if s["status"] == "TRADING"
        ]
    symbols.sort()
    if q:
        q = q.upper()
        prefix = [s for s in symbols if s.startswith(q)]
        substr = [s for s in symbols if not s.startswith(q) and q in s]
        symbols = prefix + substr
    return symbols[:50]
