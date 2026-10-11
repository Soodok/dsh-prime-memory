#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""memport.py — MemPort 记忆包工具(MMF v1)。

职责边界:本脚本只做**确定性**工作(解析/校验/归一/去重预筛/生成写入物料/核对),
不做语义裁决。语义冲突的最终判断留给调用它的 Agent(见 references/conflict.md)。

子命令:
  validate  <bundle.mem>                     结构校验(列数/转义/类型码/时间/计数/校验和)
  decode    <bundle.mem> [--out f]           归一为 JSONL(供 Agent 阅读或改写)
  snapshot  --db memory.db [--out f]         读取现存 L1 检索库(去重与冲突比对的基线)
  plan      --bundle f --existing f [...]    预筛裁决(dup/near-dup/conflict-candidate/new)
  emit      --plan f --bundle f --channel    生成写入物料(legacy-jsonl / tool-calls)
  install-legacy --payload f --memory-dir D  把物料落到 l1/records.jsonl(需 --yes)
  verify    --plan f --after f               导入后核对(条数/遗漏)

仅依赖 Python 3.9+ 标准库。所有文件读写均为 UTF-8 / LF。
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sqlite3
import sys
import unicodedata
from datetime import datetime, timezone

VERSION = 1.1
DEFAULT_COLS = ["type", "created", "updated", "vf", "vt", "st", "cf", "rw", "tags", "content"]
TYPE_CODES = {
    "pe": "persona",
    "ep": "episodic",
    "in": "instruction",
    "wf": "work_fact",
    "wt": "work_task",
    "wm": "work_method",
    "wa": "work_artifact",
}
TYPE_FULL = {v: k for k, v in TYPE_CODES.items()}
# 持续性:point 时点 / span 已结束区间 / open 仍在持续 / timeless 无时间性 / ? 未判定
PERSISTENCE = ("p", "s", "o", "t", "?")
EXIT_OK, EXIT_INVALID, EXIT_USAGE = 0, 2, 3
# 阈值经真实语料标定(中文改写对 vs 无关对,score = max(3-gram Jaccard, 2-gram Dice)):
#   真改写对 0.49~0.51 · 主题相关但不同 0.16~0.28
# 因此:≥0.62 视为同一事实的改写;≥0.30 视为相关,交 LLM 判定。宁可多判(代价低),
# 不可漏判(漏判 = 冲突静默入库)。
DEFAULT_DUP_T = 0.62
DEFAULT_REL_T = 0.30


def _stdout_utf8() -> None:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")  # py3.7+
        except Exception:
            pass


def die(msg: str, code: int = EXIT_USAGE) -> "NoReturn":  # type: ignore[name-defined]
    print(f"[memport] {msg}", file=sys.stderr)
    raise SystemExit(code)


def norm_text(s: str) -> str:
    """归一化:NFKC + 空白折叠 + 去首尾。用于哈希与相似度(不改动原文)。"""
    s = unicodedata.normalize("NFKC", s)
    s = re.sub(r"\s+", " ", s)
    return s.strip()


def content_hash(s: str) -> str:
    return hashlib.sha256(norm_text(s).casefold().encode("utf-8")).hexdigest()[:16]


def record_id(src: str, chash: str) -> str:
    return "mp_" + hashlib.sha256(f"{src}|{chash}".encode("utf-8")).hexdigest()[:16]


def unescape_content(s: str) -> str:
    """解码内容列:反斜杠转义(literal 反斜杠 = `\\\\`,换行 = `\\n`)。"""
    out, i, n = [], 0, len(s)
    while i < n:
        c = s[i]
        if c == "\\" and i + 1 < n:
            nxt = s[i + 1]
            if nxt == "\\":
                out.append("\\")
                i += 2
                continue
            if nxt == "n":
                out.append("\n")
                i += 2
                continue
        out.append(c)
        i += 1
    return "".join(out)


def escape_content(s: str) -> str:
    return s.replace("\\", "\\\\").replace("\r\n", "\n").replace("\n", "\\n")


def parse_time(raw: str) -> tuple[int | None, str]:
    """返回 (epoch_ms | None, precision)。precision ∈ exact|minute|day|unknown。"""
    raw = (raw or "").strip()
    if raw in ("", "-", "?", "null"):
        return None, "unknown"
    fmts = (
        ("%Y-%m-%dT%H:%M:%S%z", "exact"),
        ("%Y-%m-%dT%H:%M%z", "minute"),
        ("%Y-%m-%dT%H:%M:%S", "exact"),
        ("%Y-%m-%dT%H:%M", "minute"),
        ("%Y-%m-%d %H:%M:%S", "exact"),
        ("%Y-%m-%d %H:%M", "minute"),
        ("%Y-%m-%d", "day"),
    )
    for fmt, prec in fmts:
        try:
            dt = datetime.strptime(raw, fmt)
        except ValueError:
            continue
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=datetime.now().astimezone().tzinfo)
        return int(dt.timestamp() * 1000), prec
    return None, "unknown"


def parse_tags(raw: str) -> dict:
    out: dict[str, str] = {}
    for part in (raw or "").split(";"):
        part = part.strip()
        if not part or ":" not in part:
            continue
        k, v = part.split(":", 1)
        out[k.strip()] = v.strip()
    return out


