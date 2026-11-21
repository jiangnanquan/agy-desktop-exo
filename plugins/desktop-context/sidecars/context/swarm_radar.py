#!/usr/bin/env python3
"""Swarm & Subagent Panoramic Cache Radar for Antigravity 2.0.

Pure Python 3 standard-library probe (<50ms) that:
1. Resolves any conversation_id (coordinator, swarm worker, or subagent; full UUID or prefix)
   to its root cluster (`swarm/members.json` + `subagents/*.json`).
2. Streams `transcript.jsonl` (with lightweight `.db` metadata fallback) to compute per-member
   turn counts, context watermarks, cache hit rates, Cache Bust ledgers, live TTL anchor
   (`last_turn_at`), and Model Audit compliance.
3. Audits coordinator pre-swarm serial overhead (`pre_dispatch_steps`, `pre_dispatch_seconds`).
"""

import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import sqlite3
import sys
import time

MODEL_SEL_RE = re.compile(r"setting `Model Selection` from .*? to ([^.\r\n]+)")
FAST_PR_CREATED_RE = re.compile(r'"created_at"\s*:\s*"([^"]+)"')
FAST_PR_INP_RE = re.compile(r'"input_tokens"\s*:\s*(\d+)')
FAST_PR_CR_RE = re.compile(r'"cache_read_tokens"\s*:\s*(\d+)')
FAST_PR_OUT_RE = re.compile(r'"output_tokens"\s*:\s*(\d+)')

NATIVE_CONTEXT_WINDOWS = [
    ("claude-opus-4-6", 250_000),
    ("claude-sonnet-4-6", 250_000),
    ("claude-", 1_000_000),
    ("gpt-oss-", 131_072),
    ("gemini-", 1_048_576),
]


def is_cache_bust(prev_prompt: int, curr_prompt: int, fresh_input: int, cache_read: int) -> bool:
    """Detect full-price cache bust rebuilds without context compaction."""
    if prev_prompt < 30_000:
        return False
    if curr_prompt < prev_prompt * 0.8:
        return False
    if cache_read == 0 and fresh_input >= 30_000:
        return True
    if cache_read < prev_prompt * 0.05 and fresh_input >= 50_000:
        return True
    return False


def parse_iso_epoch(ts: str) -> float | None:
    if not ts:
        return None
    s = ts.strip()
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    try:
        return datetime.fromisoformat(s).timestamp()
    except ValueError:
        return None


def _read_varint(buf: bytes, pos: int) -> tuple[int, int]:
    val = 0
    shift = 0
    n = len(buf)
    while pos < n:
        b = buf[pos]
        pos += 1
        val |= (b & 0x7F) << shift
        if not (b & 0x80):
            return val, pos
        shift += 7
    raise ValueError("Truncated varint")


class _MiniMsg:
    """Minimal protobuf reader for 1-row gen_metadata lookups."""

    def __init__(self, buf: bytes | None):
        self.fields: dict[int, list] = {}
        pos, n = 0, len(buf or b"")
        while pos < n:
            try:
                tag, pos = _read_varint(buf, pos)
                fn, wt = tag >> 3, tag & 7
                if wt == 0:
                    val, pos = _read_varint(buf, pos)
                elif wt == 2:
                    ln, pos = _read_varint(buf, pos)
                    val = buf[pos : pos + ln]
                    pos += ln
                elif wt == 1:
                    val, pos = buf[pos : pos + 8], pos + 8
                elif wt == 5:
                    val, pos = buf[pos : pos + 4], pos + 4
                else:
                    break
            except ValueError:
                break
            self.fields.setdefault(fn, []).append(val)

    def has(self, fn: int) -> bool:
        return fn in self.fields

    def int(self, fn: int, signed32: bool = False) -> int:
        v = self.fields.get(fn, [0])[-1]
        v = v if isinstance(v, int) else 0
        if signed32 and v >= 1 << 63:
            v -= 1 << 64
        return v

    def bytes(self, fn: int) -> bytes:
        v = self.fields.get(fn, [b""])[-1]
        return v if isinstance(v, bytes) else b""

    def str(self, fn: int) -> str:
        return self.bytes(fn).decode("utf-8", errors="replace")

    def msg(self, fn: int) -> "_MiniMsg | None":
        return _MiniMsg(self.bytes(fn)) if self.has(fn) else None


def _probe_db_meta(conv_dir: Path, cid: str) -> dict:
    """Fast <0.5ms point read on gen_metadata to get exact model slug & budget."""
    info = {
        "db_model_id": "",
        "db_model_display": "",
        "request_budget": 512_000,
        "limit_tokens": 1_048_576,
        "db_path": None,
    }
    if not cid:
        return info
    db_path = conv_dir / f"{cid}.db"
    if not db_path.is_file():
        return info
    info["db_path"] = db_path
    uri = "file:" + db_path.as_posix() + "?mode=ro"
    try:
        conn = sqlite3.connect(uri, uri=True)
        try:
            row = conn.execute("SELECT data FROM gen_metadata ORDER BY idx DESC LIMIT 1").fetchone()
        finally:
            conn.close()
    except sqlite3.Error:
        return info

    if not row or not row[0]:
        return info
    gen = _MiniMsg(row[0])
    planner = gen.msg(3)
    slug = planner.str(28) if planner else ""
    chat = gen.msg(1)
    disp = (chat.str(21) or chat.str(19)) if chat else ""
    start = chat.msg(9) if chat else None
    cwm = start.msg(10) if start else None
    budget = cwm.int(4, signed32=True) if cwm else 0

    limit = 0
    for prefix, win in NATIVE_CONTEXT_WINDOWS:
        if slug.startswith(prefix):
            limit = win
            break
    if not limit:
        limit = budget or 1_048_576

    info["db_model_id"] = slug
    info["db_model_display"] = disp
    if budget > 0:
        info["request_budget"] = budget
    if limit > 0:
        info["limit_tokens"] = limit
    return info


