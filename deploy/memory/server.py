"""aurane-memory — la mémoire longue des Généraux d'Aurane (décision 0009, Nick 25.09.2026).

Instance dédiée au jeu (données de joueurs, séparée de la mémoire ninabot), sur la VM du monde, jamais exposée :
réseau Compose seulement, jeton Bearer. Postgres garde la copie de travail ; ici la mémoire longue par clé
(`account:<id>` ou `season:<graine>:<colonie>`), qui traverse les saisons. Contrat (packages/general HttpMemoryStore) :
  PUT    /memory/{key}   corps = MemoryRecord JSON     → 200 {"ok":true} | 409 révision plus ancienne que la nôtre
  GET    /memory/{key}                                 → 200 record | 404 (inconnu ou effacé)
  DELETE /memory/{key}?rev=N                           → 204 (LPD/RGPD : les données partent, une pierre tombale
                                                          vide garde la révision pour refuser un PUT en retard)
  GET    /healthz                                      → 200 | 503 si la base est corrompue (sans jeton)
  GET    /admin/index                                  → {clé: {rev, erased}} pour la réconciliation du monde
  GET    /admin/export                                 → tout, en JSON
  POST   /admin/backup                                 → copie cohérente (VACUUM INTO) vérifiée dans /data/backups
  GET    /admin/integrity                              → PRAGMA integrity_check complet
Fiabilité : WAL, synchronous=FULL (chaque commit est sur disque), busy_timeout, vérification d'intégrité au démarrage,
schéma versionné (PRAGMA user_version), écriture conditionnelle à la révision dans une transaction IMMEDIATE.
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
BACKUP_DIR = Path(os.environ.get("MEMORY_BACKUP_DIR", str(DB.parent / "backups")))
BACKUP_KEEP = int(os.environ.get("MEMORY_BACKUP_KEEP", "3"))
MAX_BYTES = 256 * 1024
MAX_KEY = 200
SCHEMA = 1

app = FastAPI(docs_url=None, redoc_url=None)
STATE: dict = {"integrity": "unchecked"}


def connect(path: Path = DB) -> sqlite3.Connection:
    con = sqlite3.connect(path, timeout=5.0, isolation_level=None)  # autocommit ; transactions explicites
    con.execute("PRAGMA busy_timeout=5000")
    con.execute("PRAGMA synchronous=FULL")
    return con


def migrate() -> None:
    DB.parent.mkdir(parents=True, exist_ok=True)
    con = connect()
    try:
        con.execute("PRAGMA journal_mode=WAL")  # persistant dans le fichier
        con.execute("CREATE TABLE IF NOT EXISTS memory (colony_id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at REAL NOT NULL, erased_at REAL)")
        con.execute("CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)")
        version = con.execute("PRAGMA user_version").fetchone()[0]
        if version < 1:
            cols = [r[1] for r in con.execute("PRAGMA table_info(memory)")]
            con.execute("BEGIN IMMEDIATE")
            if "rev" not in cols:
                con.execute("ALTER TABLE memory ADD COLUMN rev INTEGER NOT NULL DEFAULT 0")
            con.execute(f"PRAGMA user_version={SCHEMA}")
            con.execute("COMMIT")
        STATE["integrity"] = con.execute("PRAGMA quick_check").fetchone()[0]
        STATE["schema"] = con.execute("PRAGMA user_version").fetchone()[0]
    finally:
        con.close()
    if STATE["integrity"] != "ok":
        print(json.dumps({"msg": "memory db integrity check failed", "result": STATE["integrity"]}), flush=True)


try:
    migrate()
except sqlite3.DatabaseError as err:
    # Corrupt file: stay up so /healthz says so (503) and the operator can inspect; the world keeps Postgres and queues.
    STATE["integrity"] = f"error: {err}"
    print(json.dumps({"msg": "memory db unusable", "error": str(err)}), flush=True)


def auth(authorization: str | None) -> None:
    if not authorization or not authorization.startswith("Bearer ") or not hmac.compare_digest(authorization[7:].strip(), TOKEN):
        raise HTTPException(status_code=401, detail="unauthorized")


def check_key(key: str) -> None:
    if not key or len(key) > MAX_KEY:
        raise HTTPException(status_code=400, detail="invalid key")


def meta(con: sqlite3.Connection, k: str) -> str | None:
    row = con.execute("SELECT v FROM meta WHERE k=?", (k,)).fetchone()
    return row[0] if row else None


@app.get("/healthz")
def healthz():
    n, last = None, None
    try:
        con = connect()
        try:
            n = con.execute("SELECT COUNT(*) FROM memory WHERE erased_at IS NULL").fetchone()[0]
            last = meta(con, "last_backup_at")
        finally:
            con.close()
    except sqlite3.DatabaseError as err:
        STATE["integrity"] = f"error: {err}"
    body = {"ok": STATE["integrity"] == "ok", "colonies": n, "integrity": STATE["integrity"], "schema": STATE.get("schema"), "lastBackupAt": float(last) if last else None}
    return JSONResponse(body, status_code=200 if body["ok"] else 503)


@app.get("/memory/{key}")
def get_memory(key: str, authorization: str | None = Header(default=None)):
    auth(authorization)
    check_key(key)
    con = connect()
    try:
        row = con.execute("SELECT data FROM memory WHERE colony_id=? AND erased_at IS NULL", (key,)).fetchone()
    finally:
        con.close()
    if not row:
        raise HTTPException(status_code=404, detail="no memory")
    return Response(content=row[0], media_type="application/json")


def valid_record(rec: object) -> bool:
    if not isinstance(rec, dict):
        return False
    for field in ("notes", "recentPhrases", "seasons"):
        if not isinstance(rec.get(field, []), list):
            return False
    rev = rec.get("rev", 0)
    return isinstance(rev, (int, float)) and not isinstance(rev, bool) and rev >= 0


@app.put("/memory/{key}")
async def put_memory(key: str, request: Request, authorization: str | None = Header(default=None)):
    auth(authorization)
    check_key(key)
    raw = await request.body()
    if len(raw) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="record too large")
    try:
        rec = json.loads(raw)
    except Exception:  # noqa: BLE001
        raise HTTPException(status_code=400, detail="invalid record") from None
    if not valid_record(rec):
        raise HTTPException(status_code=400, detail="invalid record")
    rev = int(rec.get("rev", 0))
    con = connect()
    try:
        con.execute("BEGIN IMMEDIATE")
        row = con.execute("SELECT rev, erased_at FROM memory WHERE colony_id=?", (key,)).fetchone()
        # Plus ancien que ce que l'on a, ou pas plus récent qu'un effacement : refusé (le monde tient la version à jour).
        if row and (rev < row[0] or (row[1] is not None and rev <= row[0])):
            con.execute("ROLLBACK")
            return JSONResponse({"ok": False, "stale": True, "rev": row[0]}, status_code=409)
        con.execute(
            "INSERT INTO memory (colony_id, data, updated_at, erased_at, rev) VALUES (?, ?, ?, NULL, ?) "
            "ON CONFLICT(colony_id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at, erased_at=NULL, rev=excluded.rev",
            (key, json.dumps(rec, ensure_ascii=False), time.time(), rev),
        )
        con.execute("COMMIT")
    except Exception:
        if con.in_transaction:
            con.execute("ROLLBACK")
        raise
    finally:
        con.close()
    return {"ok": True}


@app.delete("/memory/{key}")
def delete_memory(key: str, rev: int = 0, authorization: str | None = Header(default=None)):
    auth(authorization)
    check_key(key)
    con = connect()
    try:
        con.execute("BEGIN IMMEDIATE")
        # Les données partent ; la pierre tombale ne garde que la clé et la révision.
        con.execute(
            "INSERT INTO memory (colony_id, data, updated_at, erased_at, rev) VALUES (?, '{}', ?, ?, ?) "
            "ON CONFLICT(colony_id) DO UPDATE SET data='{}', updated_at=excluded.updated_at, erased_at=excluded.erased_at, rev=MAX(memory.rev, excluded.rev)",
            (key, time.time(), time.time(), max(0, rev)),
        )
        con.execute("COMMIT")
    finally:
        con.close()
    return Response(status_code=204)


@app.get("/admin/index")
def index(authorization: str | None = Header(default=None)):
    auth(authorization)
    con = connect()
    try:
        rows = con.execute("SELECT colony_id, rev, erased_at FROM memory").fetchall()
    finally:
        con.close()
    return JSONResponse({r[0]: {"rev": r[1], "erased": r[2] is not None} for r in rows})


@app.get("/admin/export")
def export_all(authorization: str | None = Header(default=None)):
    auth(authorization)
    con = connect()
    try:
        rows = con.execute("SELECT colony_id, data, updated_at, rev FROM memory WHERE erased_at IS NULL").fetchall()
    finally:
        con.close()
    return JSONResponse({r[0]: {"record": json.loads(r[1]), "updatedAt": r[2], "rev": r[3]} for r in rows})


@app.get("/admin/integrity")
def integrity(authorization: str | None = Header(default=None)):
    auth(authorization)
    con = connect()
    try:
        result = [r[0] for r in con.execute("PRAGMA integrity_check").fetchall()]
    finally:
        con.close()
    STATE["integrity"] = "ok" if result == ["ok"] else "; ".join(result[:5])
    return {"ok": result == ["ok"], "result": result[:20]}


def stamp() -> str:
    return time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())


@app.post("/admin/backup")
def backup(authorization: str | None = Header(default=None)):
    """Copie cohérente de la base vivante (VACUUM INTO, jamais une copie du fichier en cours d'écriture), vérifiée."""
    auth(authorization)
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    out = BACKUP_DIR / f"memory-{stamp()}.db"
    tmp = out.with_suffix(".tmp")
    tmp.unlink(missing_ok=True)
    con = connect()
    try:
        con.execute("VACUUM INTO ?", (str(tmp),))
        live = con.execute("SELECT COUNT(*) FROM memory").fetchone()[0]
    finally:
        con.close()
    chk = sqlite3.connect(tmp)
    try:
        ok = chk.execute("PRAGMA integrity_check").fetchone()[0]
        rows = chk.execute("SELECT COUNT(*) FROM memory").fetchone()[0]
        chk.execute("PRAGMA journal_mode=DELETE")  # un seul fichier autonome
    finally:
        chk.close()
    if ok != "ok" or rows != live:
        tmp.unlink(missing_ok=True)
        raise HTTPException(status_code=500, detail=f"backup check failed: integrity={ok} rows={rows}/{live}")
    os.replace(tmp, out)
    for old in sorted(BACKUP_DIR.glob("memory-*.db"))[:-BACKUP_KEEP]:
        old.unlink(missing_ok=True)
    con = connect()
    try:
        con.execute("INSERT INTO meta (k, v) VALUES ('last_backup_at', ?) ON CONFLICT(k) DO UPDATE SET v=excluded.v", (str(time.time()),))
    finally:
        con.close()
    return {"ok": True, "file": out.name, "bytes": out.stat().st_size, "rows": rows, "integrity": ok}