def _col(ci: dict[str, int], parts: list[str], name: str, default: str = "") -> str:
    """按列名取值:列不存在返 default;存在则 strip。原 parse_bundle 内闭包 col()。"""
    i = ci.get(name)
    return parts[i].strip() if i is not None else default


# --------------------------------------------------------------------------- 包解析


class Bundle:
    def __init__(self, path: str):
        self.path = path
        self.header: dict[str, str] = {}
        self.cols: list[str] = []
        self.records: list[dict] = []
        self.errors: list[str] = []
        self.warnings: list[str] = []
        self.declared_count: int | None = None
        self.declared_sha: str | None = None


def _parse_header(raw_lines: list[str], b: Bundle) -> list[str]:
    """解析头部键值行与列声明(原 parse_bundle 前段),就地填充 b,返回 body 行列表。"""
    body: list[str] = []
    for ln, line in enumerate(raw_lines, start=1):
        if line.startswith("#"):
            head = line[1:].strip()
            if head.startswith("memport"):
                rest = head[len("memport"):].strip()
                b.header["version"] = rest.split(";")[0].strip() or "1"
                continue
            # 头部键值行:`;` 分隔多个 k=v(不是整行当一个值)
            for part in head.split(";"):
                part = part.strip()
                if not part or "=" not in part:
                    continue
                k, v = part.split("=", 1)
                k, v = k.strip(), v.strip()
                if k == "cols":
                    b.cols = [c.strip() for c in v.split("|")]
                elif k == "count":
                    try:
                        b.declared_count = int(v)
                    except ValueError:
                        b.errors.append(f"L{ln}: count 不是整数:{v}")
                elif k == "sha256":
                    b.declared_sha = v
                else:
                    b.header[k] = v
            continue
        if line.strip() == "":
            continue
        body.append(line)
    if not b.cols:
        b.cols = list(DEFAULT_COLS)
        b.warnings.append("包未声明 #cols=,按 MMF 默认列序解析")
    if "content" not in b.cols:
        b.errors.append("列声明缺少 content 列")
        return body
    missing_cols = [c for c in ("vf", "vt", "st") if c not in b.cols]
    if missing_cols:
        b.warnings.append(
            f"包缺 {'/'.join(missing_cols)} 列(MMF v1 包);有效期与持续性将按 '-/-/?' 落库,"
            "无法参与时间定位,建议导出侧升级到 v1.1"
        )
    ci = {name: i for i, name in enumerate(b.cols)}
    if ci["content"] != len(b.cols) - 1 and b.errors == []:
        b.warnings.append("content 不是最后一列;含 | 的内容可能被误切")
    return body


def _parse_records(b: Bundle, body: list[str]) -> None:
    """按列声明切分并逐条解析记录行(原 parse_bundle 中段),就地追加 b.records。"""
    ci = {name: i for i, name in enumerate(b.cols)}
    for seq, line in enumerate(body, start=1):
        parts = line.split("|", len(b.cols) - 1)
        if len(parts) != len(b.cols):
            b.errors.append(f"记录 {seq}: 列数 {len(parts)} != 声明 {len(b.cols)}")
            continue
        rec = {
            "seq": seq,
            "type": _col(ci, parts, "type"),
            "created": _col(ci, parts, "created"),
            "updated": _col(ci, parts, "updated"),
            "vf": _col(ci, parts, "vf", "-"),
            "vt": _col(ci, parts, "vt", "-"),
            "st": _col(ci, parts, "st", "?"),
            "cf": _col(ci, parts, "cf"),
            "rw": _col(ci, parts, "rw"),
            "tags": parse_tags(_col(ci, parts, "tags")) if "tags" in ci else {},
            "content": unescape_content(parts[ci["content"]]).strip(),
        }
        rec["type_full"] = TYPE_CODES.get(rec["type"], rec["type"])
        rec["hash"] = content_hash(rec["content"])
        cms, cprec = parse_time(rec["created"])
        ums, uprec = parse_time(rec["updated"])
        rec["created_ms"], rec["created_prec"] = cms, cprec
        rec["updated_ms"], rec["updated_prec"] = ums, uprec
        vfms, vfprec = parse_time(rec["vf"])
        vtms, vtprec = parse_time(rec["vt"])
        rec["vf_ms"], rec["vf_prec"] = vfms, vfprec
        rec["vt_ms"], rec["vt_prec"] = vtms, vtprec
        b.records.append(rec)