def _scan_db_turns_fallback(db_path: Path) -> dict:
    """Fallback turn scanner from SQLite when transcript.jsonl is absent."""
    res = {
        "turns": 0,
        "current_context": 0,
        "total_input": 0,
        "total_cache_read": 0,
        "total_output": 0,
        "cache_bust_count": 0,
        "cache_bust_tokens": 0,
        "last_turn_at": "",
    }
    uri = "file:" + db_path.as_posix() + "?mode=ro"
    try:
        conn = sqlite3.connect(uri, uri=True)
        try:
            rows = conn.execute("SELECT data FROM gen_metadata ORDER BY idx ASC").fetchall()
            last_pr = conn.execute(
                "SELECT metadata FROM steps WHERE step_type = 15 ORDER BY idx DESC LIMIT 1"
            ).fetchone()
        finally:
            conn.close()
    except sqlite3.Error:
        return res

    prev_p = 0
    for (blob,) in rows:
        if not blob:
            continue
        gm = _MiniMsg(blob)
        chat = gm.msg(1)
        u = chat.msg(4) if chat else None
        if u is None:
            continue
        inp = u.int(2)
        cr = u.int(5)
        out = u.int(3)
        curr_p = inp + cr
        if is_cache_bust(prev_p, curr_p, inp, cr):
            res["cache_bust_count"] += 1
            res["cache_bust_tokens"] += inp
        prev_p = curr_p
        res["turns"] += 1
        res["current_context"] = curr_p
        res["total_input"] += inp
        res["total_cache_read"] += cr
        res["total_output"] += out

    if last_pr and last_pr[0]:
        md = _MiniMsg(last_pr[0])
        ts_msg = md.msg(1)
        if ts_msg and ts_msg.int(1) > 0:
            try:
                res["last_turn_at"] = datetime.fromtimestamp(ts_msg.int(1), tz=timezone.utc).strftime(
                    "%Y-%m-%dT%H:%M:%SZ"
                )
            except (OSError, ValueError):
                pass
    return res


def scan_transcript(transcript_path: Path, is_coordinator: bool = False) -> dict:
    """Fast single-pass streaming scan of transcript.jsonl."""
    stats = {
        "turns": 0,
        "current_context": 0,
        "total_input": 0,
        "total_cache_read": 0,
        "total_output": 0,
        "cache_bust_count": 0,
        "cache_bust_tokens": 0,
        "last_turn_at": "",
        "first_step_at": "",
        "last_step_at": "",
        "last_step_type": "",
        "last_step_has_tools": False,
        "selected_model": "",
        "pre_dispatch_steps": None,
        "pre_dispatch_seconds": None,
    }
    if not transcript_path.is_file():
        return stats

    prev_prompt = 0
    first_epoch: float | None = None
    first_step_idx: int | None = None
    dispatch_found = False
    non_empty_idx = 0

    try:
        with open(transcript_path, encoding="utf-8", errors="replace") as fh:
            for raw in fh:
                line = raw.strip()
                if not line:
                    continue
                curr_line_no = non_empty_idx
                non_empty_idx += 1

                need_full_json = (
                    curr_line_no == 0
                    or "Model Selection" in line
                    or (is_coordinator and not dispatch_found and ('"swarm"' in line or '"invoke_subagent"' in line))
                )
                if not need_full_json:
                    if '"PLANNER_RESPONSE"' not in line[:160]:
                        continue
                    head = line[:420]
                    m_in = FAST_PR_INP_RE.search(head)
                    m_cr = FAST_PR_CR_RE.search(head)
                    m_out = FAST_PR_OUT_RE.search(head)
                    m_at = FAST_PR_CREATED_RE.search(head)
                    if m_in is not None or m_cr is not None or m_out is not None:
                        inp = int(m_in.group(1)) if m_in else 0
                        cr = int(m_cr.group(1)) if m_cr else 0
                        out = int(m_out.group(1)) if m_out else 0
                        created_at = m_at.group(1) if m_at else ""
                        if created_at:
                            stats["last_step_at"] = created_at
                            stats["last_turn_at"] = created_at
                        stats["last_step_type"] = "PLANNER_RESPONSE"
                        stats["last_step_has_tools"] = '"tool_calls"' in line
                        curr_prompt = inp + cr
                        if curr_prompt > 0 or out > 0:
                            if is_cache_bust(prev_prompt, curr_prompt, inp, cr):
                                stats["cache_bust_count"] += 1
                                stats["cache_bust_tokens"] += inp
                            prev_prompt = curr_prompt
                            stats["turns"] += 1
                            stats["current_context"] = curr_prompt
                            stats["total_input"] += inp
                            stats["total_cache_read"] += cr
                            stats["total_output"] += out
                        continue

                try:
                    rec = json.loads(line)
                except json.JSONDecodeError:
                    continue

                created_at = str(rec.get("created_at") or "")
                stype = str(rec.get("type") or "")

                if curr_line_no == 0:
                    stats["first_step_at"] = created_at
                    first_epoch = parse_iso_epoch(created_at)
                    sidx = rec.get("step_index")
                    first_step_idx = int(sidx) if isinstance(sidx, int) else 0

                if created_at:
                    stats["last_step_at"] = created_at
                stats["last_step_type"] = stype

                if stype == "USER_INPUT":
                    content = str(rec.get("content") or "")
                    if "Model Selection" in content:
                        for m in MODEL_SEL_RE.finditer(content):
                            stats["selected_model"] = m.group(1).strip()

                tool_calls = rec.get("tool_calls")
                has_tools = bool(isinstance(tool_calls, list) and len(tool_calls) > 0)
                stats["last_step_has_tools"] = has_tools

                if is_coordinator and not dispatch_found and has_tools:
                    for tc in tool_calls:
                        if isinstance(tc, dict) and tc.get("name") in ("swarm", "invoke_subagent"):
                            dispatch_found = True
                            sidx = rec.get("step_index")
                            if isinstance(sidx, int) and first_step_idx is not None and first_step_idx == 0:
                                stats["pre_dispatch_steps"] = sidx
                            else:
                                stats["pre_dispatch_steps"] = curr_line_no
                            disp_epoch = parse_iso_epoch(created_at)
                            if first_epoch is not None and disp_epoch is not None:
                                stats["pre_dispatch_seconds"] = max(0, int(round(disp_epoch - first_epoch)))
                            break

                if stype == "PLANNER_RESPONSE":
                    inp = int(rec.get("input_tokens") or 0)
                    cr = int(rec.get("cache_read_tokens") or 0)
                    out = int(rec.get("output_tokens") or 0)
                    curr_prompt = inp + cr
                    if curr_prompt > 0 or out > 0:
                        if is_cache_bust(prev_prompt, curr_prompt, inp, cr):
                            stats["cache_bust_count"] += 1
                            stats["cache_bust_tokens"] += inp
                        prev_prompt = curr_prompt
                        stats["turns"] += 1
                        stats["current_context"] = curr_prompt
                        stats["total_input"] += inp
                        stats["total_cache_read"] += cr
                        stats["total_output"] += out
                    if created_at:
                        stats["last_turn_at"] = created_at
    except OSError:
        pass

    return stats


