import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

from app.gui.bridge import BridgeRuntime
from app.runtime.result_cache import ResultCache
from app.runtime.run_log_store import RunLogStore
from app.services.errors import ApplicationServiceError


def _summary(run_id, *, status="success"):
    return {
        "run_id": run_id,
        "status": status,
        "finished_at": "2026-07-29T00:00:01+00:00",
        "duration_ms": 1000,
        "success_count": 1 if status == "success" else 0,
        "error_count": 1 if status == "error" else 0,
    }


def _report(step_id="01", *, rows=None, row_count=None):
    preview_rows = rows if rows is not None else [["A"]]
    total_rows = len(preview_rows) if row_count is None else row_count
    return {
        "status": "success",
        "steps": [{
            "step_id": step_id,
            "status": "success",
            "ui_cache": {
                "kind": "dataframe",
                "schema": {
                    "columns": [{
                        "origin_name": "name",
                        "new_name": "name",
                        "description": "name",
                        "ziz_datatype": "STRING",
                    }],
                },
                "preview": {
                    "columns": ["name"],
                    "rows": preview_rows,
                    "row_count": min(total_rows, len(preview_rows)),
                    "truncated": total_rows > len(preview_rows),
                },
                "row_count": total_rows,
            },
        }],
    }


class ResultCacheTests(unittest.TestCase):
    def setUp(self):
        self.cache = ResultCache()

    def _register(
        self,
        run_id,
        *,
        run_kind="flow",
        step_ids=None,
        doc_session_id="docsession_01",
    ):
        return self.cache.register_run(
            run_id=run_id,
            trace_id=f"trace_{run_id}",
            doc_session_id=doc_session_id,
            flow_id="01",
            run_kind=run_kind,
            execution_source="gui",
            flow_name="sample",
            started_at="2026-07-29T00:00:00+00:00",
            step_ids=step_ids or ["01"],
            session_id="session_01",
        )

    def test_result_requires_run_and_is_not_ready_while_running(self):
        self._register("run_01")

        with self.assertRaises(ApplicationServiceError) as raised:
            self.cache.get_preview("run_01", "01")

        self.assertEqual(raised.exception.code, "E_RESULT_NOT_READY")
        with self.assertRaises(ApplicationServiceError) as missing:
            self.cache.get_schema("missing", "01")
        self.assertEqual(missing.exception.code, "E_RUN_NOT_FOUND")

    def test_complete_run_stores_schema_preview_and_total_row_count(self):
        self._register("run_01")
        self.cache.complete_run(
            "run_01",
            summary=_summary("run_01"),
            report=_report(row_count=10),
        )

        schema = self.cache.get_schema("run_01", "01")
        preview = self.cache.get_preview("run_01", "01")

        self.assertEqual(schema["run_id"], "run_01")
        self.assertEqual(schema["step_id"], "01")
        self.assertEqual(schema["columns"][0]["new_name"], "name")
        self.assertEqual(preview["row_count"], 10)
        self.assertTrue(preview["truncated"])
        self.assertEqual(preview["rows"], [["A"]])

    def test_preview_applies_row_and_cell_limits(self):
        self._register("run_01")
        long_value = "あ" * (ResultCache.MAX_CELL_BYTES + 100)
        rows = [[long_value] for _ in range(110)]
        self.cache.complete_run(
            "run_01",
            summary=_summary("run_01"),
            report=_report(rows=rows, row_count=110),
        )

        preview = self.cache.get_preview("run_01", "01")

        self.assertLessEqual(len(preview["rows"]), 100)
        self.assertLessEqual(
            len(preview["rows"][0][0].encode("utf-8")),
            ResultCache.MAX_CELL_BYTES,
        )
        self.assertTrue(preview["truncated"])

    def test_latest_flow_and_step_run_replace_previous_cache(self):
        self._register("flow_01")
        self._register("flow_02")
        self.assertFalse(self.cache.has_run("flow_01"))
        self.assertTrue(self.cache.has_run("flow_02"))

        self._register("step_01", run_kind="step", step_ids=["01"])
        self._register("step_02", run_kind="step", step_ids=["01"])
        self.assertFalse(self.cache.has_run("step_01"))
        self.assertTrue(self.cache.has_run("step_02"))

    def test_close_document_releases_all_results(self):
        self._register("run_01")
        self._register(
            "run_02",
            run_kind="step",
            doc_session_id="docsession_01",
        )

        result = self.cache.close_document("docsession_01")

        self.assertEqual(result["released_run_count"], 2)
        self.assertFalse(self.cache.has_run("run_01"))
        self.assertFalse(self.cache.has_run("run_02"))

    def test_invalidate_steps_clears_flow_cache_and_removes_step_run(self):
        self._register("flow_01", step_ids=["01", "02"])
        self.cache.complete_run(
            "flow_01",
            summary=_summary("flow_01"),
            report=_report("01"),
        )
        self._register("step_01", run_kind="step", step_ids=["02"])

        flow_result = self.cache.invalidate_document_steps(
            "docsession_01",
            ["01"],
        )
        step_result = self.cache.invalidate_document_steps(
            "docsession_01",
            ["02"],
        )

        self.assertEqual(flow_result["invalidated_step_ids"], ["01"])
        with self.assertRaises(ApplicationServiceError):
            self.cache.get_preview("flow_01", "01")
        self.assertEqual(step_result["removed_run_ids"], ["step_01"])
        self.assertFalse(self.cache.has_run("step_01"))


