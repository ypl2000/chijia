"""持家 chijia v2 · 后端入口（冻结契约：pm/contract.md §1/§2）。

启动：python backend/app.py [--host 127.0.0.1] [--port 8410]

- SQLite（WAL）落 backend/data/chijia.db，表结构见 db.py（contract §3）。
- token 首启自动生成 backend/data/token.txt（32 位 hex），启动横幅打印；
  除 GET /api/health 外所有 /api/* 要求请求头 X-Auth-Token
  （静态前端资源同源放行：浏览器导航无法携带自定义 header）。
- 同步：整实体 LWW —— updatedAt 毫秒大者胜，平局 deviceId 字典序大者胜；
  删除为墓碑，线格式冻结为变更对象顶层 deleted 布尔字段（裁决②）。
  合并「读-判-写」由进程内 _KV_WRITE_LOCK 互斥（BUG-001 / D24）；
  单批整批校验、整批落库，任一变更非法整批 400 不半提交。
- 快照/回滚：严格还原（D11）—— 快照 payload 固定含全部五实体（存活者记 {value,updatedAt,deviceId}，
  缺席者记 {"absent":true}）；restore 时存活实体以「当前时刻」为新 updatedAt 前向写回
  （deviceId=server-restore），快照中缺席的实体前向写墓碑（deleted:true, updatedAt=当前时刻），
  确保「快照之后新建的实体」在回滚后消失。
- GET /api/state 每实体携带 {value,updatedAt,deviceId,deleted} 元数据（D15/D29）：
  存活 → deleted:false；已删 → 墓碑记录 {value:null,...,deleted:true}
  （BUG-003：客户端 pull 需墓碑时间戳做 LWW 比较，返回 null 会使对端删除永不生效）；
  null 仅表示从未写入。
- 静态托管：text/html 响应补 Cache-Control: no-cache（D30/BUG-006），JS/CSS 不动。
- 错误统一 {"error":{"code","message"}}；鉴权失败 401；未知实体 400。
- 截图识别（T7）：POST /api/portfolio/ocr 本地 RapidOCR 识别（backend/ocr.py，
  依赖缺失 501 ocr_not_installed）；POST /api/ai/vision 转发智谱视觉模型
  （config ai.vision.enabled 默认 false → 501 ai_disabled；开启转发 open.bigmodel.cn，
  上游错误以 502 ai_upstream 透传）。
"""

import argparse
import base64
import hmac
import json
import re
import secrets
import threading
import time
import traceback
import urllib.error
import urllib.request
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Body, FastAPI, File, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.responses import HTMLResponse, JSONResponse
from starlette.concurrency import run_in_threadpool
from starlette.datastructures import Headers
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.requests import Request
from starlette.responses import FileResponse
from starlette.staticfiles import NotModifiedResponse, StaticFiles

try:
    from backend import db  # 以项目根为包根导入（tests 直接 import 时）
    from backend import ocr
except ImportError:
    import db  # python backend/app.py 脚本直跑
    import ocr

# ---------------------------------------------------------------- 路径与运行时常量

BASE_DIR = Path(__file__).resolve().parent  # backend/
DATA_DIR = BASE_DIR / "data"  # 运行时数据目录（代码与数据分离，contract §1）
PROJECT_ROOT = BASE_DIR.parent
FRONTEND_DIR = PROJECT_ROOT / "frontend"
DB_PATH = DATA_DIR / "chijia.db"
TOKEN_PATH = DATA_DIR / "token.txt"
CONFIG_PATH = DATA_DIR / "config.json"

# 章程 D7：AI 默认关闭。T7 扩展 vision 段——已有 config.json（缺 vision 字段）不回写，
# 代码按此处默认值兜底（_vision_config）；仅「首次启动生成」时落完整 schema。
DEFAULT_CONFIG = {
    "ai": {
        "enabled": False,
        "vision": {"enabled": False, "apiKey": "", "model": "glm-4v-plus"},
    }
}
DEFAULT_VISION_MODEL = "glm-4v-plus"  # config 缺 ai.vision.model 时的兜底
GLM_CHAT_URL = "https://open.bigmodel.cn/api/paas/v4/chat/completions"
MAX_UPLOAD_BYTES = 20 * 1024 * 1024  # 上传图片上限（截图远小于此，防误传大文件）
RESTORE_DEVICE_ID = "server-restore"  # restore 前向写入使用的 deviceId
TOKEN_RE = re.compile(r"[0-9a-fA-F]{32}")

