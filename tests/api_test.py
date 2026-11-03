#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""持家 chijia v2 · API 回归测试（纯 stdlib，一键可跑）。

用法：
    python tests/api_test.py [--port 8411]

行为：
    1. 自起后端  `python backend/app.py --port 8411`（默认 8411，避开 8410/8412）。
    2. 读取 backend/data/token.txt 作为鉴权 token（首启自动生成，不改动）。
    3. 逐项执行契约断言（pm/contract.md v1.0 + 章程裁决 D9~D30），打印 PASS/FAIL。
    4. 停止后端进程，删除测试产生的 backend/data/chijia.db*（token.txt / config.json 不动）。
    5. 全部 PASS 退出码 0；任一 FAIL 退出码 1；环境故障（起服失败/端口占用）退出码 2。

注意：
    - 仅用 urllib（任务书口径：Windows curl.exe 按 ANSI 代码页解析命令行，中文 body 需走
      UTF-8 文件；urllib 直接以 UTF-8 编码字节发送，不受影响）。
    - 测试时间戳以「服务端 serverTime - 1000 秒」为基准，确保全部测试写早于 restore 的
      「当前时刻」前向写（D11/D17 语义需要）；因此测试依赖启动时能删除历史 chijia.db*。
      若历史 db 被占用（如并行 dev 服务），脚本会告警并尽力继续（用例均已写成不依赖初始空库）。