def _validate_bundle(b: Bundle, body: list[str]) -> None:
    """结构校验(原 parse_bundle 后段):版本/条数/校验和/逐条字段合法性,就地写 errors/warnings。"""
    if b.header.get("version") not in (None, "1", "v1", "1.1", "v1.1"):
        b.errors.append(f"未知包版本:{b.header.get('version')}(本工具支持 1 / 1.1)")
    if b.declared_count is not None and b.declared_count != len(body):
        b.errors.append(f"条数不符:声明 {b.declared_count},实际记录行 {len(body)}")
    if b.declared_sha:
        digest = hashlib.sha256("\n".join(body).encode("utf-8")).hexdigest()
        if not digest.startswith(b.declared_sha[:12]):
            b.errors.append(f"校验和不符:声明 {b.declared_sha[:12]},实算 {digest[:12]}")
    seen: dict[str, int] = {}
    for rec in b.records:
        p = f"记录 {rec['seq']}"
        if rec["type"] not in TYPE_CODES and rec["type"] not in TYPE_FULL:
            if rec["type"] in ("", "?"):
                b.warnings.append(f"{p}: 类型缺失,导入时将回落 episodic")
            else:
                b.warnings.append(f"{p}: 非标准类型码 {rec['type']!r},将按原样透传")
        for fld, val in (("cf", rec["cf"]), ("rw", rec["rw"])):
            if val not in ("0", "1", "?"):
                b.errors.append(f"{p}: {fld} 取值非法 {val!r}(仅 0/1/?)")
        if rec["st"] not in PERSISTENCE:
            b.errors.append(f"{p}: st 取值非法 {rec['st']!r}(仅 p/s/o/t/?)")
        if rec["vf_ms"] and rec["vt_ms"] and rec["vt_ms"] < rec["vf_ms"]:
            b.warnings.append(f"{p}: vt 早于 vf,已按 vf 处理")
            rec["vt_ms"] = rec["vf_ms"]
        if rec["st"] == "o" and rec["vt_ms"]:
            b.warnings.append(f"{p}: st=o(仍在持续)却给了 vt;导入侧会视为已闭合区间,请确认")
        if rec["st"] == "p" and not rec["vf_ms"]:
            b.warnings.append(f"{p}: st=p(时点事件)缺 vf,时间定位将退化到 updated")
        if len(rec["content"]) < 4:
            b.errors.append(f"{p}: content 过短,疑似空记录")
        if len(rec["content"]) > 600:
            b.warnings.append(f"{p}: content 超长({len(rec['content'])} 字符),违反节省规则(≤100 字)")
        if rec["created_ms"] and rec["updated_ms"] and rec["updated_ms"] < rec["created_ms"]:
            b.warnings.append(f"{p}: updated 早于 created,已按 created 视为 updated")
            rec["updated_ms"] = rec["created_ms"]
        if rec["hash"] in seen:
            b.errors.append(f"{p}: 与本包第 {seen[rec['hash']]} 条内容重复(应先在包内去重)")
        else:
            seen[rec["hash"]] = rec["seq"]
    if not b.records:
        b.errors.append("包内没有任何记录")


def parse_bundle(path: str) -> Bundle:
    b = Bundle(path)
    if not os.path.isfile(path):
        b.errors.append(f"包文件不存在:{path}")
        return b
    with open(path, "r", encoding="utf-8-sig", newline="") as fh:
        raw_lines = fh.read().split("\n")
    body = _parse_header(raw_lines, b)
    if "content" not in b.cols:
        return b
    _parse_records(b, body)
    _validate_bundle(b, body)
    return b


# --------------------------------------------------------------------------- 相似度


def gram_set(s: str, n: int = 3) -> set[str]:
    t = norm_text(s).casefold()
    if len(t) <= n:
        return {t} if t else set()
    return {t[i:i + n] for i in range(len(t) - n + 1)}


def jaccard(a: set[str], b: set[str]) -> float:
    if not a or not b:
        return 0.0
    inter = len(a & b)
    return inter / float(len(a | b))


def dice(a: set[str], b: set[str]) -> float:
    """Dice 系数:对长度差异比 Jaccard 宽容,中文改写场景召回更好。"""
    if not a or not b:
        return 0.0
    return 2.0 * len(a & b) / float(len(a) + len(b))


# --------------------------------------------------------------------------- 基线快照


def snapshot_from_db(db_path: str) -> list[dict]:
    uri = f"file:{db_path.replace(os.sep, '/')}?mode=ro"
    con = sqlite3.connect(uri, uri=True, timeout=5.0)
    try:
        cols = {r[1] for r in con.execute("PRAGMA table_info(l1_records)")}
        if not cols:
            raise RuntimeError("l1_records 表不存在")
        # schema 增强后的列可能还不存在(插件 <0.11);存在才取,缺失即视为未知
        extra = [c for c in ("valid_from", "valid_to", "persistence") if c in cols]
        select = (
            "SELECT record_id, content, type, scene_name, version, created_time, updated_time, family"
            + ("".join(", " + c for c in extra))
            + " FROM l1_records"
        )
        rows = con.execute(select).fetchall()
    finally:
        con.close()
    out = []
    for raw in rows:
        rid, content, typ, scene, ver, ct, ut, fam = raw[:8]
        rec = {
            "id": rid, "content": content, "type": typ, "scene_name": scene,
            "version": ver, "created_ms": ct, "updated_ms": ut, "family": fam,
            "hash": content_hash(content), "origin": "db",
        }
        if len(raw) > 8:
            vf, vt, st = (list(raw[8:]) + [None, None, None])[:3]
            rec["valid_from_ms"] = parse_time(str(vf))[0] if vf else None
            rec["valid_to_ms"] = parse_time(str(vt))[0] if vt else None
            rec["persistence"] = st or None
            rec["has_temporal_cols"] = True
        out.append(rec)
    return out


