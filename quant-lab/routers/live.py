"""Real-time WebSocket — polls Binance REST every 1s, no WS dependency."""
import asyncio
import json
import sys
from fastapi import APIRouter, WebSocket, Query
from starlette.websockets import WebSocketDisconnect
import httpx

from quant_lab.routers.klines import update_latest_kline
from quant_lab.simulation.executor import SimulatedExecutor

router = APIRouter()

SPOT_REST = "https://api.binance.com"
FUTURES_REST = "https://fapi.binance.com"


def _kline_to_msg(kline: list) -> dict:
    return {
        "type": "kline",
        "data": {
            "timestamp": kline[0] // 1000,
            "open": float(kline[1]),
            "high": float(kline[2]),
            "low": float(kline[3]),
            "close": float(kline[4]),
            "volume": float(kline[5]),
        },
    }


@router.websocket("/ws/klines")
async def ws_klines(
    websocket: WebSocket,
    symbol: str = Query("BTCUSDT"),
    interval: str = Query("1m"),
    mode: str = Query("spot"),
):
    await websocket.accept()
    rest_url = FUTURES_REST if mode == "perpetual" else SPOT_REST
    rest_path = "/fapi/v1/klines" if mode == "perpetual" else "/api/v3/klines"

    while True:
        try:
            async with httpx.AsyncClient(timeout=10) as hc:
                resp = await hc.get(
                    f"{rest_url}{rest_path}",
                    params={"symbol": symbol, "interval": interval, "limit": 1},
                )
                if resp.status_code == 200:
                    klines = resp.json()
                    if klines:
                        update_latest_kline(symbol, interval, mode, klines[0])
                        # Check pending limit orders against latest price
                        close_price = float(klines[0][4])
                        try:
                            db = websocket.app.state.db_session()
                            executor = SimulatedExecutor(db)
                            executor.fill_pending_orders(symbol, close_price)
                            executor.check_tp_sl(symbol, close_price)
                            db.close()
                        except Exception:
                            pass
                        msg = _kline_to_msg(klines[0])
                        await websocket.send_json(msg)
        except WebSocketDisconnect:
            break
        except RuntimeError:
            break
        except Exception:
            pass
        await asyncio.sleep(0.5)
