from fastapi import APIRouter, Request
from pydantic import BaseModel
from quant_lab.services.replay_service import ReplayService

router = APIRouter()


class StartReplayRequest(BaseModel):
    account_id: int
    symbol: str
    interval: str = "1m"
    data_range: dict = {}


def get_svc(request: Request) -> ReplayService:
    db = request.app.state.db_session()
    provider = request.app.state.provider
    return ReplayService(db, provider)


@router.post("/replay/start")
def start_replay(req: StartReplayRequest, request: Request):
    svc = get_svc(request)
    session = svc.start(req.account_id, req.symbol, req.interval, req.data_range)
    return {"session_id": session.id}


@router.post("/replay/{session_id}/step")
def replay_step(session_id: int, request: Request):
    svc = get_svc(request)
    return svc.step(session_id)


@router.post("/replay/{session_id}/seek")
def replay_seek(session_id: int, index: int, request: Request):
    svc = get_svc(request)
    svc.seek(session_id, index)
    return {"ok": True}


@router.post("/replay/{session_id}/pause")
def replay_pause(session_id: int, request: Request):
    svc = get_svc(request)
    svc.pause(session_id)
    return {"ok": True}


@router.post("/replay/{session_id}/resume")
def replay_resume(session_id: int, request: Request):
    svc = get_svc(request)
    svc.resume(session_id)
    return {"ok": True}


@router.get("/replay/{session_id}/state")
def replay_state(session_id: int, request: Request):
    svc = get_svc(request)
    return svc.state(session_id)
