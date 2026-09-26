"""Tests de l'instance mémoire : `python -m pytest deploy/memory` (fastapi, httpx, pytest)."""
import importlib
import json
import sqlite3
import sys
from pathlib import Path

import pytest

TOKEN = "t" * 32
H = {"authorization": f"Bearer {TOKEN}"}


@pytest.fixture()
def app(tmp_path, monkeypatch):
    monkeypatch.setenv("MEMORY_TOKEN", TOKEN)
    monkeypatch.setenv("MEMORY_DB", str(tmp_path / "memory.db"))
    sys.path.insert(0, str(Path(__file__).parent))
    sys.modules.pop("server", None)
    server = importlib.import_module("server")
    from fastapi.testclient import TestClient
    yield TestClient(server.app), server, tmp_path
    sys.modules.pop("server", None)


def rec(rev, *notes):
    return {"v": 1, "rev": rev, "recentPhrases": [], "seasons": [], "notes": [{"at": i, "kind": "counsel.taken", "text": t} for i, t in enumerate(notes)]}


def test_wal_fsync_schema_integrity(app):
    client, server, tmp = app
    con = sqlite3.connect(tmp / "memory.db")
    assert con.execute("PRAGMA journal_mode").fetchone()[0] == "wal"
    assert con.execute("PRAGMA user_version").fetchone()[0] == server.SCHEMA
    assert server.connect().execute("PRAGMA synchronous").fetchone()[0] == 2  # FULL
    assert server.connect().execute("PRAGMA busy_timeout").fetchone()[0] == 5000
    h = client.get("/healthz").json()
    assert h["ok"] and h["integrity"] == "ok"


def test_auth_required(app):
    client, _, _ = app
    assert client.get("/memory/k").status_code == 401
    assert client.get("/memory/k", headers={"authorization": "Bearer nope"}).status_code == 401


def test_revisions_refuse_a_late_write(app):
    client, _, _ = app
    assert client.put("/memory/account:A", headers=H, json=rec(10, "a", "b")).status_code == 200
    assert client.put("/memory/account:A", headers=H, json=rec(5, "a")).status_code == 409
    assert client.put("/memory/account:A", headers=H, json=rec(10, "a", "b")).status_code == 200  # idempotent retry
    assert [n["text"] for n in client.get("/memory/account:A", headers=H).json()["notes"]] == ["a", "b"]


def test_erasure_removes_data_and_blocks_resurrection(app):
    client, _, tmp = app
    client.put("/memory/k", headers=H, json=rec(10, "secret"))
    assert client.delete("/memory/k?rev=11", headers=H).status_code == 204
    assert client.get("/memory/k", headers=H).status_code == 404
    assert client.put("/memory/k", headers=H, json=rec(10, "secret")).status_code == 409
    assert client.put("/memory/k", headers=H, json=rec(11, "secret")).status_code == 409
    raw = sqlite3.connect(tmp / "memory.db").execute("SELECT data FROM memory WHERE colony_id='k'").fetchone()[0]
    assert "secret" not in raw
    assert client.get("/admin/index", headers=H).json() == {"k": {"rev": 11, "erased": True}}
    assert client.put("/memory/k", headers=H, json=rec(12, "new life")).status_code == 200  # the player plays on
    assert client.get("/admin/index", headers=H).json()["k"] == {"rev": 12, "erased": False}


def test_rejects_bad_records(app):
    client, _, _ = app
    assert client.put("/memory/k", headers=H, content=b"{not json").status_code == 400
    assert client.put("/memory/k", headers=H, json=[1]).status_code == 400
    assert client.put("/memory/k", headers=H, json={"notes": 3}).status_code == 400
    assert client.put("/memory/k", headers=H, json={"notes": [], "rev": -1}).status_code == 400
    assert client.put("/memory/k", headers=H, content=b"{" + b" " * 300_000 + b"}").status_code == 413
    assert client.put("/memory/" + "x" * 300, headers=H, json=rec(1)).status_code == 400


def test_backup_is_a_consistent_checked_copy(app):
    client, server, tmp = app
    for i in range(5):
        client.put(f"/memory/k{i}", headers=H, json=rec(1, f"n{i}"))
    r = client.post("/admin/backup", headers=H).json()
    assert r["ok"] and r["rows"] == 5 and r["integrity"] == "ok"
    copy = sqlite3.connect(tmp / "backups" / r["file"])
    assert copy.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    assert copy.execute("PRAGMA journal_mode").fetchone()[0] == "delete"
    assert json.loads(copy.execute("SELECT data FROM memory WHERE colony_id='k3'").fetchone()[0])["notes"][0]["text"] == "n3"
    assert client.get("/healthz").json()["lastBackupAt"] is not None
    names = iter(f"20990101T0000{i:02d}Z" for i in range(10))
    server.stamp = lambda: next(names)  # distinct names within the same second
    for _ in range(4):
        assert client.post("/admin/backup", headers=H).status_code == 200
    assert len(list((tmp / "backups").glob("memory-*.db"))) == server.BACKUP_KEEP


def test_migrates_a_v0_database(tmp_path, monkeypatch):
    db = tmp_path / "memory.db"
    con = sqlite3.connect(db)
    con.execute("CREATE TABLE memory (colony_id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at REAL NOT NULL, erased_at REAL)")
    con.execute("INSERT INTO memory VALUES ('C7b', '{\"notes\": []}', 1.0, NULL)")
    con.commit(); con.close()
    monkeypatch.setenv("MEMORY_TOKEN", TOKEN)
    monkeypatch.setenv("MEMORY_DB", str(db))
    sys.path.insert(0, str(Path(__file__).parent))
    sys.modules.pop("server", None)
    server = importlib.import_module("server")
    from fastapi.testclient import TestClient
    client = TestClient(server.app)
    assert client.get("/admin/index", headers=H).json() == {"C7b": {"rev": 0, "erased": False}}
    assert client.put("/memory/C7b", headers=H, json=rec(1, "x")).status_code == 200
    sys.modules.pop("server", None)


def test_corrupt_database_fails_health(tmp_path, monkeypatch):
    db = tmp_path / "memory.db"
    con = sqlite3.connect(db)
    con.execute("CREATE TABLE memory (colony_id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at REAL NOT NULL, erased_at REAL)")
    con.executemany("INSERT INTO memory VALUES (?, ?, 1.0, NULL)", [(f"k{i}", "x" * 2000) for i in range(200)])
    con.commit(); con.close()
    data = bytearray(db.read_bytes())
    for off in range(4096 * 3, 4096 * 3 + 600):
        data[off] = 0xFF
    db.write_bytes(bytes(data))
    monkeypatch.setenv("MEMORY_TOKEN", TOKEN)
    monkeypatch.setenv("MEMORY_DB", str(db))
    sys.path.insert(0, str(Path(__file__).parent))
    sys.modules.pop("server", None)
    server = importlib.import_module("server")  # stays up to say so
    from fastapi.testclient import TestClient
    r = TestClient(server.app).get("/healthz")
    assert r.status_code == 503 and r.json()["integrity"] != "ok"
    sys.modules.pop("server", None)
