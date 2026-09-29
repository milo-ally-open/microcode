import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "analyze_session.py"
SPEC = importlib.util.spec_from_file_location("analyze_session", SCRIPT)
analyzer = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(analyzer)


def message_entry(seq, timestamp, message):
    return {
        "kind": "entry",
        "type": "message",
        "id": f"entry-{seq}",
        "seq": seq,
        "timestamp": timestamp,
        "parentId": None,
        "message": message,
    }


class AnalyzeSessionTests(unittest.TestCase):
    def test_pairs_tool_calls_and_reports_success_failure_and_pending(self):
        header = {"kind": "header", "v": 4, "id": "session-123", "createdAt": 1_700_000_000_000}
        records = [
            message_entry(1, 1_700_000_000_000, {
                "role": "assistant", "provider": "test-provider", "model": "test-model",
                "timestamp": 1_700_000_000_000,
                "content": [
                    {"type": "toolCall", "id": "call-ok", "name": "read", "arguments": {"path": "private.txt"}},
                    {"type": "toolCall", "id": "call-fail", "name": "bash", "arguments": {"command": "private command"}},
                    {"type": "toolCall", "id": "call-pending", "name": "grep", "arguments": {}},
                ],
            }),
            message_entry(2, 1_700_000_000_250, {
                "role": "toolResult", "toolCallId": "call-ok", "toolName": "read", "isError": False,
                "content": [{"type": "text", "text": "private tool output"}], "timestamp": 1_700_000_000_250,
            }),
            message_entry(3, 1_700_000_001_000, {
                "role": "toolResult", "toolCallId": "call-fail", "toolName": "bash", "isError": True,
                "content": [{"type": "text", "text": "private error output"}], "timestamp": 1_700_000_001_000,
            }),
        ]
        # Storage timestamp can be delayed relative to the original Agent event time.
        records[1]["timestamp"] += 10_000

        result = analyzer.analyze(header, records)

        self.assertEqual(len(result["calls"]), 3)
        self.assertEqual(result["successes"], 1)
        self.assertEqual(result["failures"], 1)
        self.assertEqual(result["unresolved"], 1)
        self.assertEqual(result["success_rate"], 50.0)
        self.assertEqual(result["tool_stats"]["read"]["average_duration"], 0.25)
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "analysis.png"
            analyzer.render_chart(result, Path("session.jsonl"), output, [])
            self.assertTrue(output.is_file())
            self.assertGreater(output.stat().st_size, 1000)
            self.assertEqual(output.read_bytes()[:8], b"\x89PNG\r\n\x1a\n")

    def test_legacy_v3_message_records_are_normalized(self):
        record = {"type": "message", "message": {"role": "user", "content": "hello", "timestamp": "2026-01-01T00:00:00Z"}}
        self.assertEqual(analyzer.extract_message(record)[0]["role"], "user")

    def test_reads_v4_transaction_arrays_and_valid_unterminated_final_records(self):
        header = {"kind": "header", "v": 4, "id": "session-v4"}
        transactions = [
            {"kind": "entry", "type": "message", "seq": 1, "timestamp": 1_700_000_000_000, "message": {"role": "user", "content": "first"}},
            {"kind": "entry", "type": "message", "seq": 2, "timestamp": 1_700_000_001_000, "message": {"role": "assistant", "content": [{"type": "text", "text": "done"}]}},
        ]
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "session.jsonl"
            path.write_text(json.dumps(header) + "\n" + json.dumps(transactions), encoding="utf-8")

            parsed_header, records, warnings = analyzer.read_records(path)

        self.assertEqual(parsed_header["id"], "session-v4")
        self.assertEqual(len(records), 2)
        self.assertIn("no trailing newline", warnings[0])

    def test_cli_writes_default_chart_under_project_microcode_directory(self):
        header = {"kind": "header", "v": 4, "id": "session-cli-test"}
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "export.jsonl"
            source.write_text(json.dumps(header) + "\n", encoding="utf-8")

            completed = subprocess.run(
                [sys.executable, str(SCRIPT), str(source)],
                cwd=root,
                capture_output=True,
                text=True,
                check=True,
            )

            chart = root / ".microcode" / "analysis" / "session-session-cli-test.png"
            trajectory = root / ".microcode" / "analysis" / "session-session-cli-test-trajectory.png"
            self.assertTrue(chart.is_file())
            self.assertTrue(trajectory.is_file())
            self.assertGreater(trajectory.stat().st_size, 1000)
            self.assertIn(str(chart), completed.stdout)
            self.assertIn(str(trajectory), completed.stdout)


if __name__ == "__main__":
    unittest.main()