DEFAULT_AUDIT_RULES = {
    "enabled": False,
    "forbidden_patterns": [],
    "forbidden_label": {"zh": "违禁模型", "en": "Forbidden"},
    "warn_worker_patterns": [],
    "safe_worker_patterns": [],
    "exempt_role_keywords": [],
    "warn_label": {"zh": "越级模型", "en": "Over-tier"},
    "ok_label": {"zh": "合规", "en": "Compliant"},
}


def resolve_config_path(gemini_dir: Path | None = None, config_path: Path | str | None = None) -> Path:
    """Resolve user config file path with AGY_CONTEXT_PRO_CONFIG override support."""
    if config_path:
        return Path(config_path).expanduser()
    env_override = os.environ.get("AGY_CONTEXT_PRO_CONFIG", "").strip()
    if env_override:
        return Path(env_override).expanduser()
    base_dir = gemini_dir or (Path.home() / ".gemini")
    return base_dir / "context-pro-config.json"


def _clean_str_list(raw_val: object) -> list[str]:
    if not isinstance(raw_val, list):
        return []
    out: list[str] = []
    for item in raw_val:
        if isinstance(item, (str, int, float)):
            s = str(item).strip()
            if s:
                out.append(s)
    return out


def _normalize_lang_setting(raw_lang: object) -> str:
    val = str(raw_lang or "auto").strip().lower()
    if val.startswith("zh"):
        return "zh"
    if val.startswith("en"):
        return "en"
    return "auto"


def load_context_pro_config(gemini_dir: Path | None = None, config_path: Path | str | None = None) -> dict:
    """Load ~/.gemini/context-pro-config.json with 100% graceful fallback on missing/corrupt data."""
    cfg_file = resolve_config_path(gemini_dir=gemini_dir, config_path=config_path)
    raw: dict = {}
    if cfg_file.is_file():
        try:
            parsed = json.loads(cfg_file.read_text(encoding="utf-8", errors="replace"))
            if isinstance(parsed, dict):
                raw = parsed
        except (OSError, json.JSONDecodeError):
            raw = {}

    raw_ar = raw.get("audit_rules")
    ar = raw_ar if isinstance(raw_ar, dict) else {}

    return {
        "lang": _normalize_lang_setting(raw.get("lang")),
        "audit_rules": {
            "enabled": ar.get("enabled") is True,
            "forbidden_patterns": _clean_str_list(ar.get("forbidden_patterns")),
            "forbidden_label": ar.get("forbidden_label", DEFAULT_AUDIT_RULES["forbidden_label"]),
            "warn_worker_patterns": _clean_str_list(ar.get("warn_worker_patterns")),
            "safe_worker_patterns": _clean_str_list(ar.get("safe_worker_patterns")),
            "exempt_role_keywords": _clean_str_list(ar.get("exempt_role_keywords")),
            "warn_label": ar.get("warn_label", DEFAULT_AUDIT_RULES["warn_label"]),
            "ok_label": ar.get("ok_label", DEFAULT_AUDIT_RULES["ok_label"]),
        },
    }


