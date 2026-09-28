"""Controllers: stateless API; defaults and source downloads are read-only."""
import json
from pathlib import Path
from fastapi import APIRouter, HTTPException
from app.models import DecisionsInput, GameInput
from app import services

ROOT = Path(__file__).resolve().parents[1]
DATA = json.loads((ROOT / 'data' / 'initial.json').read_text(encoding='utf-8'))
router = APIRouter(prefix='/api')

@router.get('/health')
def health():
    return {'status':'ok'}

@router.get('/initial')
def initial():
    return {key: value for key, value in DATA.items() if key != 'sources'}

@router.post('/decisions')
def calculate_decisions(payload: DecisionsInput):
    return services.decisions(payload)

@router.post('/game')
def calculate_game(payload: GameInput):
    try:
        return services.game(payload)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
