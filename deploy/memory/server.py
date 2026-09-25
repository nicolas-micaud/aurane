"""aurane-memory — la mémoire longue des Généraux d'Aurane (décision 0009, Nick 25.09.2026).

Instance dédiée au jeu (données de joueurs, séparée de la mémoire ninabot), sur la VM du monde, jamais exposée :
réseau Compose seulement, jeton Bearer. Postgres garde la copie de travail ; ici la mémoire longue par Colonie,
qui traverse les saisons. Contrat minimal (packages/general HttpMemoryStore) :
  PUT    /memory/{colony}   corps = MemoryRecord JSON      → 200 {"ok":true}
  GET    /memory/{colony}                                  → 200 record | 404
  DELETE /memory/{colony}                                  → 204 (LPD/RGPD : effacement)
  GET    /healthz                                          → 200 (sans jeton)
  GET    /admin/export                                     → tout, pour la sauvegarde (jeton)
La recherche sémantique (épisodes, saisons) viendra sur cette même base quand le besoin sera là.
"""
import hmac
import json
import os
import sqlite3
import time
from pathlib import Path

from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse, Response

TOKEN = os.environ.get("MEMORY_TOKEN", "")
if len(TOKEN) < 24:
    raise SystemExit("MEMORY_TOKEN absent ou trop court : refus de servir sans jeton")
DB = Path(os.environ.get("MEMORY_DB", "/data/memory.db"))
MAX_BYTES = 256 * 1024

app = FastAPI(docs_url=None, redoc_url=None)


def db() -> sqlite3.Connection:
    DB.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(DB)
    con.execute("PRAGMA journal_mode=WAL")
    con.execute("CREATE TABLE IF NOT EXISTS memory (colony_id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at REAL NOT NULL, erased_at REAL)")
    return con


def auth(authorization: str | None) -> None:
    if not authorization or not authorization.startswith("Bearer ") or not hmac.compare_digest(authorization[7:].strip(), TOKEN):
        raise HTTPException(status_code=401, detail="unauthorized")


@app.get("/healthz")
def healthz():
    with db() as con:
        n = con.execute("SELECT COUNT(*) FROM memory WHERE erased_at IS NULL").fetchone()[0]
    return {"ok": True, "colonies": n}


@app.get("/memory/{colony}")
def get_memory(colony: str, authorization: str | None = Header(default=None)):
    auth(authorization)
    with db() as con:
        row = con.execute("SELECT data FROM memory WHERE colony_id=? AND erased_at IS NULL", (colony,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="no memory")
    return Response(content=row[0], media_type="application/json")


@app.put("/memory/{colony}")
async def put_memory(colony: str, request: Request, authorization: str | None = Header(default=None)):
    auth(authorization)
    raw = await request.body()
    if len(raw) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="record too large")
    try:
        rec = json.loads(raw)
        assert isinstance(rec, dict) and isinstance(rec.get("notes", []), list)
    except Exception:  # noqa: BLE001
        raise HTTPException(status_code=400, detail="invalid record") from None
    with db() as con:
        con.execute("INSERT INTO memory (colony_id, data, updated_at, erased_at) VALUES (?, ?, ?, NULL) ON CONFLICT(colony_id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at, erased_at=NULL", (colony, json.dumps(rec, ensure_ascii=False), time.time()))
    return {"ok": True}


@app.delete("/memory/{colony}")
def delete_memory(colony: str, authorization: str | None = Header(default=None)):
    auth(authorization)
    with db() as con:
        con.execute("DELETE FROM memory WHERE colony_id=?", (colony,))
    return Response(status_code=204)


@app.get("/admin/export")
def export_all(authorization: str | None = Header(default=None)):
    auth(authorization)
    with db() as con:
        rows = con.execute("SELECT colony_id, data, updated_at FROM memory WHERE erased_at IS NULL").fetchall()
    return JSONResponse({r[0]: {"record": json.loads(r[1]), "updatedAt": r[2]} for r in rows})