class RunLogStoreTests(unittest.TestCase):
    def setUp(self):
        self._temp_dir = tempfile.TemporaryDirectory()
        self.log_dir = Path(self._temp_dir.name)
        self.now = datetime(2026, 7, 29, 12, 0, tzinfo=timezone.utc)
        self.store = RunLogStore(
            self.log_dir,
            now_provider=lambda: self.now,
        )

    def tearDown(self):
        self._temp_dir.cleanup()

    def test_sequence_pagination_and_daily_file(self):
        for index in range(501):
            self.store.append(
                run_id="run_01",
                level="INFO",
                category="step",
                step_id="01",
                message=f"log {index + 1}",
            )

        latest = self.store.get_logs("run_01")
        older = self.store.get_logs("run_01", before_seq=3)
        newer = self.store.get_logs("run_01", after_seq=500)

        self.assertEqual(len(latest["items"]), 500)
        self.assertEqual(latest["items"][0]["log_seq"], 2)
        self.assertTrue(latest["has_more_before"])
        self.assertEqual(
            [item["log_seq"] for item in older["items"]],
            [1, 2],
        )
        self.assertEqual(
            [item["log_seq"] for item in newer["items"]],
            [501],
        )
        self.assertTrue((self.log_dir / "run_log_2026-07-29.jsonl").exists())

        with self.assertRaises(ValueError):
            self.store.get_logs(
                "run_01",
                before_seq=10,
                after_seq=20,
            )

    def test_cleanup_removes_files_outside_retention(self):
        retained_path = self.log_dir / "run_log_2026-07-20.jsonl"
        old_path = self.log_dir / "run_log_2026-07-19.jsonl"
        retained_path.write_text("{}\n", encoding="utf-8")
        old_path.write_text("{}\n", encoding="utf-8")

        self.store.cleanup()

        self.assertTrue(retained_path.exists())
        self.assertFalse(old_path.exists())