def resolve_effective_lang(cli_lang: str = "", cfg_lang: str = "auto") -> str:
    """Resolve output label language: zh returns Chinese labels; otherwise English."""
    explicit = _normalize_lang_setting(cli_lang) if cli_lang else ""
    if explicit in ("zh", "en"):
        return explicit
    return "zh" if cfg_lang == "zh" else "en"


def _resolve_i18n_label(raw_label: object, lang: str, default_map: dict[str, str]) -> str:
    if isinstance(raw_label, str) and raw_label.strip():
        return raw_label.strip()
    if isinstance(raw_label, dict):
        cand = raw_label.get(lang) or raw_label.get("en") or raw_label.get("zh")
        if isinstance(cand, str) and cand.strip():
            return cand.strip()
    return default_map.get(lang, default_map["en"])


def resolve_member_display_model(
    kind: str,
    applied_model: str,
    selected_model: str,
    db_model_id: str,
    db_model_display: str,
) -> tuple[str, str, str]:
    """Resolve display model name, raw base slug, and effective selected model."""
    base_slug = (applied_model or db_model_id or "").strip()
    sel = (selected_model or "").strip()
    db_disp = (db_model_display or "").strip()
    effective_sel = sel if (kind == "coordinator" or not base_slug) else ""

    # Generic Antigravity protocol resolution: orchestrator runs on gemini-flash-worker-agy base.
    if base_slug == "gemini-flash-worker-agy":
        disp = f"{sel} [flash-worker]" if (kind == "coordinator" and sel) else "gemini-flash-worker-agy"
    elif kind == "coordinator":
        disp = sel or applied_model or db_disp or base_slug or "Unknown"
    else:
        disp = applied_model or db_disp or effective_sel or base_slug or "Unknown"

    return disp, (base_slug or disp), effective_sel


def resolve_model_and_audit(
    kind: str,
    name: str,
    role: str,
    applied_model: str,
    selected_model: str,
    db_model_id: str,
    db_model_display: str,
    audit_rules: dict | None = None,
    lang: str = "en",
) -> tuple[str, str, dict]:
    """Determine true model label, raw base model slug, and configurable compliance audit status."""
    base_slug = (applied_model or db_model_id or "").strip()
    db_disp = (db_model_display or "").strip()
    disp, raw_slug, effective_sel = resolve_member_display_model(
        kind=kind,
        applied_model=applied_model,
        selected_model=selected_model,
        db_model_id=db_model_id,
        db_model_display=db_model_display,
    )

    eff_lang = "zh" if lang == "zh" else "en"
    rules = audit_rules if isinstance(audit_rules, dict) else DEFAULT_AUDIT_RULES
    if rules.get("enabled") is not True:
        default_label = "正常" if eff_lang == "zh" else "OK"
        return disp, raw_slug, {"status": "ok", "label": default_label, "audit_enabled": False}

    combined_model = f"{base_slug} {db_disp} {effective_sel}".lower()
    forbidden_patterns = _clean_str_list(rules.get("forbidden_patterns"))
    if any(pat.lower() in combined_model for pat in forbidden_patterns):
        label = _resolve_i18n_label(
            rules.get("forbidden_label"), eff_lang, DEFAULT_AUDIT_RULES["forbidden_label"]
        )
        return disp, raw_slug, {"status": "violation", "label": label, "audit_enabled": True}

    if kind != "coordinator":
        safe_patterns = _clean_str_list(rules.get("safe_worker_patterns"))
        warn_patterns = _clean_str_list(rules.get("warn_worker_patterns"))
        exempt_keywords = _clean_str_list(rules.get("exempt_role_keywords"))
        is_safe = any(pat.lower() in combined_model for pat in safe_patterns)
        is_warn = any(pat.lower() in combined_model for pat in warn_patterns)
        ident_lower = f"{name} {role}".lower()
        is_exempt = any(kw.lower() in ident_lower for kw in exempt_keywords)
        if not is_safe and is_warn and not is_exempt:
            label = _resolve_i18n_label(
                rules.get("warn_label"), eff_lang, DEFAULT_AUDIT_RULES["warn_label"]
            )
            return disp, raw_slug, {"status": "warn", "label": label, "audit_enabled": True}

    ok_label = _resolve_i18n_label(
        rules.get("ok_label"), eff_lang, DEFAULT_AUDIT_RULES["ok_label"]
    )
    return disp, raw_slug, {"status": "ok", "label": ok_label, "audit_enabled": True}


def _resolve_conv_prefix(conv_id: str, brain_dir: Path, conv_dir: Path) -> str:
    """Resolve short conversation prefix (e.g. 'ad50969c') to full UUID if matched."""
    cid = (conv_id or "").strip()
    if not cid or len(cid) >= 36:
        return cid
    if (brain_dir / cid).is_dir():
        return cid
    if brain_dir.is_dir():
        b_matches = sorted(
            [p.name for p in brain_dir.glob(f"{cid}*") if p.is_dir()],
            reverse=True,
        )
        if b_matches:
            return b_matches[0]
    if conv_dir.is_dir():
        c_matches = sorted(
            [p.stem for p in conv_dir.glob(f"{cid}*.db") if p.is_file()],
            reverse=True,
        )
        if c_matches:
            return c_matches[0]
    return cid