"""

from __future__ import annotations

import argparse
import json
import socket
import subprocess
import sys
import tempfile
import threading
import time
import traceback
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DB_FILES = ("chijia.db", "chijia.db-wal", "chijia.db-shm")
FIVE_ENTITIES = ("data", "txns", "plan", "settings", "pf_holdings")
RESTORE_DEVICE_ID = "server-restore"
HEALTH_TIMEOUT_S = 30.0
REQ_TIMEOUT_S = 15.0

# ------------------------------------------------------------------------- 基础设施

_failures: list[str] = []
_error_bodies: list[tuple[str, int, object]] = []  # ERR-05 汇总用：所有预期错误响应
_case_no = 0


def _now_ms() -> int:
    return int(time.time() * 1000)


def http(method: str, port: int, path: str, token: str | None = None,
         body: object | None = None, raw: bytes | None = None) -> tuple[int, object]:
    """发请求，返回 (status, 解析后的 JSON 或原文文本)。HTTP 4xx/5xx 不抛异常。"""
    url = f"http://127.0.0.1:{port}{path}"
    data = raw if raw is not None else (
        json.dumps(body, ensure_ascii=False).encode("utf-8") if body is not None else None)
    headers = {"Accept": "application/json"}
    if token is not None:
        headers["X-Auth-Token"] = token
    if data is not None:
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=REQ_TIMEOUT_S) as resp:
            text = resp.read().decode("utf-8", errors="replace")
            ctype = resp.headers.get("Content-Type", "")
            status = resp.status
    except urllib.error.HTTPError as e:  # 4xx/5xx 走这里，body 照读
        status = e.code
        text = e.read().decode("utf-8", errors="replace")
        ctype = e.headers.get("Content-Type", "") if e.headers else ""
    if "application/json" in ctype:
        try:
            return status, json.loads(text)
        except json.JSONDecodeError:
            return status, text
    return status, text


def check(case_id: str, ok: bool, fail_detail: str = "") -> bool:
    """记录并打印单个断言结果。"""
    global _case_no
    _case_no += 1
    if ok:
        print(f"  [PASS] {case_id}")
    else:
        print(f"  [FAIL] {case_id}  {fail_detail}")
        _failures.append(f"{case_id}: {fail_detail}")
    return ok


def err_shape(obj: object) -> bool:
    """契约 §2：错误统一 {error:{code,message}}。"""
    return (isinstance(obj, dict) and isinstance(obj.get("error"), dict)
            and isinstance(obj["error"].get("code"), str) and obj["error"].get("code") != ""
            and isinstance(obj["error"].get("message"), str))


def rec_err(case_id: str, status: int, obj: object) -> None:
    _error_bodies.append((case_id, status, obj))


def sync_change(entity: str, value, updated_at: int, device_id: str,
                deleted: bool | None = None) -> dict:
    ch = {"entity": entity, "value": value, "updatedAt": updated_at, "deviceId": device_id}
    if deleted is not None:
        ch["deleted"] = deleted
    return ch


def get_state(port: int, token: str) -> dict:
    status, obj = http("GET", port, "/api/state", token=token)
    assert status == 200 and isinstance(obj, dict), f"GET /api/state 异常：{status} {obj}"
    return obj


def state_entity(port: int, token: str, entity: str):
    return get_state(port, token)["entities"].get(entity)


# ------------------------------------------------------------------------- 启动 / 清理

def port_busy(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.5)
        return s.connect_ex(("127.0.0.1", port)) == 0


def delete_db_files(label: str) -> list[str]:
    """删除 backend/data/chijia.db*（绝不触碰 token.txt / config.json），返回失败清单。"""
    failed = []
    for name in DB_FILES:
        p = PROJECT_ROOT / "backend" / "data" / name
        if not p.exists():
            continue
        for _ in range(6):  # Windows：等进程退出后句柄释放
            try:
                p.unlink()
                break
            except OSError:
                time.sleep(0.5)
        else:
            failed.append(name)
    if failed:
        print(f"  [WARN] {label}：未能删除 {failed}（可能被其他进程占用）")
    else:
        print(f"  [OK] {label}：backend/data/chijia.db* 已删除（token.txt / config.json 未动）")
    return failed


def boot_server(port: int) -> tuple[subprocess.Popen, object]:
    log = tempfile.TemporaryFile()  # UTF-8 后端日志；失败时回读
    proc = subprocess.Popen(
        [sys.executable, str(PROJECT_ROOT / "backend" / "app.py"), "--port", str(port)],
        cwd=str(PROJECT_ROOT), stdout=log, stderr=subprocess.STDOUT)
    deadline = time.monotonic() + HEALTH_TIMEOUT_S
    while time.monotonic() < deadline:
        if proc.poll() is not None:
            log.seek(0)
            tail = log.read().decode("utf-8", errors="replace")[-2000:]
            print(tail)
            raise RuntimeError(f"后端进程启动即退出（exit={proc.returncode}），日志见上方")
        try:
            status, obj = http("GET", port, "/api/health")
            if status == 200 and obj == {"ok": True}:
                return proc, log
        except OSError:
            pass
        time.sleep(0.25)
    proc.terminate()
    raise RuntimeError(f"{HEALTH_TIMEOUT_S:.0f}s 内 /api/health 未就绪")


# ------------------------------------------------------------------------- 用例组

def run_auth_cases(port: int, token: str) -> None:
    print("\n== A. 鉴权与错误模型 ==")
    status, obj = http("GET", port, "/api/health")
    ok = check("AUTH-01 health 豁免鉴权", status == 200 and obj == {"ok": True},
               f"期望 200 {{ok:true}}，实际 {status} {obj}")
    if not ok:
        raise RuntimeError("health 不可用，后续用例无意义")

    status, obj = http("GET", port, "/api/state")
    rec_err("AUTH-02", status, obj)
    check("AUTH-02 无 token 访问 state → 401", status == 401 and err_shape(obj),
          f"期望 401+error 形状，实际 {status} {obj}")

    status, obj = http("GET", port, "/api/state", token="f" * 32)
    rec_err("AUTH-03", status, obj)
    check("AUTH-03 错 token → 401", status == 401 and err_shape(obj),
          f"期望 401+error 形状，实际 {status} {obj}")

    status, obj = http("POST", port, "/api/sync",
                       body={"changes": [sync_change("settings", {"spend": 0}, 1, "dev")]})
    rec_err("AUTH-04", status, obj)
    check("AUTH-04 无 token POST sync → 401", status == 401 and err_shape(obj),
          f"期望 401+error 形状，实际 {status} {obj}")

    status, obj = http("GET", port, "/api/snapshots")
    rec_err("AUTH-05", status, obj)
    check("AUTH-05 无 token 快照列表 → 401", status == 401 and err_shape(obj),
          f"期望 401+error 形状，实际 {status} {obj}")


def run_state_and_error_cases(port: int, token: str) -> None:
    print("\n== A2. state 形状 / 错误模型 ==")
    status, obj = http("GET", port, "/api/state", token=token)
    entities = obj.get("entities", {}) if isinstance(obj, dict) else {}
    keys_ok = isinstance(entities, dict) and set(entities) == set(FIVE_ENTITIES)
    shape_ok = keys_ok
    for ent, rec in entities.items():
        if rec is None:  # D29：null 仅=从未写入
            continue
        if not (isinstance(rec, dict) and set(rec) == {"value", "updatedAt", "deviceId", "deleted"}
                and isinstance(rec["updatedAt"], int)
                and isinstance(rec["deviceId"], str)):
            shape_ok = False
        elif rec["deleted"] is False:
            pass  # 存活记录：{value,updatedAt,deviceId,deleted:false}
        elif rec["deleted"] is True:
            if rec["value"] is not None:  # D29：墓碑记录 value 必为 null
                shape_ok = False
        else:
            shape_ok = False
    st_ok = isinstance(obj, dict) and isinstance(obj.get("serverTime"), int)
    check("STATE-01 state 每实体元数据形状（D15/D29：null=从未写入，已删=墓碑记录）",
          status == 200 and shape_ok and st_ok,
          f"期望五实体键+存活记录|墓碑记录{{value:null,deleted:true}}|null+serverTime:int，"
          f"实际 {status} {json.dumps(obj, ensure_ascii=False)[:300]}")

    status, obj = http("GET", port, "/api/nonexistent", token=token)
    rec_err("ERR-01", status, obj)
    check("ERR-01 未知 API 路径 → 404 JSON", status == 404 and err_shape(obj),
          f"期望 404+error 形状，实际 {status} {obj}")

    status, obj = http("POST", port, "/api/sync", token=token, raw=b"not-json")
    rec_err("ERR-02", status, obj)
    check("ERR-02 非法 JSON body → 400", status == 400 and err_shape(obj),
          f"期望 400+error 形状，实际 {status} {obj}")

    status, obj = http("POST", port, "/api/sync", token=token, body={})
    rec_err("ERR-03", status, obj)
    check("ERR-03 缺 changes → 400", status == 400 and err_shape(obj),
          f"期望 400+error 形状，实际 {status} {obj}")

    bad_bodies = [
        ("缺 value", {"changes": [{"entity": "settings", "updatedAt": 1, "deviceId": "d"}]}),
        ("updatedAt 非数", {"changes": [sync_change("settings", {"x": 1}, "abc", "d")]}),
        ("deviceId 空串", {"changes": [sync_change("settings", {"x": 1}, 1, "")]}),
        ("deleted 非布尔", {"changes": [{**sync_change("settings", {"x": 1}, 1, "d"),
                                        "deleted": "yes"}]}),
    ]
    bad_ok = True
    for name, body in bad_bodies:
        status, obj = http("POST", port, "/api/sync", token=token, body=body)
        rec_err(f"ERR-04/{name}", status, obj)
        if not (status == 400 and err_shape(obj)):
            bad_ok = False
            print(f"      - {name}: 期望 400+error 形状，实际 {status} {obj}")
    check("ERR-04 变更字段校验（缺value/坏updatedAt/空deviceId/坏deleted）", bad_ok)

    status, obj = http("POST", port, "/api/sync", token=token,
                       body={"changes": [sync_change("nope", {"x": 1}, 1, "d")]})
    rec_err("ENT-01", status, obj)
    check("ENT-01 unknown entity → 400", status == 400 and err_shape(obj),
          f"期望 400+error 形状，实际 {status} {obj}")
    if isinstance(obj, dict) and obj.get("error", {}).get("code") == "unknown_entity":
        print("      note: error.code=unknown_entity（与后端文档一致）")

    status, obj = http("POST", port, "/api/snapshots/abc/restore", token=token)
    rec_err("ERR-06", status, obj)
    check("ERR-06 非法快照 id 路径 → 严格 404 + code=snapshot_not_found（D25）",
          status == 404 and err_shape(obj)
          and obj.get("error", {}).get("code") == "snapshot_not_found",
          f"期望 404+snapshot_not_found，实际 {status} {obj}")

    check("ERR-05 错误格式统一 {error:{code,message}}",
          all(err_shape(o) for _, _, o in _error_bodies),
          f"以下响应形状违规：{[(c, s) for c, s, o in _error_bodies if not err_shape(o)]}")


def run_lww_cases(port: int, token: str, t0: int) -> None:
    print("\n== B. LWW 同步协议 ==")
    v1, v2, v3 = {"spend": 1001}, {"spend": 999}, {"spend": 1002}

    status, obj = http("POST", port, "/api/sync", token=token,
                       body={"changes": [sync_change("settings", v1, t0 + 1000, "dev-qa-a")]})
    got = obj.get("changes", [{}])[0] if isinstance(obj, dict) and obj.get("changes") else {}
    check("LWW-01a 首写入库且回执权威记录（D12）",
          status == 200 and got.get("value") == v1 and got.get("updatedAt") == t0 + 1000
          and got.get("deviceId") == "dev-qa-a" and got.get("deleted") is False
          and got.get("entity") == "settings",
          f"实际 {status} {json.dumps(obj, ensure_ascii=False)[:300]}")

    status, obj = http("POST", port, "/api/sync", token=token,
                       body={"changes": [sync_change("settings", v2, t0 + 500, "dev-qa-b")]})
    got = obj.get("changes", [{}])[0] if isinstance(obj, dict) and obj.get("changes") else {}
    check("LWW-01b 旧时间戳被拒（回执仍为新记录）",
          status == 200 and got.get("value") == v1 and got.get("updatedAt") == t0 + 1000
          and got.get("deviceId") == "dev-qa-a",
          f"期望回执 v1@T+1000/dev-qa-a，实际 {json.dumps(obj, ensure_ascii=False)[:300]}")

    status, obj = http("POST", port, "/api/sync", token=token,
                       body={"changes": [sync_change("settings", v3, t0 + 2000, "dev-qa-b")]})
    got = obj.get("changes", [{}])[0] if isinstance(obj, dict) and obj.get("changes") else {}
    rec = state_entity(port, token, "settings")
    check("LWW-02 新时间戳胜出（回执与 state 一致）",
          status == 200 and got.get("value") == v3
          and isinstance(rec, dict) and rec.get("value") == v3
          and rec.get("updatedAt") == t0 + 2000 and rec.get("deviceId") == "dev-qa-b",
          f"sync 回执 {got}；state={json.dumps(rec, ensure_ascii=False)[:200]}")

    # 平局：updatedAt 相同 → deviceId 字典序大者胜
    status, obj = http("POST", port, "/api/sync", token=token,
                       body={"changes": [sync_change("plan", {"m": "B"}, t0 + 1500, "dev-qa-b")]})
    got = obj.get("changes", [{}])[0] if isinstance(obj, dict) else {}
    check("LWW-03a 平局基线写入 dev-qa-b",
          status == 200 and got.get("value") == {"m": "B"},
          f"实际 {status} {json.dumps(obj, ensure_ascii=False)[:200]}")

    status, obj = http("POST", port, "/api/sync", token=token,
                       body={"changes": [sync_change("plan", {"m": "A"}, t0 + 1500, "dev-qa-a")]})
    got = obj.get("changes", [{}])[0] if isinstance(obj, dict) else {}
    check("LWW-03b 平局 dev-qa-a < dev-qa-b → 不覆盖",
          status == 200 and got.get("value") == {"m": "B"} and got.get("deviceId") == "dev-qa-b",
          f"期望仍为 B/dev-qa-b，实际 {json.dumps(obj, ensure_ascii=False)[:200]}")

    status, obj = http("POST", port, "/api/sync", token=token,
                       body={"changes": [sync_change("plan", {"m": "C"}, t0 + 1500, "dev-qa-c")]})
    got = obj.get("changes", [{}])[0] if isinstance(obj, dict) else {}
    rec = state_entity(port, token, "plan")
    check("LWW-03c 平局 dev-qa-c > dev-qa-b → 覆盖",
          status == 200 and got.get("value") == {"m": "C"}
          and isinstance(rec, dict) and rec.get("value") == {"m": "C"}
          and rec.get("deviceId") == "dev-qa-c",
          f"期望 C/dev-qa-c，实际回执 {got}；state={json.dumps(rec, ensure_ascii=False)[:200]}")


def run_sync_receipt_cases(port: int, token: str, t0: int) -> None:
    print("\n== B2. sync 批量回执（D12）与批次校验 ==")
    status, obj = http("POST", port, "/api/sync", token=token, body={"changes": [
        sync_change("settings", {"spend": 7777}, t0 + 3000, "dev-qa-a"),   # 应生效
        sync_change("plan", {"m": "STALE"}, t0 + 100, "dev-qa-a"),         # 过期，应被拒
    ]})
    changes = obj.get("changes", []) if isinstance(obj, dict) else []
    by_ent = {c.get("entity"): c for c in changes if isinstance(c, dict)} if isinstance(changes, list) else {}
    s_rec, p_rec = by_ent.get("settings", {}), by_ent.get("plan", {})
    check("SYNC-01a 响应含请求中每个实体的回执",
          status == 200 and set(by_ent) == {"settings", "plan"},
          f"期望 changes 含 settings+plan，实际 {status} {json.dumps(obj, ensure_ascii=False)[:300]}")
    check("SYNC-01b 生效者回执为新值",
          s_rec.get("value") == {"spend": 7777} and s_rec.get("updatedAt") == t0 + 3000,
          f"实际 {s_rec}")
    check("SYNC-01c 过期者回执为服务端当前记录（非请求值）",
          p_rec.get("value") == {"m": "C"} and p_rec.get("deviceId") == "dev-qa-c"
          and p_rec.get("updatedAt") == t0 + 1500,
          f"期望 plan 仍为 C@T+1500/dev-qa-c，实际 {p_rec}")

    # 观测项：批内含未知实体 → 400 且合法变更不半提交
    # （基线在此刻现取：上面的 SYNC-01 请求本身也会写 settings，不能拿旧状态当基线）
    before = state_entity(port, token, "settings")
    status, obj = http("POST", port, "/api/sync", token=token, body={"changes": [
        sync_change("settings", {"spend": 6666}, t0 + 4000, "dev-qa-a"),
        sync_change("nope", {"x": 1}, t0 + 4000, "dev-qa-a"),
    ]})
    after = state_entity(port, token, "settings")
    check("SYNC-02 批含未知实体 → 400 且不半提交（D24 整批原子）",
          status == 400 and err_shape(obj) and after == before,
          f"期望 400 且 settings 保持 {json.dumps(before, ensure_ascii=False)[:120]}，"
          f"实际 {status}，settings={json.dumps(after, ensure_ascii=False)[:120]}")


def run_tombstone_cases(port: int, token: str, t0: int) -> None:
    print("\n== B3. 墓碑（D10/D15/D17） ==")
    status, obj = http("POST", port, "/api/sync", token=token, body={"changes": [
        sync_change("txns", {"rules": {}, "txns": []}, t0 + 2000, "dev-qa-a", deleted=True)]})
    got = obj.get("changes", [{}])[0] if isinstance(obj, dict) and obj.get("changes") else {}
    rec = state_entity(port, token, "txns")
    check("TOMB-01 顶层 deleted 墓碑：回执 deleted=true，state 为墓碑记录（D29）",
          status == 200 and got.get("deleted") is True
          and isinstance(rec, dict) and set(rec) == {"value", "updatedAt", "deviceId", "deleted"}
          and rec.get("value") is None and rec.get("deleted") is True
          and rec.get("updatedAt") == t0 + 2000 and rec.get("deviceId") == "dev-qa-a",
          f"回执={got}；state={json.dumps(rec, ensure_ascii=False)[:200]}")

    status, obj = http("POST", port, "/api/sync", token=token, body={"changes": [
        sync_change("pf_holdings", {"deleted": True, "note": "文档内字段不构成墓碑"},
                    t0 + 2000, "dev-qa-a")]})
    got = obj.get("changes", [{}])[0] if isinstance(obj, dict) and obj.get("changes") else {}
    rec = state_entity(port, token, "pf_holdings")
    check("TOMB-02 value 内 deleted 不误判（顶层无 deleted → 存活）",
          status == 200 and got.get("deleted") is False and isinstance(rec, dict)
          and rec.get("value") == {"deleted": True, "note": "文档内字段不构成墓碑"},
          f"回执={got}；state={json.dumps(rec, ensure_ascii=False)[:200]}")

    http("POST", port, "/api/sync", token=token, body={"changes": [
        sync_change("data", {"hero": "原数据"}, t0 + 3000, "dev-qa-a", deleted=True)]})
    status, obj = http("POST", port, "/api/sync", token=token, body={"changes": [
        sync_change("data", {"hero": "旧写入"}, t0 + 2500, "dev-qa-b")]})
    got = obj.get("changes", [{}])[0] if isinstance(obj, dict) and obj.get("changes") else {}
    rec = state_entity(port, token, "data")
    check("TOMB-03 墓碑后旧写被拒（state 保持墓碑记录，D29）",
          status == 200 and got.get("deleted") is True
          and isinstance(rec, dict) and set(rec) == {"value", "updatedAt", "deviceId", "deleted"}
          and rec.get("value") is None and rec.get("deleted") is True
          and rec.get("updatedAt") == t0 + 3000 and rec.get("deviceId") == "dev-qa-a",
          f"回执={got}；state={json.dumps(rec, ensure_ascii=False)[:200]}")

    status, obj = http("POST", port, "/api/sync", token=token, body={"changes": [
        sync_change("pf_holdings", {"items": ["after-tombstone"]}, t0 + 4000, "dev-qa-a")]})
    got = obj.get("changes", [{}])[0] if isinstance(obj, dict) and obj.get("changes") else {}
    rec = state_entity(port, token, "pf_holdings")
    check("TOMB-04 墓碑后新写胜出（前向写语义，D17 预期）",
          status == 200 and got.get("deleted") is False and isinstance(rec, dict)
          and rec.get("value") == {"items": ["after-tombstone"]},
          f"回执={got}；state={json.dumps(rec, ensure_ascii=False)[:200]}")

    # 客户端删除变体：本地墓碑同步时 value 已置 null（D23：墓碑 value 允许 null）
    status, obj = http("POST", port, "/api/sync", token=token, body={"changes": [
        sync_change("txns", None, t0 + 2500, "dev-qa-a", deleted=True)]})
    got = obj.get("changes", [{}])[0] if isinstance(obj, dict) and obj.get("changes") else {}
    rec = state_entity(port, token, "txns")
    check("TOMB-05 客户端删除变体 value:null+deleted:true：回执与 state 均墓碑记录（D23/D29）",
          status == 200 and got.get("deleted") is True and got.get("value") is None
          and got.get("updatedAt") == t0 + 2500 and got.get("deviceId") == "dev-qa-a"
          and isinstance(rec, dict) and set(rec) == {"value", "updatedAt", "deviceId", "deleted"}
          and rec.get("value") is None and rec.get("deleted") is True
          and rec.get("updatedAt") == t0 + 2500 and rec.get("deviceId") == "dev-qa-a",
          f"回执={got}；state={json.dumps(rec, ensure_ascii=False)[:200]}")


def run_snapshot_cases(port: int, token: str, t0: int) -> None:
    print("\n== C. 快照 / 严格还原（D11/D14/D17） ==")
    # 布置快照前状态：data/txns/settings/pf_holdings 存活，plan 墓碑（→ 快照中 absent）
    setup = [
        sync_change("data", {"hero": "data@snap"}, t0 + 5000, "dev-qa-a"),
        sync_change("txns", {"rules": {}, "txns": [{"id": "snap"}]}, t0 + 5000, "dev-qa-a"),
        sync_change("plan", {"m": "C"}, t0 + 5500, "dev-qa-a", deleted=True),  # 墓碑→absent
    ]
    status, obj = http("POST", port, "/api/sync", token=token, body={"changes": setup})
    if not check("SNAP-00 快照前状态布置", status == 200,
                 f"实际 {status} {json.dumps(obj, ensure_ascii=False)[:200]}"):
        return

    status, obj = http("POST", port, "/api/snapshots", token=token,
                       body={"label": "qa-strict-restore"})
    snap = obj if isinstance(obj, dict) else {}
    snap_id = snap.get("id")
    check("SNAP-01 创建快照 → {id,createdAt,label,size}",
          status == 200 and isinstance(snap_id, int) and snap.get("label") == "qa-strict-restore"
          and isinstance(snap.get("createdAt"), int)
          and isinstance(snap.get("size"), int) and snap["size"] > 0,
          f"实际 {status} {json.dumps(obj, ensure_ascii=False)[:300]}")

    status, obj = http("GET", port, "/api/snapshots", token=token)
    lst = obj if isinstance(obj, list) else []
    ids = [s.get("id") for s in lst if isinstance(s, dict)]
    fields_ok = all(isinstance(s, dict) and set(s) >= {"id", "createdAt", "label", "size"}
                    for s in lst)
    check("SNAP-02 快照列表：含新快照、字段齐、新→旧排序",
          status == 200 and fields_ok and snap_id in ids
          and (not ids or ids == sorted(ids, reverse=True)),
          f"期望含 id={snap_id} 且降序，实际 {status} {json.dumps(obj, ensure_ascii=False)[:300]}")

    # 快照后篡改：data 改值；plan 复活（快照中缺席 → restore 后应被墓碑）
    status, obj = http("POST", port, "/api/sync", token=token, body={"changes": [
        sync_change("data", {"hero": "data@after"}, t0 + 6100, "dev-qa-b"),
        sync_change("plan", {"m": "plan@after"}, t0 + 6100, "dev-qa-b"),
    ]})
    if not check("SNAP-03a 快照后篡改写入", status == 200,
                 f"实际 {status} {json.dumps(obj, ensure_ascii=False)[:200]}"):
        return

    restore_started = _now_ms()
    status, obj = http("POST", port, f"/api/snapshots/{snap_id}/restore", token=token)
    resp = obj if isinstance(obj, dict) else {}
    actions = {r.get("entity"): r.get("action")
               for r in resp.get("restored", []) if isinstance(r, dict)} if resp else {}
    check("SNAP-03b restore 200 且逐实体 action 正确（存活→restored，缺席→tombstoned）",
          status == 200 and resp.get("ok") is True and resp.get("snapshotId") == snap_id
          and actions == {"data": "restored", "txns": "restored", "plan": "tombstoned",
                          "settings": "restored", "pf_holdings": "restored"},
          f"期望五实体 action 映射，实际 {status} {json.dumps(obj, ensure_ascii=False)[:400]}")

    d_rec = state_entity(port, token, "data")
    t_rec = state_entity(port, token, "txns")
    p_rec = state_entity(port, token, "plan")
    ok = (isinstance(d_rec, dict) and d_rec.get("value") == {"hero": "data@snap"}
          and d_rec.get("deviceId") == RESTORE_DEVICE_ID
          and d_rec.get("updatedAt", 0) >= restore_started
          and isinstance(t_rec, dict) and t_rec.get("value") == {"rules": {}, "txns": [{"id": "snap"}]}
          and t_rec.get("deviceId") == RESTORE_DEVICE_ID
          and isinstance(p_rec, dict) and set(p_rec) == {"value", "updatedAt", "deviceId", "deleted"}
          and p_rec.get("value") is None and p_rec.get("deleted") is True
          and p_rec.get("deviceId") == RESTORE_DEVICE_ID
          and p_rec.get("updatedAt", 0) >= restore_started)
    check("SNAP-03c 严格还原：存活者回到快照内容(deviceId=server-restore,updatedAt≈restore 时刻)；"
          "快照后新建者(plan)前向写墓碑记录（D29：value:null,deleted:true）",
          ok, f"data={json.dumps(d_rec, ensure_ascii=False)[:200]}；"
              f"txns={json.dumps(t_rec, ensure_ascii=False)[:200]}；plan={p_rec}")

    # restore 后旧写被拒
    status, obj = http("POST", port, "/api/sync", token=token, body={"changes": [
        sync_change("data", {"hero": "data@stale"}, t0 + 5000, "dev-qa-stale")]})
    got = obj.get("changes", [{}])[0] if isinstance(obj, dict) and obj.get("changes") else {}
    d_rec2 = state_entity(port, token, "data")
    check("SNAP-05 restore 后旧时间戳写被拒（内容仍为 restore 结果）",
          status == 200 and got.get("value") == {"hero": "data@snap"}
          and isinstance(d_rec2, dict) and d_rec2.get("value") == {"hero": "data@snap"}
          and d_rec2.get("deviceId") == RESTORE_DEVICE_ID,
          f"回执={got}；state={json.dumps(d_rec2, ensure_ascii=False)[:200]}")

    # restore 可再撤销：更新时刻写 plan 胜过 restore 墓碑（D17 前向写语义）
    revive_ts = _now_ms() + 60_000
    status, obj = http("POST", port, "/api/sync", token=token, body={"changes": [
        sync_change("plan", {"m": "plan@revive"}, revive_ts, "dev-qa-a")]})
    got = obj.get("changes", [{}])[0] if isinstance(obj, dict) and obj.get("changes") else {}
    p_rec2 = state_entity(port, token, "plan")
    check("SNAP-06 restore 后新写胜过墓碑（前向写，可再撤销）",
          status == 200 and got.get("deleted") is False
          and isinstance(p_rec2, dict) and p_rec2.get("value") == {"m": "plan@revive"},
          f"回执={got}；state={json.dumps(p_rec2, ensure_ascii=False)[:200]}")

    status, obj = http("POST", port, "/api/snapshots/999999/restore", token=token)
    rec_err("SNAP-07", status, obj)
    code_ok = isinstance(obj, dict) and obj.get("error", {}).get("code") == "snapshot_not_found"
    check("SNAP-07 restore 不存在快照 → 404+error 形状",
          status == 404 and err_shape(obj),
          f"期望 404+error 形状，实际 {status} {obj}")
    if status == 404 and err_shape(obj) and not code_ok:
        print(f"      note: error.code={obj['error'].get('code')!r}（契约只冻结形状与 404）")


def run_misc_cases(port: int, token: str, t0: int) -> None:
    print("\n== D/G. AI 501 / 并发 / 静态托管 ==")
    status, obj = http("POST", port, "/api/ai/insight", token=token, body={"prompt": "hi"})
    rec_err("AI-01", status, obj)
    check("AI-01 ai/insight → 501+error 形状（默认 ai.enabled=false）",
          status == 501 and err_shape(obj), f"期望 501+error 形状，实际 {status} {obj}")

    results: list[tuple[int, object]] = []
    lock = threading.Lock()
    # 注意：restore 会把全部五实体以「当前时刻」前向写回（D11），此刻 settings 的
    # updatedAt ≈ 真实时钟；并发写必须以真实时钟为基准（t0+偏移早于 restore，必输）。
    conc_base = _now_ms() + 10_000

    def one(i: int) -> None:
        try:
            st, ob = http("POST", port, "/api/sync", token=token, body={"changes": [
                sync_change("settings", {"spend": 9000 + i}, conc_base + i,
                            f"dev-qa-conc-{i}")]})
            with lock:
                results.append((st, ob))
        except Exception as e:  # noqa: BLE001 —— 并发下任何异常都算失败样本
            with lock:
                results.append((-1, repr(e)))

    with ThreadPoolExecutor(max_workers=10) as pool:
        list(pool.map(one, range(10)))
    statuses = [st for st, _ in results]
    check("CONC-01a 并发 10 次 sync 全部 2xx（无 500）",
          len(results) == 10 and all(200 <= st < 300 for st in statuses),
          f"状态码={statuses}；样本={json.dumps(results[:2], ensure_ascii=False, default=str)[:300]}")
    rec = state_entity(port, token, "settings")
    check("CONC-01b 并发后终态 = updatedAt 最大者（LWW 确定性）",
          isinstance(rec, dict) and rec.get("value") == {"spend": 9009}
          and rec.get("updatedAt") == conc_base + 9 and rec.get("deviceId") == "dev-qa-conc-9",
          f"期望 spend=9009@conc_base+9/dev-qa-conc-9，实际 {json.dumps(rec, ensure_ascii=False)[:200]}")

    req = urllib.request.Request(f"http://127.0.0.1:{port}/")
    with urllib.request.urlopen(req, timeout=REQ_TIMEOUT_S) as resp:
        body_head = resp.read(200).decode("utf-8", errors="replace")
        ctype = resp.headers.get("Content-Type", "")
        st = resp.status
    check("STATIC-01 / 托管前端静态资源（200 text/html）",
          st == 200 and ctype.startswith("text/html") and "<html" in body_head.lower(),
          f"期望 200 text/html，实际 {st} {ctype} {body_head[:80]!r}")

    # D30：text/html 静态响应 Cache-Control: no-cache；ETag 条件请求 304 且 304 继承该头
    req = urllib.request.Request(f"http://127.0.0.1:{port}/")
    with urllib.request.urlopen(req, timeout=REQ_TIMEOUT_S) as resp:
        st1 = resp.status
        cc1 = resp.headers.get("Cache-Control", "")
        etag = resp.headers.get("ETag", "")
    check("CACHE-01a GET / 200 且 Cache-Control: no-cache（D30）",
          st1 == 200 and "no-cache" in cc1.lower(),
          f"实际 {st1} Cache-Control={cc1!r}")

    if etag:
        req2 = urllib.request.Request(f"http://127.0.0.1:{port}/",
                                      headers={"If-None-Match": etag})
        try:
            with urllib.request.urlopen(req2, timeout=REQ_TIMEOUT_S) as resp2:
                st2, cc2 = resp2.status, resp2.headers.get("Cache-Control", "")
        except urllib.error.HTTPError as e:  # urllib 把 304 当错误抛
            st2 = e.code
            cc2 = e.headers.get("Cache-Control", "") if e.headers else ""
        check("CACHE-01b If-None-Match 条件请求 → 304 且继承 no-cache（D30）",
              st2 == 304 and "no-cache" in cc2.lower(),
              f"实际 {st2} Cache-Control={cc2!r}（请求 ETag={etag[:40]}）")
    else:
        check("CACHE-01b If-None-Match 条件请求 → 304 且继承 no-cache（D30）", False,
              "200 响应未返回 ETag，无法构造条件请求（ETag 缺失本身即静态缓存口径问题）")


# ------------------------------------------------------------------------- 主流程

def main() -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:  # noqa: BLE001
        pass
    parser = argparse.ArgumentParser(description="持家 chijia v2 API 回归测试（纯 stdlib）")
    parser.add_argument("--port", type=int, default=8411, help="后端端口（默认 8411，避开 8410/8412）")
    args = parser.parse_args()
    port = args.port

    print("=" * 64)
    print(f"持家 chijia v2 · API 回归测试   端口 {port}   项目根 {PROJECT_ROOT}")
    print("=" * 64)

    token_path = PROJECT_ROOT / "backend" / "data" / "token.txt"
    if not token_path.exists():
        print(f"[INFRA] 缺少 {token_path}（应由后端首启自动生成）")
        return 2

    if port_busy(port):
        print(f"[INFRA] 端口 {port} 已被占用：拒绝在陌生实例上跑测试（会误删共享 db）。"
              f"请换 --port 或先停掉占用进程。")
        return 2

    db_dir = PROJECT_ROOT / "backend" / "data"
    existing = [n for n in DB_FILES if (db_dir / n).exists()]
    if existing:
        print(f"[BOOT] 发现历史 {existing}，先删除以保证断言确定性…")
        left = delete_db_files("预清理")
        if left:
            print("[WARN] 历史 db 未删净（可能 8410/8412 有并行服务在写）——用例已写成"
                  "不依赖初始空库，但如遇时间戳相关 FAIL 请先停并行服务再跑。")

    proc = None
    log = None
    try:
        proc, log = boot_server(port)
        print(f"[BOOT] 后端已就绪：http://127.0.0.1:{port}/")
        token = token_path.read_text(encoding="utf-8").strip()

        # 时间基准：serverTime - 1000s（保证全部测试写早于 restore 的「当前时刻」前向写）
        state0 = get_state(port, token)
        t0 = state0["serverTime"] - 1_000_000
        alive = [e for e, r in state0["entities"].items() if r is not None]
        if alive:
            print(f"[WARN] 库中已有历史数据（实体：{alive}）——用例不依赖初始空库，继续。")

        run_auth_cases(port, token)
        run_state_and_error_cases(port, token)
        run_lww_cases(port, token, t0)
        run_sync_receipt_cases(port, token, t0)
        run_tombstone_cases(port, token, t0)
        run_snapshot_cases(port, token, t0)
        run_misc_cases(port, token, t0)
    except Exception as e:  # noqa: BLE001 —— 环境故障
        print(f"\n[INFRA] 测试环境故障：{e}")
        if log is not None:
            log.seek(0)
            tail = log.read().decode("utf-8", errors="replace")[-2000:]
            if tail.strip():
                print("---- 后端日志尾部 ----")
                print(tail)
        traceback.print_exc()
        return 2
    finally:
        if proc is not None:
            proc.terminate()
            try:
                proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait(timeout=10)
            print("\n[CLEANUP] 后端进程已停止")
        if log is not None:
            log.close()
        delete_db_files("清理")

    total = _case_no
    failed = len(_failures)
    print("\n" + "=" * 64)
    print(f"汇总：{total} 项，PASS {total - failed} / FAIL {failed}")
    if _failures:
        print("失败项：")
        for f in _failures:
            print(f"  - {f}")
    print("=" * 64)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
