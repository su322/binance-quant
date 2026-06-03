"""Trade history, persisted in SQLite."""
from fastapi import APIRouter, Request, Query
from sqlalchemy.orm import Session
from quant_lab.database.models import Trade

router = APIRouter()


def get_db(request: Request) -> Session:
    return request.app.state.db_session()


@router.get("/trades")
def list_trades(
    request: Request,
    account_id: int = Query(...),
    limit: int = Query(100),
):
    session = get_db(request)
    rows = (
        session.query(Trade)
        .filter(Trade.account_id == account_id)
        .order_by(Trade.timestamp.desc())
        .limit(limit)
        .all()
    )
    return [
        {
            "id": r.id,
            "order_id": r.order_id,
            "account_id": r.account_id,
            "symbol": r.symbol,
            "side": r.side,
            "fill_price": r.fill_price,
            "fill_qty": r.fill_qty,
            "timestamp": r.timestamp.isoformat(),
        }
        for r in rows
    ]
