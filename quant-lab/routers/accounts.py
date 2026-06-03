import json
from datetime import datetime
from fastapi import APIRouter, Request
from pydantic import BaseModel
import httpx
from sqlalchemy.orm import Session
from quant_lab.database.models import Account, Trade
from quant_lab.services.account_service import AccountService

router = APIRouter()
BINANCE_PRICE_URL = "https://api.binance.com/api/v3/ticker/price"
FUTURES_PRICE_URL = "https://fapi.binance.com/fapi/v1/ticker/price"


class CreateAccountRequest(BaseModel):
    name: str
    balance: float = 10000.0


def get_svc(request: Request) -> AccountService:
    db = request.app.state.db_session()
    return AccountService(db)


def _fetch_current_prices(symbols: set[str]) -> dict[str, float]:
    """Batch-fetch current prices from Binance for the given symbols."""
    if not symbols:
        return {}
    try:
        with httpx.Client(timeout=5) as c:
            resp = c.get(BINANCE_PRICE_URL, params={"symbols": json.dumps(list(symbols))})
            if resp.status_code == 200:
                return {item["symbol"]: float(item["price"]) for item in resp.json()}
            # Fallback: fetch one by one
            prices = {}
            for sym in symbols:
                try:
                    r = c.get(BINANCE_PRICE_URL, params={"symbol": sym})
                    if r.status_code == 200:
                        prices[sym] = float(r.json()["price"])
                except Exception:
                    pass
            return prices
    except Exception:
        return {}


def _account_with_pnl(svc: AccountService, acc, prices: dict[str, float], mode: str | None = None) -> dict:
    positions_list = svc.get_positions(acc.id)
    if mode:
        positions_list = [p for p in positions_list if getattr(p, 'mode', 'spot') == mode]
    positions = []
    position_history = []
    total_position_value = 0.0
    for p in positions_list:
        price = prices.get(p.symbol, 0)
        pos_data = {
            "symbol": p.symbol, "quantity": p.quantity,
            "avg_entry": p.avg_entry_price, "current_price": price,
            "realized_pnl": p.realized_pnl or 0,
            "side": p.side or 'long',
        }
        if p.quantity > 0:
            positions.append(pos_data)
            total_position_value += price * p.quantity
        else:
            position_history.append(pos_data)
    net_value = acc.balance + total_position_value
    total_pnl = net_value - acc.initial_balance
    pnl_percent = (total_pnl / acc.initial_balance * 100) if acc.initial_balance > 0 else 0
    return {
        "id": acc.id, "name": acc.name, "balance": acc.balance,
        "is_active": acc.is_active, "default_leverage": acc.default_leverage,
        "net_value": round(net_value, 2),
        "total_pnl": round(total_pnl, 2),
        "pnl_percent": round(pnl_percent, 2),
        "positions": positions,
        "position_history": position_history,
    }


@router.post("/accounts")
def create_account(req: CreateAccountRequest, request: Request):
    svc = get_svc(request)
    acc = svc.create_account(req.name, req.balance)
    return {
        "id": acc.id, "name": acc.name, "balance": acc.balance,
        "is_active": acc.is_active, "default_leverage": acc.default_leverage,
        "net_value": round(acc.balance, 2),
        "total_pnl": 0, "pnl_percent": 0,
    }


@router.get("/accounts/active")
def get_active_account(request: Request, mode: str | None = None):
    svc = get_svc(request)
    acc = svc.get_active_account()
    if not acc:
        return {"error": "no active account"}
    all_symbols = {p.symbol for p in svc.get_positions(acc.id)}
    prices = _fetch_current_prices(all_symbols)
    return _account_with_pnl(svc, acc, prices, mode=mode)


@router.get("/accounts")
def list_accounts(request: Request):
    svc = get_svc(request)
    accounts = svc.list_accounts()
    # Collect all position symbols across accounts
    all_symbols = set()
    for a in accounts:
        for p in svc.get_positions(a.id):
            all_symbols.add(p.symbol)
    prices = _fetch_current_prices(all_symbols)
    return [_account_with_pnl(svc, a, prices) for a in accounts]


@router.get("/accounts/{account_id}")
def get_account(account_id: int, request: Request):
    svc = get_svc(request)
    acc = svc.get_account(account_id)
    if not acc:
        return {"error": "not found"}
    all_symbols = {p.symbol for p in svc.get_positions(account_id)}
    prices = _fetch_current_prices(all_symbols)
    return _account_with_pnl(svc, acc, prices)


@router.post("/accounts/{account_id}/activate")
def activate_account(account_id: int, request: Request):
    svc = get_svc(request)
    acc = svc.activate_account(account_id)
    if not acc:
        return {"error": "not found"}
    return {"ok": True}


class SetLeverageRequest(BaseModel):
    leverage: int


@router.post("/accounts/{account_id}/leverage")
def set_leverage(account_id: int, req: SetLeverageRequest, request: Request):
    db = request.app.state.db_session()
    acc = db.get(Account, account_id)
    if not acc:
        return {"error": "not found"}
    acc.default_leverage = max(1, min(150, req.leverage))
    db.commit()
    return {"ok": True, "default_leverage": acc.default_leverage}


@router.delete("/accounts/{account_id}")
def delete_account(account_id: int, request: Request):
    svc = get_svc(request)
    svc.delete_account(account_id)
    return {"ok": True}


@router.get("/accounts/{account_id}/balance-history")
def get_balance_history(account_id: int, request: Request):
    svc = get_svc(request)
    db = request.app.state.db_session()
    account = db.get(Account, account_id)
    if not account:
        return {"error": "not found"}

    trades = db.query(Trade).filter(
        Trade.account_id == account_id
    ).order_by(Trade.timestamp.asc()).all()

    balance = account.initial_balance
    points = [{"balance": round(balance, 2), "timestamp": account.created_at.isoformat()}]

    for t in trades:
        if t.side == "buy":
            balance -= t.fill_price * t.fill_qty
        else:
            balance += t.fill_price * t.fill_qty
        balance = round(balance, 2)
        points.append({"balance": balance, "timestamp": t.timestamp.isoformat()})

    # Add current balance as final point
    if not points or points[-1]["balance"] != round(account.balance, 2):
        points.append({"balance": round(account.balance, 2), "timestamp": datetime.utcnow().isoformat()})

    return {"points": points}
