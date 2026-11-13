"""持家 chijia v2 · 持仓截图 OCR 与行重建（pm/tasks/T7-截图识别导入.md）。

职责：RapidOCR（本地 onnxruntime 推理，数据不出机）识别 → 按文本框坐标重建表格行 →
候选持仓行 [{name, code?, shares?, cost?, market?}]（缺省字段键不出现）。

两套布局策略（先 A 后 B，A 命中则不进 B）：

    A 详情页（金融 App 单产品「持仓详情」截图，T7 三张真实样本均属此类）：
        锚点行 = 含「总金额/总资产/持仓金额/持有金额/最新市值」的行；
        market = 锚点行及其下方 3 行内第一个「无符号、非百分比」金额；
        name   = 锚点行向上最近的一行里「最长的名称候选」（候选格：含 CJK/字母、
                 无数字、无标点、非 UI 词——公告段落等带标点长句天然被跳过）；
        code   = 名称行及上下各 2 行内的独立 6 位数字（保留前导 0）。
    B 表格页（持仓列表截图）：
        表头行 = 含 ≥2 个不同列关键词（份额/数量→shares、成本→cost、市值/金额→market、
                 收益/盈亏/现价→契约外，忽略）的行，记各关键词 x 中心为列锚；
        数据行 = 表头之下「含名称候选 + ≥1 金额格」的行，金额按 x 最近对齐入列；
        无表头时退化：行内第一个无符号金额记 market（其余金额仅留在 rawLines）。
    字段语义拿不准的行照常返回候选——T7 口径：不要求 100% 准，前端确认表兜底，
    绝不静默导入。

识别失败/空图 → 返回 ([], [])，端点据此回 {rows:[], rawLines:[]}（任务书口径，不 5xx）。
依赖缺失：本模块仅在 _get_engine 内延迟 import rapidocr_onnxruntime，
ImportError 向上抛，由 app.py 转 501 ocr_not_installed；其余引擎异常由端点捕获按
「识别失败」处理并打 stderr 日志。
"""

from __future__ import annotations

import re
import threading

# ---------------------------------------------------------------- 引擎（延迟加载，进程内单例）

_engine = None
_ENGINE_LOCK = threading.Lock()


def _get_engine():
    """RapidOCR 单例（默认模型随包分发，无需联网下载）。首次调用加载模型约 1~3s。"""
    global _engine
    if _engine is None:
        with _ENGINE_LOCK:
            if _engine is None:
                from rapidocr_onnxruntime import RapidOCR  # 延迟导入：未安装 → ImportError → 端点 501

                _engine = RapidOCR()
    return _engine