def snapshot_from_jsonl(memory_dir: str) -> list[dict]:
    rec_dir = os.path.join(memory_dir, "records")
    latest: dict[str, dict] = {}
    if not os.path.isdir(rec_dir):
        return []
    for name in sorted(os.listdir(rec_dir)):
        if not name.endswith(".jsonl"):
            continue
        with open(os.path.join(rec_dir, name), "r", encoding="utf-8-sig") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    r = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if not isinstance(r, dict) or not r.get("content"):
                    continue
                latest[r.get("id", "")] = {
                    "id": r.get("id"), "content": r["content"], "type": r.get("type"),
                    "scene_name": r.get("scene_name"), "version": r.get("version"),
                    "created_ms": r.get("createdAt"), "updated_ms": r.get("updatedAt"),
                    "family": r.get("family"), "hash": content_hash(r["content"]),
                    "origin": "jsonl",
                    "valid_from_ms": r.get("validFrom"),
                    "valid_to_ms": r.get("validTo"),
                    "persistence": r.get("persistence"),
                }
    out = list(latest.values())
    return out


def cmd_snapshot(args: argparse.Namespace) -> int:
    recs: list[dict] = []
    source = "none"
    if args.db and os.path.isfile(args.db):
        try:
            recs = snapshot_from_db(args.db)
            source = "db"
        except Exception as exc:  # 库被独占/损坏 → 降级
            print(f"[memport] 读取 memory.db 失败({exc}),降级到 records/*.jsonl", file=sys.stderr)
    if not recs and args.memory_dir:
        recs = snapshot_from_jsonl(args.memory_dir)
        source = "jsonl" if recs else source
    payload = {"source": source, "count": len(recs), "records": recs}
    if args.out:
        with open(args.out, "w", encoding="utf-8", newline="\n") as fh:
            for r in recs:
                fh.write(json.dumps(r, ensure_ascii=False) + "\n")
        print(f"[memport] 现存记忆基线 {len(recs)} 条(来源 {source})→ {args.out}")
    else:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    return EXIT_OK


# --------------------------------------------------------------------------- 裁决预筛


def temporal_sig(vf, vt, st) -> tuple:
    """时间签名:有效期起止 + 持续性(未知一律归 None,避免把"未知"判成"不同")。"""
    return (vf or None, vt or None, st if st in ("p", "s", "o", "t") else None)


def temporal_diff(a: tuple, b: tuple) -> list[str]:
    return [lbl for lbl, x, y in zip(("vf", "vt", "st"), a, b) if x != y]


def _load_existing(path: str | None) -> list[dict]:
    """读入基线 JSONL(不存在/未指定则空列表)。原 cmd_plan 内联段。"""
    existing: list[dict] = []
    if path and os.path.isfile(path):
        with open(path, "r", encoding="utf-8-sig") as fh:
            for line in fh:
                line = line.strip()
                if line:
                    existing.append(json.loads(line))
    return existing


def _score_pair(g3, g2, h3, h2) -> float:
    """综合得分:max(3-gram Jaccard, 2-gram Dice),保留 4 位。原 cmd_plan 内闭包 score_pair。"""
    return round(max(jaccard(g3, h3), dice(g2, h2)), 4)


def _score_against_baseline(rec: dict, by_hash: dict, ex_grams: list,
                            args: argparse.Namespace, bundle_grams: list) -> tuple[str, list, str, bool]:
    """单条记录的预筛裁决(原 cmd_plan 循环体判定段) → (verdict, matched, reason, tdiff)。"""
    hit = by_hash.get(rec["hash"])
    verdict, matched, reason = "new", [], "基线中无相关内容"
    tdiff = False
    if hit:
        verdict, reason = "dup", f"内容哈希与现存 {hit['id']} 完全一致"
        matched = [{"id": hit["id"], "score": 1.0, "hash": hit["hash"], "content": hit["content"]}]
        # 内容一模一样但有效期/持续性不同 → 不是"跳过"而是"更新有效期"(默认仍按 dup 跳过,交 LLM 改判)
        if hit.get("has_temporal_cols"):
            diffs = temporal_diff(
                temporal_sig(rec["vf_ms"], rec["vt_ms"], rec["st"]),
                temporal_sig(hit.get("valid_from_ms"), hit.get("valid_to_ms"), hit.get("persistence")),
            )
            if diffs:
                tdiff = True
                reason += f";但 {'/'.join(diffs)} 不同,可能只需更新有效期(可改判 merge)"
    else:
        c3, c2 = gram_set(rec["content"], 3), gram_set(rec["content"], 2)
        scored = sorted(
            ({"id": r["id"], "score": _score_pair(c3, c2, h3, h2),
              "hash": r["hash"], "content": r["content"]}
             for r, h3, h2 in ex_grams),
            key=lambda x: x["score"], reverse=True,
        )[:3]
        best = scored[0] if scored else None
        if best and best["score"] >= args.dup_threshold:
            verdict = "near-dup"
            matched = [s for s in scored if s["score"] >= args.rel_threshold]
            reason = f"与现存 {best['id']} 相似度 {best['score']:.2f},疑似同一事实的另一种表述"
        elif best and best["score"] >= args.rel_threshold:
            verdict = "conflict-candidate"
            matched = [s for s in scored if s["score"] >= args.rel_threshold]
            reason = f"与现存 {best['id']} 主题相关(相似度 {best['score']:.2f}),需判定互补还是矛盾"
        # 包内近重复:导出侧应已合并,这里兜底拦截(同包两条措辞不同的同一事实)
        if verdict == "new" and bundle_grams:
            ibest, iscore = None, 0.0
            for prev, p3, p2 in bundle_grams:
                sc = _score_pair(c3, c2, p3, p2)
                if sc > iscore:
                    ibest, iscore = prev, sc
            if ibest is not None and iscore >= args.rel_threshold:
                near = iscore >= args.dup_threshold
                verdict = "near-dup" if near else "conflict-candidate"
                matched = [{"id": f"bundle#{ibest['seq']}", "score": iscore,
                            "hash": ibest["hash"], "content": ibest["content"]}]
                reason = (f"与本包第 {ibest['seq']} 条相似度 {iscore:.2f}"
                          + ("(包内近重复,导出侧应先合并)" if near else "(包内相关条目,需判定)"))
    return verdict, matched, reason, tdiff