def _find_root_cluster(
    conv_id: str,
    brain_dir: Path,
    lookback_hours: float = 72.0,
    latest_fallback: bool = False,
) -> tuple[str, str, bool]:
    """Return (root_id, viewed_conv_id, is_fallback).

    1. Direct coordinator check: brain/<conv_id>/.system_generated/swarm/members.json
       or brain/<conv_id>/.system_generated/subagents/*.json
    2. Reverse lookup across recent (<=72h) swarm/members.json & subagents/*.json
    3. Optional latest_fallback for viewing recent machine swarm history when idle.
    """
    if not brain_dir.is_dir():
        return conv_id, conv_id, False

    if conv_id:
        direct_swarm = brain_dir / conv_id / ".system_generated" / "swarm" / "members.json"
        if direct_swarm.is_file():
            return conv_id, conv_id, False
        direct_sub_dir = brain_dir / conv_id / ".system_generated" / "subagents"
        if direct_sub_dir.is_dir() and any(direct_sub_dir.glob("*.json")):
            return conv_id, conv_id, False

    cutoff = time.time() - lookback_hours * 3600.0

    # Collect recent swarm members.json sorted by mtime desc using fast os.scandir.
    recent_swarms: list[tuple[float, Path]] = []
    recent_sub_dirs: list[tuple[float, Path, str]] = []
    try:
        with os.scandir(brain_dir) as it:
            for d in it:
                if not d.is_dir(follow_symlinks=False):
                    continue
                mf_str = os.path.join(d.path, ".system_generated", "swarm", "members.json")
                try:
                    st = os.stat(mf_str)
                    if st.st_mtime >= cutoff:
                        recent_swarms.append((st.st_mtime, Path(mf_str)))
                except OSError:
                    pass
                sd_str = os.path.join(d.path, ".system_generated", "subagents")
                try:
                    st_sd = os.stat(sd_str)
                    if st_sd.st_mtime >= cutoff:
                        recent_sub_dirs.append((st_sd.st_mtime, Path(sd_str), d.name))
                except OSError:
                    pass
    except OSError:
        pass
    recent_swarms.sort(key=lambda x: x[0], reverse=True)
    recent_sub_dirs.sort(key=lambda x: x[0], reverse=True)

    if conv_id:
        for _, mf in recent_swarms:
            try:
                data = json.loads(mf.read_text(encoding="utf-8", errors="replace"))
                members = data.get("members") or {}
                coord_id = (
                    (members.get("coordinator") or {}).get("conversation_id")
                    or mf.parent.parent.parent.name
                )
                for m_info in members.values():
                    mcid = str(m_info.get("conversation_id") or "")
                    if mcid and (mcid == conv_id or mcid.startswith(conv_id)):
                        return coord_id, mcid, False
            except (OSError, json.JSONDecodeError):
                continue

        # Reverse lookup in recent subagents/*.json (viewing a subagent's own session)
        for _, sdir, parent_cid in recent_sub_dirs:
            for sf in sdir.glob("*.json"):
                if sf.stem == conv_id or sf.stem.startswith(conv_id):
                    return parent_cid, sf.stem, False

    if latest_fallback:
        if recent_swarms:
            latest_root = recent_swarms[0][1].parent.parent.parent.name
            return latest_root, conv_id or latest_root, True
        for _, sdir, parent_cid in recent_sub_dirs:
            if any(sdir.glob("*.json")):
                return parent_cid, conv_id or parent_cid, True

    return conv_id, conv_id, False


def _normalize_swarm_state(m_info: dict) -> str:
    killed = (
        bool(m_info.get("killed"))
        or str(m_info.get("phase") or "").upper() == "KILLED"
        or str(m_info.get("desired_state") or "").upper() == "KILLED"
    )
    if killed:
        return "killed"
    wake_mode = str(m_info.get("wake_mode") or "").lower()
    if wake_mode == "working":
        return "working"
    phase = str(m_info.get("phase") or "").upper()
    if phase == "RUNNING":
        return "waiting"
    return "idle"


def _normalize_subagent_state(raw_state: str, t_stats: dict) -> str:
    s = (raw_state or "").upper()
    if "KILLED" in s or "DEAD" in s or "STOPPED" in s:
        return "killed"
    if "WORKING" in s or "BUSY" in s:
        return "working"
    # Check if actively mid-turn within last 20 seconds
    last_ep = parse_iso_epoch(t_stats.get("last_step_at") or "")
    if last_ep is not None and (time.time() - last_ep) < 20:
        if t_stats.get("last_step_type") != "PLANNER_RESPONSE" or t_stats.get("last_step_has_tools"):
            return "working"
    return "idle"