def ocr_cells(data: bytes) -> list[dict]:
    """图片 bytes → 单元格列表 [{text, score, box:[[x,y]×4]}]。图片无法解码返回 []。"""
    import cv2
    import numpy as np

    img = cv2.imdecode(np.frombuffer(data, dtype=np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        return []
    result, _elapse = _get_engine()(img)
    cells: list[dict] = []
    if not result:
        return cells
    for item in result:
        if not isinstance(item, (list, tuple)) or len(item) < 2:
            continue
        text = str(item[1]).strip()
        if not text:
            continue
        score = float(item[2]) if len(item) > 2 and item[2] is not None else 1.0
        box = [[float(p[0]), float(p[1])] for p in item[0]]
        cells.append({"text": text, "score": score, "box": box})
    return cells


# ---------------------------------------------------------------- 文本格分类

_NUM_RE = re.compile(r"^[+±\-]?[¥￥]?[\d,]+(?:\.\d+)?元?$")
_PCT_RE = re.compile(r"^[+±\-]?[\d,]+(?:\.\d+)?[％%]$")
_CODE_RE = re.compile(r"^\d{6}$")
_NUM_CORE_RE = re.compile(r"[\d,]+(?:\.\d+)?")
_SIGNED_RE = re.compile(r"^[+±\-]")
_CJK_OR_LETTER_RE = re.compile(r"[\u4e00-\u9fffA-Za-z]")
_NAME_BAD_RE = re.compile(
    r"[\d％%/\\|，。、；：！？…—·∼~＋（）()【】\[\]「」『』《》〈〉\"'“”‘’：:*＊※]"
)


def _norm(text: str) -> str:
    """OCR 常见全角/变体归一：去空格、全角百分号、Unicode 减号。"""
    return text.replace(" ", "").replace("\u3000", "").replace("−", "-").replace("％", "%")


_THOUSAND_DOT_RE = re.compile(
    r"^(?:\d{1,3}(?:\.\d{3}){2,}|\d{1,3}(?:\.\d{3})+\.\d{1,2})$"
)  # 24.280.38 / 1.234.567（千分位逗号被 OCR 误读为句点；单组如 2.050 有 3 位小数歧义，不转）
_DECIMAL_COMMA_RE = re.compile(r"^\d{1,7},\d{1,2}$")  # 338,93（小数点被误读为逗号）


def _thousand_dot_to_num(t: str) -> float:
    """24.280.38 → 24280.38；1.234.567 → 1234567（末组 ≤2 位视为小数）。"""
    groups = t.split(".")
    if len(groups[-1]) <= 2:
        intpart, frac = "".join(groups[:-1]), groups[-1]
    else:
        intpart, frac = "".join(groups), ""
    return float(f"{intpart}.{frac}" if frac else intpart)


def _classify(item: dict) -> dict:
    """单格分类：code（独立 6 位数字，先于金额判，保留前导 0）/
    amount（金额，记 signed 是否带 ±）/ ratio（百分比，契约外一律弃用）/ text。"""
    t = _norm(item["text"])
    cell = {**item, "kind": "text", "value": None, "signed": False}
    if _PCT_RE.fullmatch(t):
        cell["kind"] = "ratio"
    elif _CODE_RE.fullmatch(t):
        cell["kind"] = "code"
        cell["value"] = t
    elif _DECIMAL_COMMA_RE.fullmatch(t):
        # 先于 _NUM_RE 判：千分位逗号后必为 3 位，`,+≤2位` 是小数点误读（338,93 → 338.93）
        cell["kind"] = "amount"
        cell["value"] = round(float(t.replace(",", ".")), 4)
        cell["signed"] = bool(_SIGNED_RE.match(t))
    elif _NUM_RE.fullmatch(t):
        m = _NUM_CORE_RE.search(t)
        cell["kind"] = "amount"
        cell["value"] = round(float(m.group().replace(",", "")), 4)
        cell["signed"] = bool(_SIGNED_RE.match(t))
    elif _THOUSAND_DOT_RE.fullmatch(t):
        cell["kind"] = "amount"
        cell["value"] = round(_thousand_dot_to_num(t), 4)
        cell["signed"] = bool(_SIGNED_RE.match(t))
    return cell


# ---------------------------------------------------------------- UI 词与名称候选

_LABEL_EXACT = {
    # 导航/按钮/入口
    "持仓详情", "详情", "交易记录", "收益明细", "我的定投", "持仓报告", "查看明细", "立即领取",
    "最高可领", "财运优惠券", "转换", "转出", "定投", "买入", "赎回", "卖出", "组合更名",
    "京小贝", "讨论", "加自选", "自选", "持仓", "持仓分析", "打卡", "签到",
    # 指标标签
    "总金额元", "总资产", "持仓金额", "持有金额", "最新市值", "市值", "份额", "持有份额",
    "可用份额", "持仓成本", "成本", "成本价", "持有收益", "今日收益", "昨日收益", "累计收益",
    "收益率", "持有收益率", "日收益", "盈亏", "涨跌", "涨跌幅", "现价", "市价", "数量",
    "转入待到账", "转出待到账", "冻结调仓", "当前定投", "日期", "业绩表现", "收益走势",
    "累计收益元", "净值", "单位净值", "最新净值", "行情", "走势", "累计收益率",
    # 风险/风格标签
    "中风险", "中高风险", "低风险", "高风险", "中低风险", "R1", "R2", "R3", "R4", "R5",
    "追求收益", "追求稳健", "追求长期资", "多元资产配置", "红利低波", "稳健理财", "进阶理财",
    "把握市场机会",
}
_LABEL_PREFIX = (
    "指数型", "股票型", "债券型", "混合型", "FOF", "QDII", "货币型", "追求", "投顾", "策略",
    "红利", "指数", "债券", "股票",
)


def _is_label_text(text: str) -> bool:
    """UI 词/指标标签判断（去标点后全等，或前缀命中风格标签）。"""
    t = re.sub(r"[\s()（）\[\]【】·.。:：,，、\-…！!？?｜|〉>》<«]+", "", _norm(text))
    if not t:
        return True
    if t in _LABEL_EXACT:
        return True
    return any(t.startswith(p) for p in _LABEL_PREFIX)


def _is_name_candidate(text: str) -> bool:
    """名称候选（严格档）：2~30 字、含 CJK/字母、无数字无标点、非 UI 词。
    公告段落（带标点长句）、代码行、纯数字行天然不命中。"""
    t = text.strip()
    if not 2 <= len(t) <= 30:
        return False
    if _NAME_BAD_RE.search(t):
        return False
    if not _CJK_OR_LETTER_RE.search(t):
        return False
    if _is_label_text(t):
        return False
    return True


def _is_name_loose(text: str) -> bool:
    """名称候选（宽松档）：含 CJK/字母、非 UI 词、非纯数字即可。
    用于「严格档全空」的兜底——基金名称常含数字/括号，如「招商中证白酒指数(161725)」。"""
    t = text.strip()
    if not 2 <= len(t) <= 40:
        return False
    if not _CJK_OR_LETTER_RE.search(t):
        return False
    if _is_label_text(t):
        return False
    if _norm(t).replace(",", "").isdigit():
        return False
    return True


def _name_from_line(line: dict, loose: bool = False) -> str | None:
    """行内取名称：严格档命中取最长；loose=True 时允许退到宽松档（不含金额/百分比/代码格）。"""
    strict = [c["text"] for c in line["cells"] if _is_name_candidate(c["text"])]
    if strict:
        return max(strict, key=len)
    if not loose:
        return None
    others = [
        c["text"]
        for c in line["cells"]
        if c["kind"] not in ("amount", "ratio", "code") and _is_name_loose(c["text"])
    ]
    return max(others, key=len) if others else None


# ---------------------------------------------------------------- 行重建（坐标聚类）

def _build_lines(cells: list[dict]) -> list[dict]:
    """按文本框垂直重叠贪心聚类成行（自上而下），行内按 x 自左向右。
    line = {text, cells:[分类后格子], y(中心), h(行高)}。"""
    items = []
    for c in cells:
        xs = [p[0] for p in c["box"]]
        ys = [p[1] for p in c["box"]]
        x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
        items.append(
            {
                "text": c["text"],
                "x0": x0, "x1": x1, "y0": y0, "y1": y1,
                "xc": (x0 + x1) / 2, "yc": (y0 + y1) / 2,
                "h": max(y1 - y0, 1.0), "w": max(x1 - x0, 1.0),
            }
        )
    items.sort(key=lambda it: (it["yc"], it["x0"]))
    groups: list[list[dict]] = []
    cur: list[dict] = []
    for it in items:
        if cur:
            ref = cur[-1]
            overlap = min(it["y1"], ref["y1"]) - max(it["y0"], ref["y0"])
            if overlap >= 0.3 * min(it["h"], ref["h"]):
                cur.append(it)
                continue
            groups.append(cur)
        cur = [it]
    if cur:
        groups.append(cur)
    lines = []
    for grp in groups:
        grp.sort(key=lambda it: it["x0"])
        cells_out = [_classify(it) for it in grp]
        lines.append(
            {
                "text": " ".join(c["text"] for c in cells_out),
                "cells": cells_out,
                "y": sum(it["yc"] for it in grp) / len(grp),
                "h": max(it["h"] for it in grp),
            }
        )
    return lines


# ---------------------------------------------------------------- 策略 A：详情页布局

_ANCHOR_KWS = ("总金额", "总资产", "持仓金额", "持有金额", "最新市值")


def _extract_detail(lines: list[dict]) -> dict | None:
    """锚点行（总金额等）驱动：market 向下找、name 向上找、code 在名称行附近找。"""
    anchor_idx = None
    for i, ln in enumerate(lines):
        if any(kw in ln["text"] for kw in _ANCHOR_KWS):
            anchor_idx = i
            break
    if anchor_idx is None:
        return None
    row: dict = {}

    # market：锚点行起向下 ≤3 行，第一个无符号非百分比金额
    for ln in lines[anchor_idx : anchor_idx + 4]:
        for c in ln["cells"]:
            if c["kind"] == "amount" and not c["signed"]:
                row["market"] = c["value"]
                break
        if "market" in row:
            break

    # name：先按严格候选向上找（跳过公告段落等带标点长句）；全空再用宽松档兜底
    name_idx = None
    for tier in (False, True):  # False=严格档，True=宽松档
        for j in range(anchor_idx - 1, -1, -1):
            name = _name_from_line(lines[j], loose=tier)
            if name:
                row["name"] = name
                name_idx = j
                break
        if name_idx is not None:
            break

    # code：名称行及上下各 2 行内的独立 6 位数字
    if name_idx is not None:
        for ln in lines[max(0, name_idx - 2) : name_idx + 3]:
            for c in ln["cells"]:
                if c["kind"] == "code":
                    row["code"] = c["value"]
                    break
            if "code" in row:
                break
    return row


# ---------------------------------------------------------------- 策略 B：表格布局

# 列关键词 → 契约字段（None = 契约外字段，识别到也不进 rows）
_HEADER_MAP: tuple[tuple[str, str | None], ...] = (
    ("持有份额", "shares"), ("可用份额", "shares"), ("份额", "shares"), ("数量", "shares"),
    ("持仓成本", "cost"), ("成本价", "cost"), ("成本", "cost"),
    ("最新市值", "market"), ("市值", "market"), ("持有金额", "market"), ("持仓金额", "market"),
    ("金额", "market"),
    ("持有收益", None), ("昨日收益", None), ("累计收益", None), ("收益", None),
    ("盈亏", None), ("涨跌", None), ("现价", None), ("市价", None),
)


def _header_cells(line: dict) -> list[tuple[str, str | None, dict]]:
    """行内命中的列关键词 [(关键词, 字段, 格子)]（一格取最长命中关键词）。"""
    hits = []
    for c in line["cells"]:
        if c["kind"] in ("amount", "ratio", "code"):
            continue
        t = _norm(c["text"])
        best = None
        for kw, field in _HEADER_MAP:
            if kw in t and (best is None or len(kw) > len(best[0])):
                best = (kw, field)
        if best is not None:
            hits.append((best[0], best[1], c))
    return hits


def _extract_table(lines: list[dict]) -> list[dict]:
    """表格页：找表头行做列锚（x 中心），数据行金额按 x 最近对齐入列；
    找不到表头则退化——行内第一个无符号金额记 market。"""
    header_idx, anchors = None, []
    for i, ln in enumerate(lines):
        hits = _header_cells(ln)
        fields = {f for _, f, _c in hits if f is not None}
        if len(fields) >= 2:  # 至少 2 个不同契约字段才算表头
            header_idx = i
            anchors = [(f, c["xc"], c["w"]) for _kw, f, c in hits if f is not None]
            break

    rows: list[dict] = []
    start = (header_idx + 1) if header_idx is not None else 0
    for ln in lines[start:]:
        amounts = [c for c in ln["cells"] if c["kind"] == "amount"]
        name = _name_from_line(ln, loose=True)  # 表格行允许宽松档（名称常含代码括号）
        if name is None or not amounts:
            continue
        row: dict = {"name": name}
        for c in ln["cells"]:
            if c["kind"] == "code":
                row["code"] = c["value"]
                break
        assigned = False
        for amt in amounts:
            field = None
            if anchors:
                # x 最近列锚，容差 = 该关键词格宽的 1.5 倍；对不齐的金额不入列
                nearest = min(anchors, key=lambda a: abs(a[1] - amt["xc"]))
                if abs(nearest[1] - amt["xc"]) <= nearest[2] * 1.5:
                    field = nearest[0]
            if field is None and not assigned and not amt["signed"] and "market" not in row:
                row["market"] = amt["value"]  # 对不齐时退化为「第一个无符号金额」
                assigned = True
                continue
            if field and field not in row:
                row[field] = amt["value"]
                assigned = True
        if assigned or "code" in row:
            rows.append(row)
    return rows


# ---------------------------------------------------------------- 对外入口


def extract(data: bytes) -> tuple[list[dict], list[str]]:
    """图片 bytes → (候选持仓行, 逐行原文)。引擎 ImportError 向上抛（端点转 501）；
    其余异常向上抛（端点按识别失败处理 rows:[]）。"""
    cells = ocr_cells(data)
    if not cells:
        return [], []
    lines = _build_lines(cells)
    detail = _extract_detail(lines)
    rows = [detail] if detail is not None else _extract_table(lines)
    cleaned: list[dict] = []
    for row in rows:
        out: dict = {"name": row.get("name", "")}
        if row.get("code"):
            out["code"] = str(row["code"])
        for key in ("shares", "cost", "market"):
            v = row.get(key)
            if isinstance(v, (int, float)):
                out[key] = int(v) if key == "shares" and float(v).is_integer() else float(v)
        cleaned.append(out)
    return cleaned, [ln["text"] for ln in lines]
