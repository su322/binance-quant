"""Favorite trading pairs, persisted in SQLite."""
from fastapi import APIRouter, Request, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session
from quant_lab.database.models import Favorite

router = APIRouter()


def get_db(request: Request) -> Session:
    return request.app.state.db_session()


class AddFavoriteRequest(BaseModel):
    symbol: str
    mode: str = "spot"


@router.get("/symbol-favorites")
def list_favorites(
    request: Request,
    mode: str = Query("spot"),
):
    session = get_db(request)
    rows = (
        session.query(Favorite)
        .filter(Favorite.mode == mode)
        .order_by(Favorite.created_at)
        .all()
    )
    return [{"id": r.id, "symbol": r.symbol, "mode": r.mode} for r in rows]


@router.post("/favorites")
def add_favorite(req: AddFavoriteRequest, request: Request):
    session = get_db(request)
    q = session.query(Favorite).filter(
        Favorite.symbol == req.symbol.upper(),
        Favorite.mode == req.mode,
    )
    existing = q.first()
    if existing:
        return {"id": existing.id, "symbol": existing.symbol, "mode": existing.mode}
    fav = Favorite(symbol=req.symbol.upper(), mode=req.mode)
    session.add(fav)
    session.commit()
    return {"id": fav.id, "symbol": fav.symbol, "mode": fav.mode}


@router.delete("/favorites/{fav_id}")
def delete_favorite(fav_id: int, request: Request):
    session = get_db(request)
    session.query(Favorite).filter(Favorite.id == fav_id).delete()
    session.commit()
    return {"ok": True}