# BUG-001（契约 D24）：LWW 的「读 current → 比较 → 写」必须原子。SQLite 只串行化写本身，
# 不串行化读-判-写整个过程（SELECT 不进写事务），并发 sync 会丢失较新写入。
# 本服务为单进程 uvicorn（sync 端点跑在线程池），进程内互斥锁即完整覆盖全部请求路径；
# 锁同时保护快照创建/restore 的读改写，保证任意交错下终态 = 最大 updatedAt（D24）。
# 若未来改多 worker 部署，此锁不再充分，需换 BEGIN IMMEDIATE + BUSY 重试（记入 P1 文档）。
_KV_WRITE_LOCK = threading.Lock()

HOST = "127.0.0.1"
PORT = 8410  # main() 解析命令行后覆盖


def now_ms() -> int:
    return int(time.time() * 1000)


# ---------------------------------------------------------------- 启动初始化（token / config / db）


def _load_or_create_token() -> str:
    """token 首启自动生成（32 位 hex），已存在且合法则复用。"""
    TOKEN_PATH.parent.mkdir(parents=True, exist_ok=True)
    if TOKEN_PATH.exists():
        existing = TOKEN_PATH.read_text(encoding="utf-8").strip()
        if TOKEN_RE.fullmatch(existing):
            return existing.lower()
    token = secrets.token_hex(16)
    TOKEN_PATH.write_text(token, encoding="utf-8")
    return token


