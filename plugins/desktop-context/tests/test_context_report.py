"""End-to-end tests for the panel's parser (sidecars/context/context_report.py) on synthetic conversation databases.

Run with: python -m unittest discover tests
"""

import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parent.parent / "sidecars" / "context" / "context_report.py"
SWARM_SCRIPT = Path(__file__).resolve().parent.parent / "sidecars" / "context" / "swarm_radar.py"

spec = importlib.util.spec_from_file_location("context_report", SCRIPT)
context_report = importlib.util.module_from_spec(spec)
spec.loader.exec_module(context_report)

swarm_spec = importlib.util.spec_from_file_location("swarm_radar", SWARM_SCRIPT)
swarm_radar = importlib.util.module_from_spec(swarm_spec)
swarm_spec.loader.exec_module(swarm_radar)

# --- protobuf encoding -------------------------------------------------------


def varint(n: int) -> bytes:
    n &= 0xFFFFFFFFFFFFFFFF
    out = b""
    while True:
        b = n & 0x7F
        n >>= 7
        if n:
            out += bytes([b | 0x80])
        else:
            return out + bytes([b])


def f(fn: int, val) -> bytes:
    if isinstance(val, int):
        return varint(fn << 3) + varint(val)
    if isinstance(val, str):
        val = val.encode()
    return varint(fn << 3 | 2) + varint(len(val)) + val


def m(*parts: bytes) -> bytes:
    return b"".join(parts)


# --- database builder --------------------------------------------------------


class ConversationDB:
    def __init__(self, path: Path):
        self.conn = sqlite3.connect(path)
        self.conn.execute(
            "CREATE TABLE steps (idx integer, step_type integer NOT NULL DEFAULT 0, status integer NOT NULL DEFAULT 0, "
            "has_subtrajectory numeric NOT NULL DEFAULT false, metadata blob, error_details blob, permissions blob, "
            "task_details blob, render_info blob, step_payload blob, step_format integer NOT NULL DEFAULT 0, PRIMARY KEY (idx))"
        )
        self.conn.execute("CREATE TABLE gen_metadata (idx integer, data blob, size integer NOT NULL DEFAULT 0, PRIMARY KEY (idx))")
        self.n = 0

    def step(self, step_type: int, metadata: bytes = b"", payload_field: int | None = None, payload: bytes = b"", status: int = 3):
        pb = m(f(1, step_type), f(4, status), f(5, metadata), f(payload_field, payload) if payload_field else b"")
        self.conn.execute(
            "INSERT INTO steps (idx, step_type, status, metadata, step_payload) VALUES (?, ?, ?, ?, ?)",
            (self.n, step_type, status, metadata, pb),
        )
        self.n += 1

    def generation(self, groups: list[bytes], max_context: int = 1_000_000, usage: bytes = b"", checkpoint_index: int = -1,
                   model: str = "test-model", display_name: str = "Test Model"):
        cwm = m(f(1, 0), f(3, m(*[f(1, g) for g in groups])), f(4, max_context))
        chat = m(f(4, usage), f(9, m(f(2, checkpoint_index), f(10, cwm))), f(21, display_name) if display_name else b"")
        data = m(f(1, chat), f(3, f(28, model)))
        self.conn.execute("INSERT INTO gen_metadata (idx, data) VALUES ((SELECT COUNT(*) FROM gen_metadata), ?)", (data,))

    def close(self):
        if self.conn is not None:
            self.conn.commit()
            self.conn.close()
            self.conn = None


def group(token_type: int, tokens: int, *children: tuple[str, int], name: str = "group") -> bytes:
    return m(f(1, name), f(2, token_type), f(4, tokens), *[f(5, m(f(1, n), f(3, t))) for n, t in children])


def user_input(text: str) -> bytes:
    return f(2, text)


def planner(text: str) -> bytes:
    return f(1, text)


def usage(input_tokens: int = 0, output: int = 0, cache_read: int = 0) -> bytes:
    return m(f(2, input_tokens), f(3, output), f(5, cache_read))


def tool_call(args: str) -> bytes:
    return f(4, m(f(2, "tool"), f(3, args)))


# Step types and payload fields used below.
USER_INPUT, PLANNER_RESPONSE, CHECKPOINT, FINISH, VIEW_FILE, CODE_ACTION, GENERIC = 14, 15, 23, 2, 8, 5, 132
P_USER, P_PLANNER, P_CHECKPOINT, P_VIEW_FILE, P_CODE_ACTION = 19, 20, 30, 14, 10


class ReportTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.home = Path(self.tmp.name)
        self.db_path = self.home / "conv.db"
        self.db = ConversationDB(self.db_path)

    def tearDown(self):
        self.tmp.cleanup()

    def run_report(self, *args: str) -> str:
        self.db.close()
        env = dict(os.environ, HOME=str(self.home), USERPROFILE=str(self.home), PYTHONIOENCODING="utf-8")
        res = subprocess.run(
            [sys.executable, str(SCRIPT), "--db", str(self.db_path), *args],
            capture_output=True, env=env, text=True, encoding="utf-8", check=True,
        )
        return res.stdout

    def report(self, *args: str) -> dict:
        data = json.loads(self.run_report("--json", *args))
        data["by_name"] = {c["name"]: c["tokens"] for c in data["categories"]}
        return data

    def basic_steps(self):
        self.db.step(USER_INPUT, payload_field=P_USER, payload=user_input("hello world!!"))  # 13 bytes -> 3
        self.db.step(PLANNER_RESPONSE, metadata=f(9, usage(900, 50)), payload_field=P_PLANNER, payload=planner("r" * 400))
        self.db.step(GENERIC, metadata=tool_call("a" * 40))  # 40 bytes -> 10

    # --- breakdown from the latest generation ---

    def test_exact_breakdown_from_chat_items(self):
        self.basic_steps()
        self.db.generation([
            group(1, 1000, ("skills", 200), ("user_rules", 50), ("subagents", 30), ("flows", 20)),
            group(2, 500),
            group(3, 30),
            group(4, 40),
            group(7, 370, ("0: USER_INPUT", 20), ("1: PLANNER_RESPONSE", 200), ("2: GENERIC", 80),
                  ("3: FINISH", 30), ("4: CHECKPOINT", 40)),
            group(8, 11),
            group(9, 12),
            group(10, 13),
        ])
        r = self.report()
        c = r["by_name"]
        self.assertEqual(c["User messages"], 20)
        self.assertEqual(c["Agent responses"], 240)  # planner + checkpoint
        self.assertEqual(c["Tool calls"], 80)
        self.assertEqual(c["System messages"], 30)  # FINISH
        self.assertEqual(c["System prompt"], 750)  # user_rules stays in the system prompt
        self.assertEqual(c["Skills"], 200)
        self.assertEqual(c["Subagents"], 30)
        self.assertEqual(c["Workflows"], 33)  # flows item + FLOWS group
        self.assertEqual(c["Legacy workflows"], 11)
        self.assertEqual(c["Plugins"], 12)
        self.assertEqual(c["Rules"], 30)
        self.assertEqual(c["MCP tools"], 40)
        self.assertNotIn("System overhead", c)
        self.assertEqual(r["used_tokens"], sum(v for v in c.values()))
        self.assertEqual(r["limit_tokens"], 1_000_000)
        self.assertTrue(r["has_breakdown"])

    def test_latest_generation_wins_over_larger_one(self):
        self.basic_steps()
        self.db.generation([group(1, 90000), group(7, 10, ("0: USER_INPUT", 10))])
        self.db.generation([group(1, 100), group(7, 10, ("0: USER_INPUT", 10))])
        self.assertEqual(self.report()["by_name"]["System prompt"], 100)

    def test_unknown_item_scales_step_estimates(self):
        self.basic_steps()
        self.db.generation([group(7, 315, ("0: USER_INPUT", 20), ("1: NOT_A_STEP_TYPE", 1))])
        c = self.report()["by_name"]
        # Step estimates 3 / 50 / 10 scaled by 315 / 63 = 5.
        self.assertEqual((c["User messages"], c["Agent responses"], c["Tool calls"]), (15, 250, 50))

    def test_overhead_only_without_prompt_or_tools(self):
        self.basic_steps()
        self.db.generation([group(7, 300, ("0: USER_INPUT", 300))], usage=usage(1000, 0, 500))
        self.assertEqual(self.report()["by_name"]["System overhead"], 1200)

    def test_no_overhead_with_system_prompt(self):
        self.basic_steps()
        self.db.generation([group(1, 100), group(7, 300, ("0: USER_INPUT", 300))], usage=usage(1000, 0, 500))
        self.assertNotIn("System overhead", self.report()["by_name"])

    # --- estimates without a breakdown ---

    def test_awaiting_generation_uses_step_estimates(self):
        self.basic_steps()
        self.db.step(FINISH, metadata=tool_call("b" * 8))
        r = self.report()
        c = r["by_name"]
        self.assertFalse(r["has_breakdown"])
        self.assertEqual((c["User messages"], c["Agent responses"], c["Tool calls"], c["System messages"]), (3, 50, 10, 2))
        self.assertEqual(r["limit_tokens"], 0)
        self.assertIn("Estimated usage (awaiting generation)", self.run_report())

    def test_tool_call_output_tokens_take_precedence(self):
        self.db.step(GENERIC, metadata=m(tool_call("a" * 400), f(23, 7)))
        self.assertEqual(self.report()["by_name"]["Tool calls"], 7)

    # --- compaction ---

    def test_compaction_zeroes_summarized_steps(self):
        self.basic_steps()
        self.db.step(CHECKPOINT, payload_field=P_CHECKPOINT,
                     payload=m(f(1, 0), f(11, 0), f(12, 2), f(4, "Fix the login bug"), f(5, "s" * 383)))
        self.db.step(USER_INPUT, payload_field=P_USER, payload=user_input("next question please"))  # 20 -> 5
        self.db.generation([group(1, 800), group(7, 370, ("0: USER_INPUT", 370))])
        r = self.report()
        c = r["by_name"]
        self.assertTrue(r["compacted"])
        self.assertEqual(c["User messages"], 5)
        self.assertEqual(c["Agent responses"], 100)  # (17 + 383) / 4 summary estimate
        self.assertEqual(c["Tool calls"], 0)
        self.assertEqual(c["System prompt"], 800)
        self.assertEqual(r["active_checkpoint"], 0)
        out = self.run_report()
        self.assertIn("Estimated after compaction · updates next turn", out)
        self.assertIn("Checkpoints (1) · /rewind", out)
        self.assertIn("└ Checkpoint 1 (active, in context): Fix the login bug", out)

    def test_checkpoint_already_in_generation_is_not_newer(self):
        self.basic_steps()
        self.db.step(CHECKPOINT, payload_field=P_CHECKPOINT, payload=m(f(1, 0), f(11, 0), f(12, 2)))
        self.db.generation([group(7, 10, ("0: USER_INPUT", 10))], checkpoint_index=0)
        r = self.report()
        self.assertFalse(r["compacted"])
        self.assertIn("steps 0–2", self.run_report())

    def test_checkpoint_buffer_counts_checkpoint_steps(self):
        self.db.step(CHECKPOINT, metadata=tool_call("c" * 80), payload_field=P_CHECKPOINT, payload=f(1, 0))
        self.db.step(PLANNER_RESPONSE, metadata=f(9, usage(0, 5)), payload_field=P_PLANNER, payload=planner("x"))
        r = self.report()
        self.assertEqual(r["checkpoint_buffer"], 20)
        self.assertNotIn(20, [v for k, v in r["by_name"].items()])

    def test_telemetry_turns_curve(self):
        self.basic_steps()
        self.db.generation([group(7, 300, ("0: USER_INPUT", 300))], usage=usage(input_tokens=1000, output=150))
        self.db.generation([group(7, 500, ("0: USER_INPUT", 300), ("1: AGENT", 200))], usage=usage(input_tokens=1500, output=200))
        r = self.report()
        tel = r.get("telemetry", {})
        self.assertEqual(tel["total_calls"], 2)
        curve = tel.get("turns_curve", [])
        self.assertEqual(len(curve), 2)
        self.assertEqual(curve[0]["step"], 0)
        self.assertEqual(curve[0]["prompt_tokens"], 1000)
        self.assertEqual(curve[1]["step"], 1)
        self.assertEqual(curve[1]["prompt_tokens"], 1500)
        self.assertEqual(curve[1]["context_delta"], 500)

    # --- files ---

    def test_file_sections(self):
        home_uri = "file:///" + str(self.home).replace("\\", "/").lstrip("/")
        self.db.step(VIEW_FILE, metadata=tool_call("v" * 40), payload_field=P_VIEW_FILE,
                     payload=m(f(1, home_uri + "/.gemini/skills/foo/SKILL.md"), f(17, 1)))
        edit = lambda path: f(2, f(1, f(8, home_uri + path)))  # noqa: E731
        self.db.step(CODE_ACTION, metadata=tool_call("w" * 80), payload_field=P_CODE_ACTION, payload=m(edit("/brain/task.md"), f(21, 1)))
        self.db.step(CODE_ACTION, metadata=tool_call("w" * 80), payload_field=P_CODE_ACTION, payload=m(edit("/brain/task.md"), f(21, 1)))
        self.db.step(CODE_ACTION, metadata=tool_call("k" * 40), payload_field=P_CODE_ACTION, payload=m(edit("/knowledge/a.md"), f(24, 1)))
        (self.home / ".gemini" / "skills").mkdir(parents=True)
        (self.home / ".gemini" / "GEMINI.md").write_text("x")
        (self.home / ".gemini" / "antigravity" / "skills").mkdir(parents=True)
        (self.home / ".gemini" / "config" / "skills").mkdir(parents=True)  # not an auto-loaded folder
        (self.home / "ws" / ".agents" / "rules").mkdir(parents=True)
        (self.home / "ws" / ".agents" / "hooks.json").write_text("{}")
        r = self.report("--workspace", str(self.home / "ws"))
        self.assertEqual(r["skill_files"], [{"path": "~/.gemini/skills/foo/SKILL.md", "tokens": 10}])
        self.assertEqual(r["artifact_files"], [{"path": "~/brain/task.md", "tokens": 20}])
        self.assertEqual(r["knowledge_files"], [{"path": "~/knowledge/a.md", "tokens": 10}])
        self.assertEqual([s["path"] for s in r["system_files"]],
                         ["~/.gemini/GEMINI.md", "~/.gemini/skills/", "~/.gemini/antigravity/skills/",
                          ".agents/rules/", ".agents/hooks.json"])
        out = self.run_report("--workspace", str(self.home / "ws"))
        self.assertIn("Knowledge files · /rules\n └ ~/knowledge/a.md: 10 tokens", out)
        self.assertIn("System files · auto-loaded\n └ ~/.gemini/GEMINI.md\n", out)

    def test_generic_steps_are_rehydrated(self):
        home_uri = "file:///" + str(self.home).replace("\\", "/").lstrip("/")
        # Desktop app: a write wrapped in a GENERIC step that packs the original code_action step.
        original = m(f(1, CODE_ACTION), f(4, 3), f(5, tool_call("w" * 80)),
                     f(P_CODE_ACTION, m(f(2, f(1, f(8, home_uri + "/brain/plan.md"))), f(21, 1))))
        packed = m(f(1, "type.googleapis.com/gemini_coder.Step"), f(2, original))
        self.db.step(GENERIC, metadata=tool_call("ignored"), payload_field=140, payload=f(2, f(6, packed)))
        # A GENERIC view_file with no packed original: rebuilt from the tool call arguments.
        args = json.dumps({"AbsolutePath": str(self.home / "skills" / "x" / "SKILL.md")})
        self.db.step(GENERIC, metadata=f(4, m(f(2, "view_file"), f(3, args))), payload_field=140, payload=f(2, b""))
        r = self.report()
        self.assertEqual(r["artifact_files"], [{"path": "~/brain/plan.md", "tokens": 20}])
        self.assertEqual(r["skill_files"], [{"path": "~/skills/x/SKILL.md", "tokens": len(args) // 4}])

    # --- model label and context limit ---

    def test_native_window_and_label_from_model_id(self):
        self.basic_steps()
        self.db.generation([group(7, 300, ("0: USER_INPUT", 300))], max_context=256_000,
                           model="gemini-3.8-flash-medium", display_name="")
        r = self.report()
        self.assertEqual(r["model"], "Gemini 3.8 Flash (Medium)")
        self.assertEqual(r["limit_tokens"], 1_048_576)
        self.assertEqual(r["request_budget_tokens"], 256_000)
        self.assertIn("Gemini 3.8 Flash (Medium) · 300/1.0M tokens", self.run_report())

    def test_model_catalog_overrides_table(self):
        self.basic_steps()
        self.db.generation([group(1, 100), group(7, 300, ("0: USER_INPUT", 300))],
                           model="gemini-9-test-high", display_name="")
        catalog = self.home / "catalog.json"
        catalog.write_text(json.dumps({"gemini-9-test-high": {"maxTokens": 2_000_000, "displayName": "Gemini 9 Test (High)"}}))
        r = self.report("--model-catalog", str(catalog))
        self.assertEqual((r["model"], r["limit_tokens"]), ("Gemini 9 Test (High)", 2_000_000))
        self.assertEqual(r["heading"], "Token usage by category")
        self.assertEqual(r["grid_segments"], [100, 300, 0, 0, 0])
        self.assertTrue(r["text"].startswith("└ Context Usage"))
        self.assertIn("Gemini 9 Test (High) · 400/2M tokens", r["text"])

    def test_unknown_model_falls_back_to_request_budget(self):
        self.basic_steps()
        self.db.generation([group(7, 300, ("0: USER_INPUT", 300))], max_context=256_000, model="new-model-x", display_name="")
        r = self.report()
        self.assertEqual((r["model"], r["limit_tokens"]), ("New Model X", 256_000))

    # --- rendering ---

    def test_text_layout(self):
        self.basic_steps()
        self.db.generation([group(1, 1000), group(7, 300, ("0: USER_INPUT", 300))], max_context=256_000)
        out = self.run_report()
        lines = out.splitlines()
        self.assertEqual(lines[0], "└ Context Usage")
        self.assertTrue(lines[2].endswith("Test Model · 1.3k/256.0k tokens"))
        self.assertIn("◉ Agent responses: 0 tokens (0.0%)", out)  # always shown
        self.assertNotIn("Plugins", out)  # zero, hidden
        self.assertTrue(out.rstrip().endswith("Related: /artifact · /skill · /rewind"))
        grid_rows = [l for l in lines if l.startswith(("◉", "□"))]
        self.assertEqual(len(grid_rows[0].split("   ")[0].split(" ")), 20)  # 20 columns at width 100

    def test_limit_override_and_narrow_layout(self):
        self.basic_steps()
        self.db.generation([group(7, 300, ("0: USER_INPUT", 300))])
        out = self.run_report("--limit", "200000", "--width", "60")
        lines = out.splitlines()
        self.assertEqual(lines[2], "Test Model · 300/200.0k tokens")  # stats above the grid
        self.assertTrue(lines[-3].startswith("□"))

    def test_cache_bust_ledger_and_db_timestamp(self):
        # Turn 0: initial 35k prompt (no prev -> not a bust)
        # Turn 1: warm cache hit 35k cache + 2k fresh = 37k (not a bust)
        # Turn 2: zero-cache rebuild 0 cache + 40k fresh = 40k (>= 37k*0.8 -> BUST #1, +40k)
        # Turn 3: compaction drop 0 cache + 20k fresh = 20k (< 40k*0.8 -> NOT a bust)
        # Turn 4: warm up to 60k (55k cache + 5k fresh)
        # Turn 5: extreme cliff 1k cache (< 60k*0.05=3k) + 59k fresh (>= 50k) = 60k -> BUST #2, +59k
        ts_epoch = 1794823331  # 2026-11-16T10:02:11Z
        md_with_ts_and_gm5 = m(f(1, f(1, ts_epoch)), f(9, usage(59000, 120, 1000)), f(20, f(3, 5)))
        self.db.step(USER_INPUT, payload_field=P_USER, payload=user_input("start"))
        self.db.step(PLANNER_RESPONSE, metadata=md_with_ts_and_gm5, payload_field=P_PLANNER, payload=planner("ok"))

        self.db.generation([group(7, 300, ("0: USER_INPUT", 300))], usage=usage(input_tokens=35_000, output=100, cache_read=0))
        self.db.generation([group(7, 300, ("0: USER_INPUT", 300))], usage=usage(input_tokens=2_000, output=100, cache_read=35_000))
        self.db.generation([group(7, 300, ("0: USER_INPUT", 300))], usage=usage(input_tokens=40_000, output=100, cache_read=0))
        self.db.generation([group(7, 300, ("0: USER_INPUT", 300))], usage=usage(input_tokens=20_000, output=100, cache_read=0))
        self.db.generation([group(7, 300, ("0: USER_INPUT", 300))], usage=usage(input_tokens=5_000, output=100, cache_read=55_000))
        self.db.generation([group(7, 300, ("0: USER_INPUT", 300))], usage=usage(input_tokens=59_000, output=100, cache_read=1_000))

        r = self.report()
        self.assertEqual(r["cache_bust_count"], 2)
        self.assertEqual(r["cache_bust_tokens"], 99_000)
        self.assertEqual(r["last_turn_at"], "2026-11-16T10:02:11Z")
        curve = r["telemetry"]["turns_curve"]
        self.assertEqual([t["cache_bust"] for t in curve], [False, False, True, False, False, True])

    def test_last_turn_at_falls_back_to_transcript_jsonl(self):
        self.basic_steps()
        self.db.generation([group(7, 300, ("0: USER_INPUT", 300))], usage=usage(input_tokens=1000, output=50))
        logs_dir = self.home / ".gemini" / "antigravity" / "brain" / "conv" / ".system_generated" / "logs"
        logs_dir.mkdir(parents=True)
        (logs_dir / "transcript.jsonl").write_text(
            json.dumps({"step_index": 0, "type": "USER_INPUT", "created_at": "2026-11-16T08:00:00Z"}) + "\n"
            + json.dumps({"step_index": 1, "type": "PLANNER_RESPONSE", "created_at": "2026-11-16T08:05:30Z", "input_tokens": 1000, "cache_read_tokens": 0, "output_tokens": 50}) + "\n",
            encoding="utf-8",
        )
        r = self.report()
        self.assertEqual(r["last_turn_at"], "2026-11-16T08:05:30Z")


class SwarmRadarTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.gemini = self.root / ".gemini"
        self.brain = self.gemini / "antigravity" / "brain"
        self.convs = self.gemini / "antigravity" / "conversations"
        self.brain.mkdir(parents=True)
        self.convs.mkdir(parents=True)
        self._prev_cfg_env = os.environ.pop("AGY_CONTEXT_PRO_CONFIG", None)

    def tearDown(self):
        if self._prev_cfg_env is None:
            os.environ.pop("AGY_CONTEXT_PRO_CONFIG", None)
        else:
            os.environ["AGY_CONTEXT_PRO_CONFIG"] = self._prev_cfg_env
        self.tmp.cleanup()

    def _write_transcript(self, cid: str, lines: list[dict]):
        p = self.brain / cid / ".system_generated" / "logs" / "transcript.jsonl"
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text("\n".join(json.dumps(x, ensure_ascii=False) for x in lines) + "\n", encoding="utf-8")

    def _seed_synthetic_cluster(self) -> dict[str, str]:
        coord_id = "11111111-1111-4111-8111-111111111111"
        worker_id = "22222222-2222-4222-8222-222222222222"
        final_id = "33333333-3333-4333-8333-333333333333"
        legacy_id = "44444444-4444-4444-8444-444444444444"
        sub_id = "55555555-5555-4555-8555-555555555555"

        swarm_dir = self.brain / coord_id / ".system_generated" / "swarm"
        swarm_dir.mkdir(parents=True)
        (swarm_dir / "members.json").write_text(json.dumps({
            "title": "Synthetic Test Swarm",
            "members": {
                "coordinator": {
                    "conversation_id": coord_id,
                    "role": "coordinator",
                    "phase": "RUNNING",
                    "wake_mode": "anything",
                    "killed": False,
                    "applied_model": "gemini-flash-worker-agy",
                },
                "worker-alpha": {
                    "conversation_id": worker_id,
                    "role": "worker",
                    "phase": "RUNNING",
                    "wake_mode": "working",
                    "killed": False,
                    "applied_model": "gemini-4-hydrogen-high",
                    "workspace_mode": "share",
                },
                "final-reviewer": {
                    "conversation_id": final_id,
                    "role": "worker",
                    "phase": "RUNNING",
                    "wake_mode": "mentions",
                    "killed": False,
                    "applied_model": "gemini-4-carbon-medium",
                },
                "legacy-worker": {
                    "conversation_id": legacy_id,
                    "role": "worker",
                    "phase": "KILLED",
                    "wake_mode": "working",
                    "killed": True,
                    "applied_model": "gemini-3.8-flash-medium",
                },
            },
        }), encoding="utf-8")

        sub_dir = self.brain / coord_id / ".system_generated" / "subagents"
        sub_dir.mkdir(parents=True)
        (sub_dir / f"{worker_id}.json").write_text(json.dumps({
            "conversationId": worker_id,
            "subagentDescriptor": {"typeName": "worker", "role": "Swarm Worker (worker-alpha)"},
            "state": "SUBAGENT_STATE_ALIVE",
        }), encoding="utf-8")
        (sub_dir / f"{sub_id}.json").write_text(json.dumps({
            "conversationId": sub_id,
            "subagentDescriptor": {"typeName": "research", "role": "Wave 1 Code Researcher"},
            "state": "SUBAGENT_STATE_ALIVE",
        }), encoding="utf-8")

        sub_db = ConversationDB(self.convs / f"{sub_id}.db")
        sub_db.generation([group(7, 100, ("0: USER_INPUT", 100))], model="gemini-4-carbon-high", display_name="Gemini 4 Carbon (High)")
        sub_db.close()

        self._write_transcript(coord_id, [
            {"step_index": 0, "type": "USER_INPUT", "created_at": "2026-11-16T08:00:00Z",
             "content": "The user changed setting `Model Selection` from None to Orchestrator (Carbon)."},
            {"step_index": 1, "type": "PLANNER_RESPONSE", "created_at": "2026-11-16T08:01:00Z",
             "input_tokens": 35000, "cache_read_tokens": 0, "output_tokens": 500},
            {"step_index": 2, "type": "GENERIC", "created_at": "2026-11-16T08:10:00Z"},
            {"step_index": 3, "type": "PLANNER_RESPONSE", "created_at": "2026-11-16T08:20:00Z",
             "input_tokens": 38000, "cache_read_tokens": 0, "output_tokens": 600,
             "tool_calls": [{"name": "swarm", "args": {"action": "add"}}]},
        ])
        self._write_transcript(worker_id, [
            {"step_index": 0, "type": "PLANNER_RESPONSE", "created_at": "2026-11-16T08:21:00Z",
             "input_tokens": 32000, "cache_read_tokens": 0, "output_tokens": 400},
            {"step_index": 1, "type": "PLANNER_RESPONSE", "created_at": "2026-11-16T08:22:00Z",
             "input_tokens": 3000, "cache_read_tokens": 32000, "output_tokens": 300},
        ])
        self._write_transcript(final_id, [
            {"step_index": 0, "type": "PLANNER_RESPONSE", "created_at": "2026-11-16T08:25:00Z",
             "input_tokens": 40000, "cache_read_tokens": 0, "output_tokens": 800},
        ])
        self._write_transcript(legacy_id, [
            {"step_index": 0, "type": "PLANNER_RESPONSE", "created_at": "2026-11-16T08:23:00Z",
             "input_tokens": 10000, "cache_read_tokens": 0, "output_tokens": 200},
        ])
        self._write_transcript(sub_id, [
            {"step_index": 0, "type": "PLANNER_RESPONSE", "created_at": "2026-11-16T08:24:00Z",
             "input_tokens": 25000, "cache_read_tokens": 0, "output_tokens": 350},
        ])
        return {
            "coord": coord_id,
            "worker": worker_id,
            "final": final_id,
            "legacy": legacy_id,
            "sub": sub_id,
        }

    def test_swarm_default_open_source_mode_has_no_hardcoded_audit_and_supports_lang(self):
        ids = self._seed_synthetic_cluster()

        # Default (no context-pro-config.json): audit_enabled=False, zero hardcoded 3.8/Carbon blocks, English OK labels.
        rep = swarm_radar.build_radar_report("22222222", gemini_dir=self.gemini)
        self.assertTrue(rep["has_cluster"])
        self.assertFalse(rep["audit_enabled"])
        self.assertEqual(rep["lang"], "en")
        self.assertEqual(rep["root_id"], ids["coord"])
        self.assertEqual(rep["viewed_conv_id"], ids["worker"])
        self.assertTrue(rep["is_worker_view"])

        s = rep["summary"]
        self.assertEqual(s["member_count"], 5)
        self.assertEqual(s["active_count"], 4)
        self.assertEqual(s["working_count"], 1)
        self.assertEqual(s["killed_count"], 1)
        self.assertEqual(s["cache_bust_count"], 1)
        self.assertEqual(s["cache_bust_tokens"], 38000)
        self.assertEqual(s["pre_dispatch_steps"], 3)
        self.assertEqual(s["pre_dispatch_seconds"], 1200)
        self.assertTrue(s["slow_dispatch"])
        self.assertEqual(s["violation_count"], 0)
        self.assertEqual(s["warn_count"], 0)

        by_cid = {m["conversation_id"]: m for m in rep["members"]}
        self.assertEqual(by_cid[ids["coord"]]["model"], "Orchestrator (Carbon) [flash-worker]")
        for cid in ids.values():
            self.assertEqual(
                by_cid[cid]["model_audit"],
                {"status": "ok", "label": "OK", "audit_enabled": False},
            )
        self.assertEqual(by_cid[ids["worker"]]["state"], "working")
        self.assertTrue(by_cid[ids["worker"]]["is_viewed"])
        self.assertEqual(by_cid[ids["legacy"]]["state"], "killed")

        # Chinese label mode without audit enabled -> returns "正常"
        rep_zh = swarm_radar.build_radar_report("22222222", gemini_dir=self.gemini, lang="zh")
        self.assertFalse(rep_zh["audit_enabled"])
        self.assertEqual(rep_zh["lang"], "zh")
        for m_obj in rep_zh["members"]:
            self.assertEqual(
                m_obj["model_audit"],
                {"status": "ok", "label": "正常", "audit_enabled": False},
            )

    def test_swarm_custom_audit_rules_via_env_override_and_bilingual_cli(self):
        ids = self._seed_synthetic_cluster()
        cfg_file = self.root / "custom-context-pro-config.json"
        cfg_file.write_text(json.dumps({
            "lang": "zh",
            "audit_rules": {
                "enabled": True,
                "forbidden_patterns": ["3.8", "deprecated-x"],
                "forbidden_label": {"zh": "禁用模型", "en": "Blocked"},
                "warn_worker_patterns": ["carbon", "opus"],
                "safe_worker_patterns": ["hydrogen", "flash-worker"],
                "exempt_role_keywords": ["final", "auditor"],
                "warn_label": {"zh": "超规模型", "en": "Over-tier"},
                "ok_label": {"zh": "合规", "en": "Compliant"},
            },
        }, ensure_ascii=False), encoding="utf-8")
        os.environ["AGY_CONTEXT_PRO_CONFIG"] = str(cfg_file)

        # Auto-reads lang="zh" and audit_rules from AGY_CONTEXT_PRO_CONFIG
        rep_zh = swarm_radar.build_radar_report("22222222", gemini_dir=self.gemini)
        self.assertTrue(rep_zh["audit_enabled"])
        self.assertEqual(rep_zh["lang"], "zh")
        self.assertEqual(rep_zh["summary"]["violation_count"], 1)
        self.assertEqual(rep_zh["summary"]["warn_count"], 1)

        by_zh = {m["conversation_id"]: m for m in rep_zh["members"]}
        self.assertEqual(by_zh[ids["coord"]]["model_audit"], {"status": "ok", "label": "合规", "audit_enabled": True})
        self.assertEqual(by_zh[ids["worker"]]["model_audit"], {"status": "ok", "label": "合规", "audit_enabled": True})
        self.assertEqual(by_zh[ids["final"]]["model_audit"], {"status": "ok", "label": "合规", "audit_enabled": True})
        self.assertEqual(by_zh[ids["legacy"]]["model_audit"], {"status": "violation", "label": "禁用模型", "audit_enabled": True})
        self.assertEqual(by_zh[ids["sub"]]["model_audit"], {"status": "warn", "label": "超规模型", "audit_enabled": True})

        # End-to-end CLI invocation with --lang en override
        env = dict(os.environ, AGY_CONTEXT_PRO_CONFIG=str(cfg_file), PYTHONIOENCODING="utf-8")
        proc = subprocess.run(
            [sys.executable, str(SWARM_SCRIPT), "22222222", "--gemini-dir", str(self.gemini), "--lang", "en", "--json"],
            capture_output=True, text=True, encoding="utf-8", env=env, check=True,
        )
        rep_en = json.loads(proc.stdout)
        self.assertTrue(rep_en["audit_enabled"])
        self.assertEqual(rep_en["lang"], "en")
        by_en = {m["conversation_id"]: m for m in rep_en["members"]}
        self.assertEqual(by_en[ids["coord"]]["model_audit"], {"status": "ok", "label": "Compliant", "audit_enabled": True})
        self.assertEqual(by_en[ids["legacy"]]["model_audit"], {"status": "violation", "label": "Blocked", "audit_enabled": True})
        self.assertEqual(by_en[ids["sub"]]["model_audit"], {"status": "warn", "label": "Over-tier", "audit_enabled": True})

    def test_corrupt_or_missing_config_graceful_fallback(self):
        self._seed_synthetic_cluster()
        os.environ["AGY_CONTEXT_PRO_CONFIG"] = str(self.root / "does-not-exist.json")
        rep_missing = swarm_radar.build_radar_report("22222222", gemini_dir=self.gemini)
        self.assertFalse(rep_missing["audit_enabled"])

        broken_cfg = self.root / "broken.json"
        broken_cfg.write_text("{corrupt-json!!", encoding="utf-8")
        os.environ["AGY_CONTEXT_PRO_CONFIG"] = str(broken_cfg)
        rep_broken = swarm_radar.build_radar_report("22222222", gemini_dir=self.gemini)
        self.assertFalse(rep_broken["audit_enabled"])
        self.assertEqual(rep_broken["summary"]["violation_count"], 0)

    def test_no_cluster_returns_false(self):
        rep = swarm_radar.build_radar_report("99999999-9999-4999-8999-999999999999", gemini_dir=self.gemini)
        self.assertEqual(rep["has_cluster"], False)
        self.assertEqual(rep["audit_enabled"], False)


class FormatTest(unittest.TestCase):
    def test_model_label(self):
        cases = {
            "gemini-4-argon-medium": "Gemini 4 Argon (Medium)",
            "gemini-3.8-flash-low": "Gemini 3.8 Flash (Low)",
            "claude-opus-5-5-high": "Claude Opus 5.5 (High)",
            "gpt-oss-120b-medium": "GPT-OSS 120B (Medium)",
        }
        for slug, label in cases.items():
            self.assertEqual(context_report.model_label(slug), label)

    def test_native_windows(self):
        for slug, tokens in {"claude-sonnet-5-5-low": 1_000_000, "claude-opus-4-6-thinking": 250_000,
                             "gpt-oss-120b-medium": 131_072, "gemini-4-argon-high": 1_048_576}.items():
            gen = context_report.Msg(f(3, f(28, slug)))
            self.assertEqual(context_report.context_limit(gen), tokens)

    def test_fmt_tok(self):
        self.assertEqual(context_report.fmt_tok(999), "999")
        self.assertEqual(context_report.fmt_tok(1500), "1.5k")
        self.assertEqual(context_report.fmt_tok(1_000_000), "1M")
        self.assertEqual(context_report.fmt_tok(1_250_000), "1.2M")


if __name__ == "__main__":
    unittest.main()