def cmd_plan(args: argparse.Namespace) -> int:
    b = parse_bundle(args.bundle)
    if b.errors:
        for e in b.errors:
            print(f"[memport] 校验失败:{e}", file=sys.stderr)
        return EXIT_INVALID
    existing = _load_existing(args.existing)
    by_hash: dict[str, dict] = {}
    for r in existing:
        by_hash.setdefault(r["hash"], r)
    ex_grams = [(r, gram_set(r["content"], 3), gram_set(r["content"], 2)) for r in existing]
    src = b.header.get("src", "unknown")
    src_tag = f"{src}/{b.header.get('project', '')}".strip("/")

    plans, pending = [], []
    bundle_grams: list[tuple[dict, set, set]] = []
    counts = {"dup": 0, "near-dup": 0, "conflict-candidate": 0, "new": 0}
    for rec in b.records:
        rid = record_id(src_tag, rec["hash"])
        verdict, matched, reason, tdiff = _score_against_baseline(
            rec, by_hash, ex_grams, args, bundle_grams)
        bundle_grams.append((rec, gram_set(rec["content"], 3), gram_set(rec["content"], 2)))
        counts[verdict] += 1
        row = {
            "seq": rec["seq"], "id": rid, "type": rec["type_full"], "type_code": rec["type"],
            "content": rec["content"], "hash": rec["hash"],
            "created_ms": rec["created_ms"], "updated_ms": rec["updated_ms"] or rec["created_ms"],
            "created_prec": rec["created_prec"], "updated_prec": rec["updated_prec"],
            "vf_ms": rec["vf_ms"], "vt_ms": rec["vt_ms"], "st": rec["st"],
            "vf_prec": rec["vf_prec"], "vt_prec": rec["vt_prec"],
            "cf_hint": rec["cf"], "rw_hint": rec["rw"], "tags": rec["tags"],
            "verdict": verdict, "matched": matched, "reason": reason,
            "temporal_diff": tdiff,
            "needs_llm": verdict in ("near-dup", "conflict-candidate") or tdiff,
            "final_verdict": None, "cf": None, "rw": None,
        }
        plans.append(row)
        if row["needs_llm"]:
            pending.append(row)

    if args.out:
        with open(args.out, "w", encoding="utf-8", newline="\n") as fh:
            for row in plans:
                fh.write(json.dumps(row, ensure_ascii=False) + "\n")
    if args.pending_out:
        with open(args.pending_out, "w", encoding="utf-8", newline="\n") as fh:
            for row in pending:
                fh.write(json.dumps(row, ensure_ascii=False) + "\n")
    if args.report:
        write_report(args.report, b, plans, counts, src_tag)
    summary = {
        "bundle": os.path.basename(args.bundle), "src": src_tag,
        "total": len(plans), "counts": counts,
        "existing_baseline": len(existing), "needs_llm": len(pending),
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    print(f"[memport] 计划已写出:{args.out or '(未写)'};待裁决 {len(pending)} 条"
          + (f" → {args.pending_out}" if args.pending_out else ""))
    return EXIT_OK


def write_report(path: str, b: Bundle, plans: list[dict], counts: dict, src_tag: str) -> None:
    lines = [
        f"# MemPort 导入预筛报告 — {os.path.basename(b.path)}",
        "",
        f"- 来源:{src_tag} · 导出时间:{b.header.get('exported', '未标注')}",
        f"- 基线:现存记忆 {len(plans) and '见上' or ''}",
        f"- 条数:共 {len(plans)} 条 — 新增 {counts['new']} · 完全重复 {counts['dup']} · "
        f"疑似重复 {counts['near-dup']} · 疑冲突 {counts['conflict-candidate']}",
        "",
        "## 逐条预筛",
        "",
        "| # | 类型 | 持续性 | 有效期 | 判定 | 依据 | 内容 |",
        "| --- | --- | --- | --- | --- | --- | --- |",
    ]
    for row in plans:
        content = row["content"].replace("|", "\\|")
        span = f"{row.get('vf_ms') or '-'}~{row.get('vt_ms') or '-'}"
        lines.append(
            f"| {row['seq']} | {row['type_code']} | {row.get('st', '?')} | {span} | "
            f"{row['verdict']} | {row['reason']} | {content[:90]} |"
        )
    if b.warnings:
        lines += ["", "## 警告", ""] + [f"- {w}" for w in b.warnings]
    if b.errors:
        lines += ["", "## 错误", ""] + [f"- {e}" for e in b.errors]
    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write("\n".join(lines) + "\n")


# --------------------------------------------------------------------------- 写入物料


def iso(ms: int | None) -> str | None:
    if not ms:
        return None
    return datetime.fromtimestamp(ms / 1000.0).astimezone().isoformat()


def _build_memport_meta(row: dict, src_tag: str, imported_at: int) -> dict:
    """组装 metadata 块(原 build_record 内联段):memport 源信息 + 时间三写兼容字段。"""
    vf, vt = row.get("vf_ms"), row.get("vt_ms")
    st = row.get("st") if row.get("st") in ("p", "s", "o", "t") else None
    origin = {k: v for k, v in row["tags"].items() if k in ("src", "ref", "id", "ver", "sup")}
    meta: dict = {
        "memport": {
            "v": VERSION, "src": src_tag, "hash": row["hash"],
            "cf": int(row["cf"]), "rw": int(row["rw"]),
            "cfHint": row["cf_hint"], "rwHint": row["rw_hint"],
            "verdict": row["final_verdict"] or row["verdict"],
            "importedAt": imported_at,
            **({"origin": origin} if origin else {}),
        },
        "temporal": {"st": st or "?", "vf": iso(vf), "vt": iso(vt)},
    }
    if vf:
        meta["activity_start_time"] = iso(vf)
    if vt:
        meta["activity_end_time"] = iso(vt)
    if row["tags"].get("hall"):
        meta["hall"] = row["tags"]["hall"]
    if row.get("rewrites"):
        meta["memport"]["rewrites"] = row["rewrites"]
    return meta


def build_record(row: dict, src_tag: str, scene_prefix: str) -> dict:
    """构造 DSH MemoryRecord(legacy 批量通道用,全字段保真)。

    时间三写以兼容不同版本的插件:
      · 顶层 validFrom/validTo/persistence —— schema 增强后的权威列(需插件 ≥0.11)
      · metadata.temporal.{vf,vt,st}       —— 显式时间块,不依赖列迁移
      · metadata.activity_start_time/end   —— 旧消费方(图谱时间锚四级链)直接可用
    """
    cms = row["created_ms"] or row["updated_ms"]
    ums = row["updated_ms"] or cms
    if cms is None:
        cms = ums = int(datetime.now().timestamp() * 1000)
    vf, vt = row.get("vf_ms"), row.get("vt_ms")
    st = row.get("st") if row.get("st") in ("p", "s", "o", "t") else None
    meta = _build_memport_meta(row, src_tag, int(datetime.now().timestamp() * 1000))
    prio = int(row["tags"].get("prio", 80)) if str(row["tags"].get("prio", "80")).isdigit() else 80
    ts = sorted({t for t in (vf, cms, ums) if t})
    rec = {
        "id": row["id"], "content": row["content"], "type": row["type"],
        "priority": prio, "scene_name": f"{scene_prefix}/{src_tag}",
        "timestamps": ts, "createdAt": cms, "updatedAt": ums,
        "version": 0, "metadata": meta,
        "family": "work" if row["type"].startswith("work") else "chat",
    }
    if vf:
        rec["validFrom"] = vf
    if vt:
        rec["validTo"] = vt
    if st:
        rec["persistence"] = st
    return rec


def load_finalized(plan_path: str) -> list[dict]:
    rows = []
    # utf-8-sig:兼容编辑器/PowerShell 写入的 BOM(实测踩坑:Set-Content -Encoding utf8 带 BOM)
    with open(plan_path, "r", encoding="utf-8-sig") as fh:
        for line in fh:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


def resolve(row: dict) -> str:
    """最终判定:Agent 填的 final_verdict 优先,否则用预筛结论。"""
    v = row.get("final_verdict") or row["verdict"]
    return {"near-dup": "dup", "conflict-candidate": "conflict"}.get(v, v)


# 判定 → (cf, rw) 的默认落库标记(见 references/conflict.md §3 裁决矩阵)。
# Agent 若在 plan.jsonl 里显式填了 cf/rw 则以其为准;未填时按此表补齐,避免 None 漏到物料里。
VERDICT_FLAGS = {
    "dup": (0, 0),
    "new": (0, 0),
    "merge": (0, 1),
    "supersede": (0, 0),
    "conflict": (1, 0),
}


def finalize_flags(rows: list[dict]) -> None:
    for row in rows:
        cf, rw = VERDICT_FLAGS.get(resolve(row), (0, 0))
        if row.get("cf") is None:
            row["cf"] = cf
        if row.get("rw") is None:
            row["rw"] = rw


def cmd_emit(args: argparse.Namespace) -> int:
    b = parse_bundle(args.bundle)
    if b.errors:
        for e in b.errors:
            print(f"[memport] 校验失败:{e}", file=sys.stderr)
        return EXIT_INVALID
    rows = load_finalized(args.plan)
    finalize_flags(rows)
    src_tag = args.src or b.header.get("src", "unknown")
    if b.header.get("project") and "/" not in src_tag:
        src_tag = f"{src_tag}"
    if args.channel == "legacy-jsonl":
        return _emit_legacy(rows, src_tag, args)
    return _emit_tool(rows, src_tag, args)


def _emit_legacy(rows: list[dict], src_tag: str, args: argparse.Namespace) -> int:
    """legacy-jsonl 通道:生成全字段 MemoryRecord 批量物料(原 cmd_emit legacy 分支)。"""
    payloads = []
    counts: dict[str, int] = {}
    for row in rows:
        verdict = resolve(row)
        counts[verdict] = counts.get(verdict, 0) + 1
        if verdict in ("dup",):
            continue
        payloads.append(build_record(row, src_tag, args.scene_prefix))
    text = "".join(json.dumps(p, ensure_ascii=False) + "\n" for p in payloads)
    if args.out:
        with open(args.out, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(text)
    print(json.dumps({
        "channel": "legacy-jsonl", "target": "~/.dsh/memory/l1/records.jsonl",
        "records": len(payloads), "skipped_dup": counts.get("dup", 0),
        "requires_restart": True,
        "fidelity": "full(createdAt/updatedAt/metadata/scene_name 全部保留)",
    }, ensure_ascii=False, indent=2))
    print(f"[memport] 物料已写出 → {args.out}(重启 DSH 后由插件一次性导入检索库)")
    return EXIT_OK


def _emit_tool(rows: list[dict], src_tag: str, args: argparse.Namespace) -> int:
    """工具刷写通道(默认):生成 memory_import 批量调用清单(原 cmd_emit tool 分支)。"""
    # 该通道全字段保真(created_at/updated_at/valid_from/valid_to/persistence/origin/cf/rw),
    # 且免重启——是首选通道,文件通道退化为兜底。
    batches: list[list[dict]] = []
    current: list[dict] = []
    counts: dict[str, int] = {}
    for row in rows:
        verdict = resolve(row)
        counts[verdict] = counts.get(verdict, 0) + 1
        if verdict == "dup":
            continue
        item: dict = {"content": row["content"], "type": row["type"]}
        if row["tags"].get("hall"):
            item["hall"] = row["tags"]["hall"]
        if row.get("st") in ("p", "s", "o", "t"):
            item["persistence"] = row["st"]
        if row.get("vf_ms"):
            item["valid_from"] = iso(row["vf_ms"])
        if row.get("vt_ms"):
            item["valid_to"] = iso(row["vt_ms"])
        if row.get("created_ms"):
            item["created_at"] = iso(row["created_ms"])
        if row.get("updated_ms"):
            item["updated_at"] = iso(row["updated_ms"])
        if row["tags"].get("src"):
            item["origin"] = row["tags"]["src"]
        if str(row.get("cf")) == "1" or resolve(row) == "conflict":
            item["conflict"] = True
        if str(row.get("rw")) == "1" or resolve(row) in ("merge", "supersede"):
            item["rewritten"] = True
        if str(row["tags"].get("prio", "")).isdigit():
            item["priority"] = int(row["tags"]["prio"])
        current.append(item)
        if len(current) >= args.batch_size:
            batches.append(current)
            current = []
    if current:
        batches.append(current)
    payload = {
        "tool": "memory_import",
        "scene": args.scene,
        "batches": [
            {"call": "memory_import", "args": {"scene": args.scene, "records": batch}}
            for batch in batches
        ],
    }
    if args.out:
        with open(args.out, "w", encoding="utf-8", newline="\n") as fh:
            json.dump(payload, fh, ensure_ascii=False, indent=2)
    print(json.dumps({
        "channel": "tool", "tool": "memory_import", "scene": args.scene,
        "records": sum(len(b) for b in batches), "batches": len(batches),
        "max_batch": args.batch_size, "skipped_dup": counts.get("dup", 0),
        "requires_restart": False,
        "fidelity": "full(created_at/updated_at/valid_from/valid_to/persistence/origin/cf/rw 全保留)",
    }, ensure_ascii=False, indent=2))
    print(f"[memport] 工具调用清单已写出 → {args.out}(逐个 memory_import 调用,免重启)")
    return EXIT_OK


def cmd_install_legacy(args: argparse.Namespace) -> int:
    if not args.yes:
        die("install-legacy 会写宿主的 l1/records.jsonl,需显式加 --yes 确认")
    target_dir = os.path.join(args.memory_dir, "l1")
    target = os.path.join(target_dir, "records.jsonl")
    os.makedirs(target_dir, exist_ok=True)
    if os.path.exists(target):
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        backup = f"{target}.bak.{stamp}"
        os.replace(target, backup)
        print(f"[memport] 已备份原待导入文件 → {backup}")
    with open(args.payload, "r", encoding="utf-8") as src, \
            open(target, "w", encoding="utf-8", newline="\n") as dst:
        dst.write(src.read())
    n = sum(1 for _ in open(target, "r", encoding="utf-8"))
    print(f"[memport] 已放置 {n} 条到 {target};重启 DSH 后插件将一次性导入检索库并改名 .imported")
    return EXIT_OK


def cmd_verify(args: argparse.Namespace) -> int:
    rows = load_finalized(args.plan)
    expect = {r["hash"] for r in rows if resolve(r) != "dup"}
    after: dict[str, dict] = {}
    skipped = 0
    with open(args.after, "r", encoding="utf-8-sig") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            r = json.loads(line)
            # 基线来源可以是 snapshot 输出(带 hash)、decode 输出,或原始记录转储(只有 content)
            h = r.get("hash")
            if not h and r.get("content"):
                h = content_hash(r["content"])
            if not h:
                skipped += 1
                continue
            after[h] = r
    missing = sorted(expect - set(after))
    print(json.dumps({
        "expected": len(expect), "found": len(expect) - len(missing),
        "missing": len(missing), "skipped_rows": skipped, "ok": not missing,
    }, ensure_ascii=False, indent=2))
    if missing:
        print("[memport] 以下记录未在导入后基线中出现,导入未完成:", file=sys.stderr)
        for h in missing[:20]:
            row = next((r for r in rows if r["hash"] == h), None)
            if row:
                print(f"  - {row['id']} {row['content'][:60]}", file=sys.stderr)
        return EXIT_INVALID
    print("[memport] 核对通过:计划内记录已全部入库")
    return EXIT_OK


def cmd_decode(args: argparse.Namespace) -> int:
    b = parse_bundle(args.bundle)
    if b.errors:
        for e in b.errors:
            print(f"[memport] 校验失败:{e}", file=sys.stderr)
        return EXIT_INVALID
    lines = [json.dumps({k: v for k, v in r.items() if k != "seq"}, ensure_ascii=False)
             for r in b.records]
    if args.out:
        with open(args.out, "w", encoding="utf-8", newline="\n") as fh:
            fh.write("\n".join(lines) + "\n")
        print(f"[memport] 已解码 {len(lines)} 条 → {args.out}")
    else:
        print("\n".join(lines))
    return EXIT_OK


def cmd_validate(args: argparse.Namespace) -> int:
    b = parse_bundle(args.bundle)
    result = {
        "bundle": b.path, "ok": not b.errors, "version": b.header.get("version", "1"),
        "src": b.header.get("src"), "project": b.header.get("project"),
        "exported": b.header.get("exported"),
        "declared_count": b.declared_count, "parsed_count": len(b.records),
        "errors": b.errors, "warnings": b.warnings,
        "types": {},
    }
    for r in b.records:
        result["types"][r["type"]] = result["types"].get(r["type"], 0) + 1
    print(json.dumps(result, ensure_ascii=False, indent=2))
    if b.errors:
        return EXIT_INVALID
    print(f"[memport] 校验通过:{len(b.records)} 条,{len(b.warnings)} 条警告")
    return EXIT_OK


def main(argv: list[str] | None = None) -> int:
    _stdout_utf8()
    ap = argparse.ArgumentParser(prog="memport.py", description="MemPort 记忆包工具(MMF v1)")
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("validate", help="结构校验")
    p.add_argument("bundle")
    p.set_defaults(func=cmd_validate)

    p = sub.add_parser("decode", help="解码为 JSONL")
    p.add_argument("bundle")
    p.add_argument("--out")
    p.set_defaults(func=cmd_decode)

    p = sub.add_parser("snapshot", help="导出现存记忆基线")
    p.add_argument("--db", default=os.path.expanduser("~/.dsh/memory/memory.db"))
    p.add_argument("--memory-dir", default=os.path.expanduser("~/.dsh/memory"))
    p.add_argument("--out")
    p.set_defaults(func=cmd_snapshot)

    p = sub.add_parser("plan", help="预筛裁决")
    p.add_argument("--bundle", required=True)
    p.add_argument("--existing", required=True)
    p.add_argument("--out")
    p.add_argument("--pending-out")
    p.add_argument("--report")
    p.add_argument("--dup-threshold", type=float, default=DEFAULT_DUP_T)
    p.add_argument("--rel-threshold", type=float, default=DEFAULT_REL_T)
    p.set_defaults(func=cmd_plan)

    p = sub.add_parser("emit", help="生成写入物料")
    p.add_argument("--plan", required=True)
    p.add_argument("--bundle", required=True)
    p.add_argument("--channel", choices=["tool", "legacy-jsonl"], default="tool")
    p.add_argument("--out")
    p.add_argument("--src")
    p.add_argument("--scene", default="外部导入")
    p.add_argument("--scene-prefix", default="外部导入")
    p.add_argument("--batch-size", type=int, default=200, help="每个 memory_import 调用的记录数上限")
    p.set_defaults(func=cmd_emit)

    p = sub.add_parser("install-legacy", help="放置 l1/records.jsonl(需 --yes)")
    p.add_argument("--payload", required=True)
    p.add_argument("--memory-dir", default=os.path.expanduser("~/.dsh/memory"))
    p.add_argument("--yes", action="store_true")
    p.set_defaults(func=cmd_install_legacy)

    p = sub.add_parser("verify", help="导入后核对")
    p.add_argument("--plan", required=True)
    p.add_argument("--after", required=True)
    p.set_defaults(func=cmd_verify)

    args = ap.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