def build_radar_report(
    conv_id: str,
    gemini_dir: Path | None = None,
    brain_dir: Path | None = None,
    app_dir: str = "antigravity",
    lookback_hours: float = 72.0,
    latest_fallback: bool = False,
    lang: str = "",
    config_path: Path | str | None = None,
) -> dict:
    t0 = time.perf_counter()
    g_dir = gemini_dir or (Path.home() / ".gemini")
    b_dir = brain_dir or (g_dir / app_dir / "brain")
    c_dir = b_dir.parent / "conversations"

    cfg = load_context_pro_config(gemini_dir=g_dir, config_path=config_path)
    audit_rules = cfg["audit_rules"]
    audit_enabled = bool(audit_rules.get("enabled") is True)
    eff_lang = resolve_effective_lang(cli_lang=lang, cfg_lang=cfg["lang"])

    resolved_input = _resolve_conv_prefix(conv_id, b_dir, c_dir)
    root_id, viewed_cid, is_fallback = _find_root_cluster(
        resolved_input, b_dir, lookback_hours=lookback_hours, latest_fallback=latest_fallback
    )

    if not root_id:
        return {
            "has_cluster": False,
            "audit_enabled": audit_enabled,
            "lang": eff_lang,
            "conversation_id": conv_id,
            "viewed_conv_id": conv_id,
        }

    swarm_dir = b_dir / root_id / ".system_generated" / "swarm"
    members_file = swarm_dir / "members.json"
    swarm_meta_file = swarm_dir / "swarm.json"
    subagents_dir = b_dir / root_id / ".system_generated" / "subagents"

    has_swarm_file = members_file.is_file()
    subagent_files = sorted(subagents_dir.glob("*.json")) if subagents_dir.is_dir() else []

    if not has_swarm_file and not subagent_files:
        return {
            "has_cluster": False,
            "audit_enabled": audit_enabled,
            "lang": eff_lang,
            "conversation_id": viewed_cid or conv_id,
            "viewed_conv_id": viewed_cid or conv_id,
        }

    title = ""
    swarm_created_at = ""
    raw_entries: list[dict] = []
    seen_cids: set[str] = set()

    if swarm_meta_file.is_file():
        try:
            smeta = json.loads(swarm_meta_file.read_text(encoding="utf-8", errors="replace"))
            swarm_created_at = str(smeta.get("created_at") or "")
        except (OSError, json.JSONDecodeError):
            pass

    if has_swarm_file:
        try:
            mdata = json.loads(members_file.read_text(encoding="utf-8", errors="replace"))
        except (OSError, json.JSONDecodeError):
            mdata = {}
        title = str(mdata.get("title") or "")
        members_map = mdata.get("members") or {}

        # Coordinator first, monitor second, then alphabetical roster names
        def _sort_key(item: tuple[str, dict]) -> tuple[int, str]:
            m_name, m_obj = item
            if m_name == "coordinator" or m_obj.get("role") == "coordinator":
                return (0, m_name)
            if m_name == "monitor" or m_name.startswith("monitor"):
                return (1, m_name)
            return (2, m_name)

        for m_name, m_info in sorted(members_map.items(), key=_sort_key):
            if not isinstance(m_info, dict):
                continue
            mcid = str(m_info.get("conversation_id") or "")
            if not mcid:
                continue
            is_coord = m_name == "coordinator" or m_info.get("role") == "coordinator"
            is_mon = not is_coord and (m_name == "monitor" or m_name.startswith("monitor-"))
            kind = "coordinator" if is_coord else ("monitor" if is_mon else "swarm_worker")
            disp_name = "coordinator" if is_coord else f"@{m_name}"
            role_label = "coordinator" if is_coord else ("monitor" if is_mon else str(m_info.get("role") or "worker"))
            raw_entries.append({
                "name": disp_name,
                "raw_name": m_name,
                "role": role_label,
                "kind": kind,
                "conversation_id": mcid,
                "state": _normalize_swarm_state(m_info),
                "applied_model": str(m_info.get("applied_model") or m_info.get("model") or m_info.get("desired_model") or ""),
                "workspace_mode": str(m_info.get("workspace_mode") or "inherit"),
                "subagent_raw_state": "",
            })
            seen_cids.add(mcid)

    # Include non-duplicate invoke_subagent entries
    non_dup_subs: list[dict] = []
    for sf in subagent_files:
        try:
            sdata = json.loads(sf.read_text(encoding="utf-8", errors="replace"))
        except (OSError, json.JSONDecodeError):
            continue
        scid = str(sdata.get("conversationId") or sf.stem)
        if not scid or scid in seen_cids:
            continue
        desc = sdata.get("subagentDescriptor") or {}
        tname = str(desc.get("typeName") or "subagent")
        srole = str(desc.get("role") or tname)
        non_dup_subs.append({
            "name": srole,
            "raw_name": srole,
            "role": tname,
            "kind": "subagent",
            "conversation_id": scid,
            "state": "",
            "applied_model": "",
            "workspace_mode": "inherit",
            "subagent_raw_state": str(sdata.get("state") or ""),
        })
        seen_cids.add(scid)

    # If pure subagent cluster (no swarm/members.json), prepend root session as coordinator
    if not has_swarm_file and non_dup_subs and root_id not in {e["conversation_id"] for e in raw_entries}:
        raw_entries.insert(0, {
            "name": "coordinator",
            "raw_name": "coordinator",
            "role": "coordinator",
            "kind": "coordinator",
            "conversation_id": root_id,
            "state": "",
            "applied_model": "",
            "workspace_mode": "inherit",
            "subagent_raw_state": "SUBAGENT_STATE_ALIVE",
        })

    raw_entries.extend(non_dup_subs)

    if not raw_entries:
        return {
            "has_cluster": False,
            "audit_enabled": audit_enabled,
            "lang": eff_lang,
            "conversation_id": viewed_cid or conv_id,
            "viewed_conv_id": viewed_cid or conv_id,
        }

    members_out: list[dict] = []
    pre_dispatch_steps: int | None = None
    pre_dispatch_seconds: int | None = None

    for entry in raw_entries:
        mcid = entry["conversation_id"]
        is_coord = entry["kind"] == "coordinator"
        t_path = b_dir / mcid / ".system_generated" / "logs" / "transcript.jsonl"
        t_stats = scan_transcript(t_path, is_coordinator=is_coord)
        db_meta = _probe_db_meta(c_dir, mcid)
        if not db_meta["db_model_id"] and entry["applied_model"]:
            slug = entry["applied_model"]
            db_meta["db_model_id"] = slug
            for prefix, win in NATIVE_CONTEXT_WINDOWS:
                if slug.startswith(prefix):
                    db_meta["limit_tokens"] = win
                    break

        # Fallback to DB scan if transcript had 0 turns but DB exists
        if t_stats["turns"] == 0 and db_meta["db_path"] is not None:
            fb = _scan_db_turns_fallback(db_meta["db_path"])
            for k in (
                "turns",
                "current_context",
                "total_input",
                "total_cache_read",
                "total_output",
                "cache_bust_count",
                "cache_bust_tokens",
            ):
                t_stats[k] = fb[k]
            if not t_stats["last_turn_at"] and fb["last_turn_at"]:
                t_stats["last_turn_at"] = fb["last_turn_at"]

        if is_coord:
            pre_dispatch_steps = t_stats["pre_dispatch_steps"]
            pre_dispatch_seconds = t_stats["pre_dispatch_seconds"]
            if not swarm_created_at and t_stats["first_step_at"]:
                swarm_created_at = t_stats["first_step_at"]

        state = entry["state"]
        if not state:
            state = _normalize_subagent_state(entry["subagent_raw_state"], t_stats)
            if is_coord and state == "idle":
                state = "waiting"

        disp_model, raw_model_slug, model_audit = resolve_model_and_audit(
            kind=entry["kind"],
            name=entry["name"],
            role=entry["role"],
            applied_model=entry["applied_model"],
            selected_model=t_stats["selected_model"],
            db_model_id=db_meta["db_model_id"],
            db_model_display=db_meta["db_model_display"],
            audit_rules=audit_rules,
            lang=eff_lang,
        )

        tot_in = t_stats["total_input"]
        tot_cr = t_stats["total_cache_read"]
        tot_prompt = tot_in + tot_cr
        hit_rate = round(tot_cr / tot_prompt * 100.0, 1) if tot_prompt > 0 else 0.0

        members_out.append({
            "name": entry["name"],
            "raw_name": entry["raw_name"],
            "role": entry["role"],
            "kind": entry["kind"],
            "conversation_id": mcid,
            "is_viewed": mcid == viewed_cid,
            "state": state,
            "workspace_mode": entry["workspace_mode"],
            "model": disp_model,
            "base_model": raw_model_slug,
            "applied_model": entry["applied_model"] or db_meta["db_model_id"],
            "selected_model": t_stats["selected_model"],
            "model_audit": model_audit,
            "turns": t_stats["turns"],
            "current_context": t_stats["current_context"],
            "request_budget": db_meta["request_budget"],
            "limit_tokens": db_meta["limit_tokens"],
            "total_input": tot_in,
            "total_cache_read": tot_cr,
            "total_output": t_stats["total_output"],
            "hit_rate": hit_rate,
            "cache_bust_count": t_stats["cache_bust_count"],
            "cache_bust_tokens": t_stats["cache_bust_tokens"],
            "last_turn_at": t_stats["last_turn_at"],
        })

    # Order: coordinator first, then working, waiting/idle, killed
    state_rank = {"working": 1, "waiting": 2, "idle": 3, "killed": 4}
    members_out.sort(
        key=lambda m: (
            0 if m["kind"] == "coordinator" else state_rank.get(m["state"], 5),
            0 if m["kind"] == "monitor" else 1,
            m["name"],
        )
    )

    sum_turns = sum(m["turns"] for m in members_out)
    sum_in = sum(m["total_input"] for m in members_out)
    sum_cr = sum(m["total_cache_read"] for m in members_out)
    sum_out = sum(m["total_output"] for m in members_out)
    sum_prompt = sum_in + sum_cr
    overall_hit_rate = round(sum_cr / sum_prompt * 100.0, 1) if sum_prompt > 0 else 0.0
    sum_bust_cnt = sum(m["cache_bust_count"] for m in members_out)
    sum_bust_tok = sum(m["cache_bust_tokens"] for m in members_out)

    active_cnt = sum(1 for m in members_out if m["state"] != "killed")
    working_cnt = sum(1 for m in members_out if m["state"] == "working")
    waiting_cnt = sum(1 for m in members_out if m["state"] in ("waiting", "idle"))
    killed_cnt = sum(1 for m in members_out if m["state"] == "killed")
    violation_cnt = sum(1 for m in members_out if m["model_audit"]["status"] == "violation")
    warn_cnt = sum(1 for m in members_out if m["model_audit"]["status"] == "warn")
    slow_dispatch = bool(pre_dispatch_seconds is not None and pre_dispatch_seconds > 900)

    cluster_type = "swarm" if has_swarm_file else "subagents"
    if not title:
        if cluster_type == "subagents":
            title = "子代理协作组" if eff_lang == "zh" else "Subagent Cluster"
        else:
            title = f"Swarm {root_id[:8]}"

    elapsed_ms = round((time.perf_counter() - t0) * 1000.0, 1)

    return {
        "has_cluster": True,
        "cluster_type": cluster_type,
        "audit_enabled": audit_enabled,
        "lang": eff_lang,
        "is_historical_fallback": is_fallback,
        "conversation_id": viewed_cid or conv_id,
        "root_id": root_id,
        "viewed_conv_id": viewed_cid or root_id,
        "is_worker_view": bool(viewed_cid and viewed_cid != root_id),
        "title": title,
        "created_at": swarm_created_at,
        "scan_ms": elapsed_ms,
        "summary": {
            "member_count": len(members_out),
            "worker_count": max(0, len(members_out) - 1),
            "active_count": active_cnt,
            "working_count": working_cnt,
            "waiting_count": waiting_cnt,
            "killed_count": killed_cnt,
            "total_turns": sum_turns,
            "total_input": sum_in,
            "total_cache_read": sum_cr,
            "total_output": sum_out,
            "overall_hit_rate": overall_hit_rate,
            "cache_bust_count": sum_bust_cnt,
            "cache_bust_tokens": sum_bust_tok,
            "violation_count": violation_cnt,
            "warn_count": warn_cnt,
            "pre_dispatch_steps": pre_dispatch_steps,
            "pre_dispatch_seconds": pre_dispatch_seconds,
            "slow_dispatch": slow_dispatch,
        },
        "members": members_out,
    }


