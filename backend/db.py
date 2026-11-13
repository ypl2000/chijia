"""持家 chijia v2 · SQLite 数据层（冻结契约：pm/contract.md §3）。

表结构（契约 §3 逐字对齐）：
    kv(entity TEXT PRIMARY KEY, value TEXT, updated_at INTEGER, device_id TEXT, deleted INTEGER DEFAULT 0)
    snapshots(id INTEGER PRIMARY KEY AUTOINCREMENT, created_at INTEGER, label TEXT, payload TEXT)

约定：
    - value 列存「整实体文档」JSON 文本；墓碑行（deleted=1）保留删除前最后一份 value，不物理删行。
    - WAL 模式 + busy_timeout：多连接读写安全。本应用为单用户本地服务、写频低；
      跨请求的「读-判-写」原子性由 app.py 的进程内 _KV_WRITE_LOCK 保证（BUG-001/D24），
      本层不做应用层加锁；若未来改多 worker 部署需另议 BEGIN IMMEDIATE + BUSY 重试。
    - 迁移：PRAGMA user_version 记录 schema 版本；未来改表在 init_db 里按版本逐级迁移。
"""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path

# 五实体（契约 §3；整文档 LWW，不做字段级合并 —— 章程 D8）
ENTITIES = ("data", "txns", "plan", "settings", "pf_holdings")

SCHEMA_VERSION = 1

_SCHEMA = """
CREATE TABLE IF NOT EXISTS kv (
    entity     TEXT PRIMARY KEY,
    value      TEXT,
    updated_at INTEGER,
    device_id  TEXT,
    deleted    INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS snapshots (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at INTEGER,
    label      TEXT,
    payload    TEXT
);
"""


def connect(db_path: str | Path) -> sqlite3.Connection:
    """打开一个请求级短连接（WAL + 忙等超时），用完由调用方关闭。"""
    conn = sqlite3.connect(str(db_path), timeout=5.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=5000")
    return conn


def init_db(db_path: str | Path) -> None:
    """建库建表 + 迁移入口（幂等，每次启动调用）。"""
    db_path = Path(db_path)
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = connect(db_path)
    try:
        conn.executescript(_SCHEMA)
        version = conn.execute("PRAGMA user_version").fetchone()[0]
        if version < SCHEMA_VERSION:
            # 未来 schema 变更：在此按 version 逐级执行迁移语句，再更新 user_version。
            conn.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")
        conn.commit()
    finally:
        conn.close()


# ---------------------------------------------------------------- kv：实体表


def _row_to_record(row: sqlite3.Row) -> dict:
    return {
        "value": json.loads(row["value"]),
        "updatedAt": row["updated_at"],
        "deviceId": row["device_id"],
        "deleted": bool(row["deleted"]),
    }


def get_entity(conn: sqlite3.Connection, entity: str) -> dict | None:
    """取单实体当前记录（含墓碑）；不存在返回 None。"""
    row = conn.execute(
        "SELECT value, updated_at, device_id, deleted FROM kv WHERE entity = ?", (entity,)
    ).fetchone()
    return _row_to_record(row) if row is not None else None


def get_all_entities(conn: sqlite3.Connection) -> dict[str, dict]:
    """取全部实体当前记录（含墓碑），{entity: record}。"""
    rows = conn.execute("SELECT entity, value, updated_at, device_id, deleted FROM kv").fetchall()
    return {row["entity"]: _row_to_record(row) for row in rows}


def put_entity(
    conn: sqlite3.Connection,
    entity: str,
    value,
    updated_at: int,
    device_id: str,
    deleted: bool = False,
) -> None:
    """整实体 upsert（LWW 胜者落库；墓碑保留 value，不物理删行）。"""
    conn.execute(
        """
        INSERT INTO kv (entity, value, updated_at, device_id, deleted)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(entity) DO UPDATE SET
            value = excluded.value,
            updated_at = excluded.updated_at,
            device_id = excluded.device_id,
            deleted = excluded.deleted
        """,
        (
            entity,
            json.dumps(value, ensure_ascii=False),
            int(updated_at),
            device_id,
            1 if deleted else 0,
        ),
    )


# ---------------------------------------------------------------- snapshots：快照表


def create_snapshot(conn: sqlite3.Connection, created_at: int, label: str, payload: str) -> int:
    cur = conn.execute(
        "INSERT INTO snapshots (created_at, label, payload) VALUES (?, ?, ?)",
        (int(created_at), label, payload),
    )
    return int(cur.lastrowid)


def get_snapshot(conn: sqlite3.Connection, snapshot_id: int) -> dict | None:
    row = conn.execute(
        "SELECT id, created_at, label, payload FROM snapshots WHERE id = ?", (int(snapshot_id),)
    ).fetchone()
    if row is None:
        return None
    return {
        "id": row["id"],
        "createdAt": row["created_at"],
        "label": row["label"],
        "payload": row["payload"],
    }


def list_snapshots(conn: sqlite3.Connection) -> list[dict]:
    """快照列表（新 → 旧）；size = payload JSON 字符数。"""
    rows = conn.execute(
        "SELECT id, created_at, label, LENGTH(payload) AS size FROM snapshots ORDER BY id DESC"
    ).fetchall()
    return [
        {"id": row["id"], "createdAt": row["created_at"], "label": row["label"], "size": row["size"]}
        for row in rows
    ]
