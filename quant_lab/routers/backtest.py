from fastapi import APIRouter, Request
from quant_lab.services.backtest_service import BacktestService, BacktestRequest

router = APIRouter()


@router.post("/backtest")
def run_backtest(req: BacktestRequest, request: Request):
    db = request.app.state.db_session()
    provider = request.app.state.provider
    svc = BacktestService(db, provider)
    return svc.run(req)


@router.get("/backtest/history")
def backtest_history(request: Request):
    db = request.app.state.db_session()
    from quant_lab.database.models import BacktestHistory
    return db.query(BacktestHistory).all()