def _load_or_create_config() -> None:
    """config.json 缺失时写入默认（章程 D7：AI 全关，T7 起含 vision 段）。
    已存在的 config.json 一律不回写（T7 纪律：用户磁盘配置零改动），
    新字段（ai.vision.*）由 _vision_config 在读取时按默认值兜底。"""
    if not CONFIG_PATH.exists():
        CONFIG_PATH.write_text(
            json.dumps(DEFAULT_CONFIG, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )


def _load_config() -> dict:
    """每次请求现读 config.json，用户改完即生效；损坏时按空配置处理。"""
    try:
        cfg = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {}
    return cfg if isinstance(cfg, dict) else {}


def _ai_enabled() -> bool:
    ai = _load_config().get("ai")
    return isinstance(ai, dict) and ai.get("enabled") is True


def _vision_config() -> dict | None:
    """读取 ai.vision 配置（现读现判，改完即生效）。缺失字段按默认兜底，
    不回写用户磁盘上的 config.json（T7 纪律）。未启用或缺 apiKey → None（端点 501 ai_disabled）。"""
    ai = _load_config().get("ai")
    vision = ai.get("vision") if isinstance(ai, dict) else None
    if not isinstance(vision, dict) or vision.get("enabled") is not True:
        return None
    api_key = vision.get("apiKey")
    if not isinstance(api_key, str) or not api_key.strip():
        return None
    model = vision.get("model")
    return {
        "apiKey": api_key.strip(),
        "model": model if isinstance(model, str) and model.strip() else DEFAULT_VISION_MODEL,
    }


DATA_DIR.mkdir(parents=True, exist_ok=True)
db.init_db(DB_PATH)
AUTH_TOKEN = _load_or_create_token()
_load_or_create_config()


# ---------------------------------------------------------------- 错误模型（contract §2：{error:{code,message}}）


class ApiError(Exception):
    def __init__(self, status_code: int, code: str, message: str):
        self.status_code = status_code
        self.code = code
        self.message = message


def _error_payload(code: str, message: str) -> dict:
    return {"error": {"code": code, "message": message}}


# ---------------------------------------------------------------- 应用与中间件


@asynccontextmanager
async def lifespan(_app: FastAPI):
    frontend_state = "已托管" if FRONTEND_DIR.is_dir() else "未找到（/ 返回占位页）"
    print("=" * 60, flush=True)
    print("  持家 chijia v2 后端已启动", flush=True)
    print(f"  访问地址 : http://{HOST}:{PORT}/", flush=True)
    print(f"  Token    : {AUTH_TOKEN}   （请求头 X-Auth-Token）", flush=True)
    print(f"  数据目录 : {DATA_DIR}", flush=True)
    print(f"  前端目录 : {FRONTEND_DIR}（{frontend_state}）", flush=True)
    print("=" * 60, flush=True)
    yield


app = FastAPI(
    title="chijia v2 backend",
    lifespan=lifespan,
    docs_url=None,
    redoc_url=None,
    openapi_url=None,  # 本地单用户服务，不暴露 API 文档面
)


@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    """X-Auth-Token 鉴权：仅 GET /api/health 豁免；静态前端资源（非 /api/*）同源放行。"""
    path = request.url.path
    is_api = path == "/api" or path.startswith("/api/")
    exempt = path == "/api/health" and request.method == "GET"
    if is_api and not exempt:
        provided = request.headers.get("X-Auth-Token", "")
        ok = bool(provided) and hmac.compare_digest(
            provided.encode("utf-8"), AUTH_TOKEN.encode("utf-8")
        )
        if not ok:
            return JSONResponse(
                status_code=401,
                content=_error_payload(
                    "unauthorized",
                    "缺少或错误的 X-Auth-Token（token 见启动横幅 / backend/data/token.txt）",
                ),
            )
    response = await call_next(request)
    if is_api:
        response.headers["Cache-Control"] = "no-store"
    return response


@app.exception_handler(ApiError)
async def api_error_handler(_request: Request, exc: ApiError):
    return JSONResponse(status_code=exc.status_code, content=_error_payload(exc.code, exc.message))


@app.exception_handler(StarletteHTTPException)
async def http_error_handler(_request: Request, exc: StarletteHTTPException):
    # FastAPI 解析 body 失败（含非法 JSON / 非 UTF-8 字节）会抛 400 HTTPException，归入 validation_error
    codes = {
        400: "validation_error",
        401: "unauthorized",
        403: "forbidden",
        404: "not_found",
        405: "method_not_allowed",
    }
    return JSONResponse(
        status_code=exc.status_code,
        content=_error_payload(codes.get(exc.status_code, "http_error"), str(exc.detail)),
    )


@app.exception_handler(RequestValidationError)
async def validation_error_handler(_request: Request, exc: RequestValidationError):
    return JSONResponse(
        status_code=400,
        content=_error_payload("validation_error", "请求体格式不合法（须为 JSON 对象）"),
    )


# ---------------------------------------------------------------- API（contract §2）


@app.get("/api/health")
async def health():
    return {"ok": True}


@app.get("/api/state")
def get_state():
    """全量当前状态（D15/D29）：每实体携带 {value,updatedAt,deviceId,deleted} 元数据——
    存活 → deleted:false；已删 → 墓碑记录 {value:null, updatedAt, deviceId, deleted:true}；
    null 仅表示从未写入。"""
    conn = db.connect(DB_PATH)
    try:
        rows = db.get_all_entities(conn)
    finally:
        conn.close()
    entities = {}
    for entity in db.ENTITIES:
        rec = rows.get(entity)
        if rec is None:  # 从未写入
            entities[entity] = None
        elif rec["deleted"]:  # 墓碑：value 置 null，保留 updatedAt/deviceId 供客户端 LWW 比较（D29）
            entities[entity] = {
                "value": None,
                "updatedAt": rec["updatedAt"],
                "deviceId": rec["deviceId"],
                "deleted": True,
            }
        else:
            entities[entity] = {
                "value": rec["value"],
                "updatedAt": rec["updatedAt"],
                "deviceId": rec["deviceId"],
                "deleted": False,
            }
    return {"entities": entities, "serverTime": now_ms()}


def _validate_change(change, index: int) -> dict:
    """校验单条 sync 变更并归一化（先整体校验后落库，避免半批提交）。"""
    if not isinstance(change, dict):
        raise ApiError(400, "validation_error", f"changes[{index}] 须为对象")
    entity = change.get("entity")
    if entity not in db.ENTITIES:
        raise ApiError(
            400,
            "unknown_entity",
            f"未知实体：{entity!r}（合法实体：{', '.join(db.ENTITIES)}）",
        )
    if "value" not in change:
        raise ApiError(400, "validation_error", f"changes[{index}].value 缺失")
    value = change["value"]
    updated_at = change.get("updatedAt")
    if isinstance(updated_at, bool) or not isinstance(updated_at, (int, float)):
        raise ApiError(400, "validation_error", f"changes[{index}].updatedAt 须为毫秒整数")
    if isinstance(updated_at, float):
        if not updated_at.is_integer():
            raise ApiError(400, "validation_error", f"changes[{index}].updatedAt 须为毫秒整数")
        updated_at = int(updated_at)
    device_id = change.get("deviceId")
    if not isinstance(device_id, str) or not device_id:
        raise ApiError(400, "validation_error", f"changes[{index}].deviceId 须为非空字符串")
    deleted_field = change.get("deleted")
    if deleted_field is not None and not isinstance(deleted_field, bool):
        raise ApiError(400, "validation_error", f"changes[{index}].deleted 须为布尔值")
    # 墓碑线格式冻结（裁决②）：仅认变更对象顶层 deleted 布尔字段。
    # 不探测 value 文档内的 deleted —— 整实体 JSON 是任意文档，域内字段不得影响同步语义。
    return {
        "entity": entity,
        "value": value,
        "updatedAt": int(updated_at),
        "deviceId": device_id,
        "deleted": bool(deleted_field),
    }


def _incoming_wins(incoming: dict, current: dict | None) -> bool:
    """LWW（契约 §3）：updatedAt 毫秒大者胜；平局 deviceId 字典序大者胜。"""
    if current is None:
        return True
    if incoming["updatedAt"] != current["updatedAt"]:
        return incoming["updatedAt"] > current["updatedAt"]
    return incoming["deviceId"] > current["deviceId"]


@app.post("/api/sync")
def post_sync(body: dict | None = Body(default=None)):
    """批量同步。对请求中出现的每个实体，返回合并后的服务端当前记录（含墓碑标记）。"""
    changes = body.get("changes") if isinstance(body, dict) else None
    if not isinstance(changes, list):
        raise ApiError(400, "validation_error", '请求体须为 {"changes":[{entity,value,updatedAt,deviceId}]}')
    validated = [_validate_change(change, i) for i, change in enumerate(changes)]

    # D24：整批先校验（上方，失败整批 400 不半提交），再持锁整批原子落库，
    # 读-判-写全程互斥，并发任意交错下终态恒等于最大 updatedAt。
    with _KV_WRITE_LOCK:
        conn = db.connect(DB_PATH)
        try:
            out = []
            with conn:  # 单事务：整批原子落库
                for change in validated:
                    current = db.get_entity(conn, change["entity"])
                    if _incoming_wins(change, current):
                        db.put_entity(
                            conn,
                            change["entity"],
                            change["value"],
                            change["updatedAt"],
                            change["deviceId"],
                            change["deleted"],
                        )
                    final = db.get_entity(conn, change["entity"])
                    out.append(
                        {
                            "entity": change["entity"],
                            "value": final["value"],
                            "updatedAt": final["updatedAt"],
                            "deviceId": final["deviceId"],
                            "deleted": final["deleted"],
                        }
                    )
        finally:
            conn.close()
    return {"changes": out, "serverTime": now_ms()}


@app.get("/api/snapshots")
def list_snapshots():
    conn = db.connect(DB_PATH)
    try:
        return db.list_snapshots(conn)
    finally:
        conn.close()


@app.post("/api/snapshots")
def create_snapshot(body: dict | None = Body(default=None)):
    """建快照（D11 严格还原口径）：payload 固定含全部五实体 ——
    存活者记 {value,updatedAt,deviceId}，缺席者记 {"absent":true}（墓碑视同缺席）。"""
    label = ""
    if body is not None:
        if not isinstance(body, dict):
            raise ApiError(400, "validation_error", "请求体须为 JSON 对象 {label}")
        label = body.get("label", "")
        if not isinstance(label, str):
            raise ApiError(400, "validation_error", "label 须为字符串")
    created_at = now_ms()
    with _KV_WRITE_LOCK:  # 与 sync/restore 同一把锁：快照内容不受并发写交错影响
        conn = db.connect(DB_PATH)
        try:
            rows = db.get_all_entities(conn)
            payload_entities = {}
            for entity in db.ENTITIES:
                rec = rows.get(entity)
                if rec and not rec["deleted"]:
                    payload_entities[entity] = {
                        "value": rec["value"],
                        "updatedAt": rec["updatedAt"],
                        "deviceId": rec["deviceId"],
                    }
                else:
                    payload_entities[entity] = {"absent": True}
            payload = {"serverTime": created_at, "entities": payload_entities}
            payload_text = json.dumps(payload, ensure_ascii=False)
            with conn:
                snapshot_id = db.create_snapshot(conn, created_at, label, payload_text)
        finally:
            conn.close()
    return {"id": snapshot_id, "createdAt": created_at, "label": label, "size": len(payload_text)}


@app.post("/api/snapshots/{snapshot_id}/restore")
def restore_snapshot(snapshot_id: str):
    """严格还原（D11）：全部五实体前向写入（updatedAt=当前时刻，deviceId=server-restore）——
    快照中存活者恢复内容；快照中缺席者前向写墓碑删除，
    确保「快照之后新建的实体」在回滚后消失且对其他设备收敛（旧时间戳写不进）。
    响应 restored 为逐实体状态 [{entity, action:"restored"|"tombstoned"}]。
    D25：id 非整数或不存在的快照，统一 404 snapshot_not_found。"""
    try:
        sid = int(snapshot_id)  # str 入参手工转 int：FastAPI 路径参数转换失败会走 422/400，需按 D25 统一为 404
    except ValueError:
        raise ApiError(404, "snapshot_not_found", f"快照 {snapshot_id} 不存在（快照 id 须为整数）")
    with _KV_WRITE_LOCK:  # 与 sync/快照创建同一把锁：五实体前向写入不受并发写交错影响
        conn = db.connect(DB_PATH)
        try:
            snapshot = db.get_snapshot(conn, sid)
            if snapshot is None:
                raise ApiError(404, "snapshot_not_found", f"快照 {sid} 不存在")
            payload = json.loads(snapshot["payload"])
            payload_entities = payload.get("entities", {})
            restored_at = now_ms()
            results = []
            with conn:
                for entity in db.ENTITIES:
                    rec = payload_entities.get(entity)
                    if isinstance(rec, dict) and "absent" not in rec:
                        db.put_entity(
                            conn, entity, rec.get("value"), restored_at, RESTORE_DEVICE_ID, deleted=False
                        )
                        results.append({"entity": entity, "action": "restored"})
                    else:
                        # 缺席标记（或异常形态）：前向写墓碑，值置 null（墓碑的 value 无业务语义）
                        db.put_entity(conn, entity, None, restored_at, RESTORE_DEVICE_ID, deleted=True)
                        results.append({"entity": entity, "action": "tombstoned"})
        finally:
            conn.close()
    return {"ok": True, "snapshotId": sid, "restored": results, "serverTime": restored_at}


@app.post("/api/ai/insight")
def ai_insight():
    """预留接口（章程 D7）：config ai.enabled=false（默认）→ 501。"""
    if not _ai_enabled():
        raise ApiError(
            501,
            "ai_disabled",
            "AI 洞察未启用：将 backend/data/config.json 中 ai.enabled 改为 true 即可（请求时现读，即时生效）",
        )
    raise ApiError(501, "not_implemented", "AI 洞察为预留接口，尚未实现")


# ---------------------------------------------------------------- 截图识别导入（T7）

_VISION_SYSTEM_PROMPT = (
    "你是持仓截图识别助手。请从截图中识别每一笔持仓（基金/股票/理财等），"
    '只输出一个 JSON 对象：{"rows":[{"name":"名称","code":"6位代码（识别不到则省略）",'
    '"shares":持有份额,"cost":持仓成本,"market":市值或持有金额}]}。'
    "数字去掉千分位逗号与货币符号；截图里没有的字段省略该键；不要输出 JSON 以外的任何文字。"
)


class _UpstreamError(Exception):
    """智谱上游错误（message 透传给客户端）。status=None 表示网络层失败。"""

    def __init__(self, status: int | None, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


async def _read_upload(image: UploadFile | None, file: UploadFile | None) -> bytes:
    """契约字段 multipart image（兼容 file 别名），读字节并限大小。
    缺件/空文件 → 400 validation_error；超限 → 413 payload_too_large。"""
    upload = image or file
    if upload is None:
        raise ApiError(400, "validation_error", "请以 multipart/form-data 上传图片（字段名 image）")
    chunks: list[bytes] = []
    size = 0
    while True:
        chunk = await upload.read(1024 * 1024)
        if not chunk:
            break
        size += len(chunk)
        if size > MAX_UPLOAD_BYTES:
            raise ApiError(413, "payload_too_large", f"图片超过 {MAX_UPLOAD_BYTES // (1024 * 1024)}MB 上限")
        chunks.append(chunk)
    data = b"".join(chunks)
    if not data:
        raise ApiError(400, "validation_error", "image 字段为空文件")
    return data


@app.post("/api/portfolio/ocr")
async def portfolio_ocr(
    image: UploadFile | None = File(default=None),
    file: UploadFile | None = File(default=None),
):
    """本地截图识别（RapidOCR，数据不出机）。
    multipart image → {rows:[{name,code?,shares?,cost?,market?}], rawLines:[...]}；
    识别失败/空 → {rows:[], rawLines:[]}（不 5xx，前端确认表流程兜底）；
    依赖缺失 → 501 ocr_not_installed。结果仅为候选，确认表人工核对后才写 pf_holdings。"""
    data = await _read_upload(image, file)
    try:
        rows, raw_lines = await run_in_threadpool(ocr.extract, data)
    except ImportError:
        raise ApiError(
            501,
            "ocr_not_installed",
            "本地识别组件未安装：pip install rapidocr-onnxruntime python-multipart（装完重启后端生效）",
        )
    except Exception:
        traceback.print_exc()
        rows, raw_lines = [], []
    return {"rows": rows, "rawLines": raw_lines}


def _call_glm_vision(cfg: dict, image_data: bytes, mime: str) -> str:
    """转发智谱 GLM 视觉模型（open.bigmodel.cn），返回 assistant 文本。
    上游 HTTP 错误/网络失败 → _UpstreamError（message 透传）。"""
    data_url = f"data:{mime};base64," + base64.b64encode(image_data).decode("ascii")
    body = json.dumps(
        {
            "model": cfg["model"],
            "temperature": 0.1,
            "messages": [
                {"role": "system", "content": _VISION_SYSTEM_PROMPT},
                {
                    "role": "user",
                    "content": [
                        {"type": "image_url", "image_url": {"url": data_url}},
                        {"type": "text", "text": "识别这张持仓截图，按系统约定只输出 JSON。"},
                    ],
                },
            ],
        }
    ).encode("utf-8")
    req = urllib.request.Request(
        GLM_CHAT_URL,
        data=body,
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {cfg['apiKey']}"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            payload = json.loads(resp.read().decode("utf-8", "replace"))
    except urllib.error.HTTPError as e:
        raise _UpstreamError(e.code, e.read().decode("utf-8", "replace")[:500])
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        raise _UpstreamError(None, str(e))
    try:
        return str(payload["choices"][0]["message"]["content"])
    except (KeyError, IndexError, TypeError):
        raise _UpstreamError(200, f"响应缺少内容：{json.dumps(payload, ensure_ascii=False)[:300]}")


def _parse_vision_rows(content: str) -> list[dict]:
    """从模型输出提取 {rows:[...]}（容忍 ```json 围栏与前后杂文），归一化字段。"""
    text = content.strip()
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end <= start:
        return []
    try:
        parsed = json.loads(text[start : end + 1])
    except json.JSONDecodeError:
        return []
    rows = parsed.get("rows") if isinstance(parsed, dict) else parsed
    if not isinstance(rows, list):
        return []
    out: list[dict] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        item: dict = {"name": str(row.get("name", "")).strip()}
        code = row.get("code")
        if isinstance(code, (str, int)) and str(code).strip():
            item["code"] = str(code).strip()
        for key in ("shares", "cost", "market"):
            v = row.get(key)
            if isinstance(v, bool) or not isinstance(v, (int, float, str)):
                continue
            try:
                num = float(str(v).replace(",", "").replace("¥", "").replace("￥", ""))
            except ValueError:
                continue
            item[key] = int(num) if key == "shares" and num.is_integer() else round(num, 4)
        out.append(item)
    return out


@app.post("/api/ai/vision")
async def ai_vision(
    image: UploadFile | None = File(default=None),
    file: UploadFile | None = File(default=None),
):
    """AI 视觉识别（GLM 视觉模型，截图出云至智谱——前端须先弹窗确认再调）。
    config ai.vision.enabled=false（默认）或缺 apiKey → 501 ai_disabled；
    上游 HTTP 错误透传为 502 ai_upstream，网络失败 504 ai_upstream_timeout。
    未启用时前端不展示入口（501 可探测）。"""
    cfg = _vision_config()
    if cfg is None:
        raise ApiError(
            501,
            "ai_disabled",
            'AI 视觉识别未启用：在 backend/data/config.json 设置 '
            '{"ai":{"vision":{"enabled":true,"apiKey":"你的智谱APIKey","model":"glm-4v-plus"}}}'
            "（请求时现读，即时生效；注意该功能会将截图发送至智谱云）",
        )
    data = await _read_upload(image, file)
    mime = (image or file).content_type or "image/jpeg"
    if mime not in ("image/jpeg", "image/png", "image/webp", "image/gif"):
        mime = "image/jpeg"
    try:
        content = await run_in_threadpool(_call_glm_vision, cfg, data, mime)
    except _UpstreamError as e:
        if e.status is None:
            raise ApiError(504, "ai_upstream_timeout", f"智谱 API 连接失败：{e.message}")
        raise ApiError(502, "ai_upstream", f"智谱 API 返回 {e.status}：{e.message}")
    return {"rows": _parse_vision_rows(content), "model": cfg["model"]}


# ---------------------------------------------------------------- 兜底与静态托管（注册顺序：API → API 兜底 → 静态）


@app.api_route(
    "/api/{rest:path}",
    methods=["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"],
    include_in_schema=False,
)
async def api_fallback(rest: str):
    """未知 /api/* 路径统一走 JSON 错误，而非静态 404。"""
    raise ApiError(404, "not_found", f"未知 API 路径：/api/{rest}")


class _HtmlNoCacheStaticFiles(StaticFiles):
    """D30（BUG-006）：text/html 响应补 Cache-Control: no-cache，避免浏览器启发式新鲜度
    缓存拿旧版页面；no-cache 仅强制协商复用，ETag/304 不受影响。JS/CSS 响应不加头。
    头在 is_not_modified 判定「之前」注入，304 经 NotModifiedResponse 继承 cache-control
    （复刻 starlette StaticFiles.file_response 逻辑，随 fastapi 0.162/starlette 1.10 冻结）。"""

    def file_response(self, full_path, stat_result, scope, status_code=200):
        response = FileResponse(full_path, status_code=status_code, stat_result=stat_result)
        if str(response.media_type or "").startswith("text/html"):
            response.headers["Cache-Control"] = "no-cache"
        if self.is_not_modified(response.headers, Headers(scope=scope)):
            return NotModifiedResponse(response.headers)
        return response


_PLACEHOLDER_HTML = """<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>持家 chijia v2</title></head>
<body style="font-family:system-ui,sans-serif;max-width:40rem;margin:4rem auto;line-height:1.7;color:#222">
<h1>持家 chijia v2 · 后端运行中</h1>
<p>API 前缀 <code>/api</code>，鉴权请求头 <code>X-Auth-Token</code>，探活 <code>GET /api/health</code>（免鉴权）。</p>
<p>前端尚未部署：backend 同级的 <code>frontend/</code> 目录不存在。部署前端后重启本服务即可同源托管。</p>
</body></html>"""

if FRONTEND_DIR.is_dir():
    app.mount("/", _HtmlNoCacheStaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")
else:

    @app.get("/", include_in_schema=False)
    async def index_placeholder():
        return HTMLResponse(_PLACEHOLDER_HTML, headers={"Cache-Control": "no-cache"})


# ---------------------------------------------------------------- 入口


def main(argv=None):
    global HOST, PORT
    parser = argparse.ArgumentParser(prog="chijia-backend", description="持家 chijia v2 后端（FastAPI + SQLite）")
    parser.add_argument("--host", default="127.0.0.1", help="监听地址（默认 127.0.0.1）")
    parser.add_argument("--port", type=int, default=8410, help="监听端口（默认 8410）")
    args = parser.parse_args(argv)
    HOST, PORT = args.host, args.port
    import uvicorn

    uvicorn.run(app, host=HOST, port=PORT, log_level="info")


if __name__ == "__main__":
    main()
