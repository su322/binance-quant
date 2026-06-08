import json
from fastapi import APIRouter, Request
from pydantic import BaseModel
import httpx
from quant_lab.services.account_service import AccountService
from quant_lab.simulation.executor import SimulatedExecutor
from quant_lab.database.models import Order, OrderStatus

router = APIRouter()

BINANCE_PRICE_URL = "https://api.binance.com/api/v3/ticker/price"


class PlaceOrderRequest(BaseModel):
    account_id: int
    symbol: str
    side: str
    quantity: float
    price: float | None = None
    order_type: str = "market"
    duration: str | None = None
    take_profit: float | None = None
    stop_loss: float | None = None
    mode: str = "spot"
    leverage: float = 1


def get_account_svc(request: Request) -> AccountService:
    db = request.app.state.db_session()
    return AccountService(db)


def _fetch_prices(symbols: set[str]) -> dict[str, float]:
    """Batch-fetch current prices from Binance."""
    if not symbols:
        return {}
    try:
        with httpx.Client(timeout=2) as c:
            resp = c.get(BINANCE_PRICE_URL, params={"symbols": json.dumps(list(symbols))})
            if resp.status_code == 200:
                return {item["symbol"]: float(item["price"]) for item in resp.json()}
    except Exception:
        pass
    return {}


@router.get("/accounts/{account_id}/orders")
def list_orders(account_id: int, request: Request):
    db = request.app.state.db_session()
    svc = get_account_svc(request)
    executor = SimulatedExecutor(db)
    # Collect symbols from pending orders (limit + event)
    all_pending = db.query(Order).filter(
        Order.account_id == account_id,
        Order.status == OrderStatus.PENDING,
    ).all()
    pending_limit = [o for o in all_pending if o.type == "limit"]
    pending_event = [o for o in all_pending if o.type == "event"]
    symbols = {o.symbol for o in all_pending}
    if symbols:
        prices = _fetch_prices(symbols)
        # Fill pending limit orders
        for sym in {o.symbol for o in pending_limit}:
            if sym in prices:
                executor.fill_pending_orders(sym, prices[sym])
        # Settle pending event orders
        if pending_event:
            executor.settle_event_orders(account_id, prices)
    return svc.get_orders(account_id)


@router.get("/accounts/{account_id}/trades")
def list_trades(account_id: int, request: Request):
    svc = get_account_svc(request)
    return svc.get_trades(account_id)


@router.post("/accounts/{account_id}/orders")
def place_order(account_id: int, req: PlaceOrderRequest, request: Request):
    db = request.app.state.db_session()
    executor = SimulatedExecutor(db)
    order = executor.place_order(
        account_id=req.account_id, symbol=req.symbol,
        side=req.side, quantity=req.quantity, price=req.price,
        order_type=req.order_type, duration=req.duration,
        take_profit=req.take_profit, stop_loss=req.stop_loss,
        mode=req.mode, leverage=req.leverage,
    )
    return {"order_id": order.id, "status": order.status.value}


class ClosePositionRequest(BaseModel):
    account_id: int
    symbol: str
    quantity: float
    price: float
    mode: str = "perpetual"


@router.post("/accounts/{account_id}/close-position")
def close_position(account_id: int, req: ClosePositionRequest, request: Request):
    db = request.app.state.db_session()
    executor = SimulatedExecutor(db)
    order = executor.close_position(
        account_id=req.account_id, symbol=req.symbol,
        quantity=req.quantity, price=req.price, mode=req.mode,
    )
    return {"order_id": order.id, "status": order.status.value}


class UpdateTpSlRequest(BaseModel):
    account_id: int
    symbol: str
    mode: str = "perpetual"
    take_profit: float | None = None
    stop_loss: float | None = None


@router.post("/accounts/{account_id}/orders/{order_id}/cancel")
def cancel_order(account_id: int, order_id: int, request: Request):
    db = request.app.state.db_session()
    executor = SimulatedExecutor(db)
    executor.cancel_order(order_id)
    return {"ok": True}


@router.post("/accounts/{account_id}/positions/tp-sl")
def update_tp_sl(account_id: int, req: UpdateTpSlRequest, request: Request):
    db = request.app.state.db_session()
    executor = SimulatedExecutor(db)
    pos = executor.update_tp_sl(
        account_id=req.account_id, symbol=req.symbol,
        mode=req.mode, take_profit=req.take_profit,
        stop_loss=req.stop_loss,
    )
    return {"ok": True, "take_profit": pos.take_profit, "stop_loss": pos.stop_loss}