class ResultBridgeIntegrationTests(unittest.TestCase):
    def setUp(self):
        self._temp_dir = tempfile.TemporaryDirectory()
        self.base_dir = Path(self._temp_dir.name)
        self.runtime = BridgeRuntime(base_dir=self.base_dir)
        self.runtime.result_cache.register_run(
            run_id="run_01",
            trace_id="trace_01",
            doc_session_id="docsession_01",
            flow_id="01",
            run_kind="flow",
            execution_source="gui",
            flow_name="sample",
            started_at="2026-07-29T00:00:00+00:00",
            step_ids=["01"],
            session_id="session_01",
        )
        self.runtime.result_cache.complete_run(
            "run_01",
            summary=_summary("run_01"),
            report=_report(),
        )
        self.runtime.run_log_store.append(
            run_id="run_01",
            level="INFO",
            category="run",
            message="completed",
        )

    def tearDown(self):
        self._temp_dir.cleanup()

    def _dispatch(self, command, payload):
        return self.runtime.handle_message(json.dumps({
            "v": "1",
            "kind": "cmd",
            "id": "cmd_test",
            "type": command,
            "ts": "2026-07-29T00:00:00Z",
            "payload": payload,
        }))

    def test_result_commands_use_run_id_contract(self):
        schema = self._dispatch(
            "result.getSchema",
            {"run_id": "run_01", "step_id": "01"},
        )
        preview = self._dispatch(
            "result.getPreview",
            {"run_id": "run_01", "step_id": "01"},
        )
        logs = self._dispatch(
            "result.getLogs",
            {"run_id": "run_01"},
        )

        self.assertTrue(schema["ok"])
        self.assertEqual(schema["data"]["run_id"], "run_01")
        self.assertTrue(preview["ok"])
        self.assertEqual(preview["data"]["row_count"], 1)
        self.assertTrue(logs["ok"])
        self.assertEqual(logs["data"]["items"][0]["log_seq"], 1)

    def test_missing_run_id_and_datavolume_are_rejected(self):
        missing_run = self._dispatch(
            "result.getSchema",
            {"step_id": "01"},
        )
        datavolume = self._dispatch(
            "result.getDatavolume",
            {"run_id": "run_01", "step_id": "01"},
        )

        self.assertFalse(missing_run["ok"])
        self.assertEqual(missing_run["error"]["code"], "E_VALIDATION")
        self.assertFalse(datavolume["ok"])
        self.assertEqual(datavolume["error"]["code"], "E_ACCESS_DENIED")

    def test_invalidate_steps_is_a_write_command_and_drops_cached_result(self):
        result = self._dispatch(
            "result.invalidateSteps",
            {
                "doc_session_id": "docsession_01",
                "step_ids": ["01"],
            },
        )
        preview = self._dispatch(
            "result.getPreview",
            {"run_id": "run_01", "step_id": "01"},
        )

        self.assertTrue(result["ok"])
        self.assertEqual(result["data"]["invalidated_step_ids"], ["01"])
        self.assertFalse(preview["ok"])
        self.assertEqual(preview["error"]["code"], "E_RESULT_NOT_FOUND")

    def test_flow_worker_publishes_result_cache_before_terminal_read(self):
        started = self._dispatch(
            "run.start",
            {
                "doc_session_id": "docsession_worker",
                "mode": "dataflow",
                "flow_id": "01",
                "document": {
                    "metadata": {
                        "mode": "dataflow",
                        "name": "worker-result-cache",
                        "default_flow_id": "01",
                    },
                    "steps": [{
                        "step_id": "01",
                        "flow_id": "01",
                        "label": "変数定義",
                        "connector_id": "WindowsConnector",
                        "action_id": "define_values",
                        "params": {
                            "define_values": [{
                                "name": "table_name",
                                "value": "orders",
                            }],
                        },
                    }],
                    "flows": {
                        "01": {
                            "label": "worker-result-cache",
                            "start": {
                                "ui_position": {"x": 80, "y": 120},
                                "variables": [],
                            },
                            "end": {
                                "ui_position": {"x": 880, "y": 120},
                            },
                            "edges": [
                                {
                                    "from": "START",
                                    "to": "01",
                                    "order": 1,
                                },
                                {
                                    "from": "01",
                                    "to": "END",
                                    "order": 1,
                                },
                            ],
                        },
                    },
                    "notes": [],
                },
            },
        )
        self.assertTrue(started["ok"])
        run_id = started["data"]["run_id"]
        worker = self.runtime.execution_manager.require_session(
            run_id
        )["thread"]
        worker.join(timeout=5)
        self.assertFalse(worker.is_alive())

        summary = self._dispatch(
            "result.getSummary",
            {"run_id": run_id},
        )
        schema = self._dispatch(
            "result.getSchema",
            {"run_id": run_id, "step_id": "01"},
        )
        preview = self._dispatch(
            "result.getPreview",
            {"run_id": run_id, "step_id": "01"},
        )

        self.assertTrue(summary["ok"])
        self.assertEqual(summary["data"]["status"], "success")
        self.assertTrue(schema["ok"])
        self.assertGreater(len(schema["data"]["columns"]), 0)
        self.assertTrue(preview["ok"])
        self.assertEqual(preview["data"]["row_count"], 1)


if __name__ == "__main__":
    unittest.main()