def _fmt_tok(n: int) -> str:
    if n >= 1_000_000:
        v = n / 1_000_000.0
        return f"{v:.0f}M" if v.is_integer() else f"{v:.2f}M"
    if n >= 1_000:
        return f"{n / 1_000.0:.1f}k"
    return str(n)


def render_text(report: dict) -> str:
    if not report.get("has_cluster"):
        return f"No swarm or subagent cluster found for conversation: {report.get('conversation_id')}\n"
    s = report["summary"]
    lines = [
        f"└ Swarm Radar · {report['title']} ({report['cluster_type']})",
        f"  Root: {report['root_id']} | Viewed: {report['viewed_conv_id']} | Scan: {report['scan_ms']}ms",
        f"  Members: {s['active_count']}/{s['member_count']} active ({s['working_count']} working, {s['killed_count']} killed)",
        f"  Turns: {s['total_turns']} | Hit Rate: {s['overall_hit_rate']}% | Cache Busts: {s['cache_bust_count']} ({_fmt_tok(s['cache_bust_tokens'])})",
    ]
    if s["pre_dispatch_steps"] is not None:
        flag = " [SLOW >15m]" if s["slow_dispatch"] else ""
        lines.append(f"  Pre-Dispatch Overhead: {s['pre_dispatch_steps']} steps · {s['pre_dispatch_seconds']}s{flag}")
    lines.append("")
    audit_on = bool(report.get("audit_enabled"))
    for m in report["members"]:
        audit_suffix = f" ({m['model_audit']['label']})" if audit_on else ""
        lines.append(
            f"  [{m['state']:7s}] {m['name']:24s} | {m['model']:28s}{audit_suffix} | "
            f"ctx {_fmt_tok(m['current_context']):>7s} | {m['turns']:3d}t | hit {m['hit_rate']:5.1f}% | "
            f"bust {m['cache_bust_count']:2d} ({_fmt_tok(m['cache_bust_tokens'])})"
        )
    return "\n".join(lines) + "\n"


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    parser = argparse.ArgumentParser(description="Antigravity Swarm & Subagent Panoramic Cache Radar.")
    parser.add_argument("conv_id", nargs="?", default="", help="Conversation UUID or short prefix")
    parser.add_argument("--conversation-id", dest="opt_conv_id", default="", help="Conversation UUID (optional flag form)")
    parser.add_argument("--gemini-dir", default="", help="Path to ~/.gemini directory")
    parser.add_argument("--brain-dir", default="", help="Path to ~/.gemini/antigravity/brain directory")
    parser.add_argument("--app-dir", default="antigravity", help="App folder under ~/.gemini (default: antigravity)")
    parser.add_argument("--config", default="", help="Path to context-pro-config.json (overrides AGY_CONTEXT_PRO_CONFIG)")
    parser.add_argument("--lang", choices=["auto", "zh", "en"], default="", help="Label language (zh, en, or auto)")
    parser.add_argument("--lookback-hours", type=float, default=72.0, help="Hours to scan for reverse worker lookup")
    parser.add_argument("--latest-fallback", action="store_true", help="Fallback to most recent cluster if current has none")
    parser.add_argument("--json", action="store_true", help="Output JSON")
    args = parser.parse_args()

    target_cid = args.conv_id or args.opt_conv_id
    g_dir = Path(args.gemini_dir).expanduser() if args.gemini_dir else None
    b_dir = Path(args.brain_dir).expanduser() if args.brain_dir else None
    c_path = Path(args.config).expanduser() if args.config else None

    rep = build_radar_report(
        target_cid,
        gemini_dir=g_dir,
        brain_dir=b_dir,
        app_dir=args.app_dir,
        lookback_hours=args.lookback_hours,
        latest_fallback=args.latest_fallback and not bool(target_cid) or args.latest_fallback,
        lang=args.lang,
        config_path=c_path,
    )
    if args.json:
        print(json.dumps(rep, ensure_ascii=False, indent=2))
    else:
        print(render_text(rep), end="")


if __name__ == "__main__":
    main()
