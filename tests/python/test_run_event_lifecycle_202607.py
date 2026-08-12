import logging
import threading
import time
import unittest
import uuid

from app.runtime.execution_manager import ExecutionManager
from app.runtime.result_cache import ResultCache
from app.runtime.run_ids import new_run_id, new_session_id, new_trace_id
from app.runtime.worker_pool import WorkerPool
from app.services.catalog_service import CatalogService
from app.services.errors import ApplicationServiceError
from app.services.standalone_execution_service import (
    StandaloneExecutionService,
)
from app.services.workflow_document_service import WorkflowDocumentService
from core.workflow_engine import WorkflowEngine


def _document(*, steps=None, edges=None, loop=None):
    return {
        "metadata": {
            "mode": "dataflow",
            "name": "sample",
            "default_flow_id": "01",
        },
        "steps": steps or [{
            "step_id": "01",
            "flow_id": "01",
            "label": "変数定義",
            "connector_id": "WindowsConnector",
            "action_id": "define_values",
            "params": {"define_values": []},
        }],
        "flows": {
            "01": {
                "label": "sample flow",
                "start": {
                    "ui_position": {"x": 80, "y": 120},
                    "variables": [],
                },
                "end": {
                    "ui_position": {"x": 880, "y": 120},
                },
                "edges": edges or [
                    {"from": "START", "to": "01", "order": 1},
                    {"from": "01", "to": "END", "order": 1},
                ],
            },
        },
        **({"loop": loop} if loop is not None else {}),
    }


def _register_session(
    manager,
    run_id,
    *,
    run_kind="flow",
    doc_session_id="doc_01",
    flow_id="01",
    step_id="",
):
    return manager.register_session({
        "run_id": run_id,
        "trace_id": f"trace_{run_id}",
        "execution_source": "gui",
        "run_kind": run_kind,
        "doc_session_id": doc_session_id,
        "flow_id": flow_id,
        "flow_key": (
            ""
            if run_kind == "standalone"
            else f"{doc_session_id}|{flow_id}"
        ),
        "status": "running",
        "cancel_event": threading.Event(),
        "requested_step_id": step_id,
    })


class RunIdentityTests(unittest.TestCase):
    def test_uuid7_ids_keep_source_and_kind_prefix(self):
        values = {
            new_run_id("gui", "flow"): "gui_flw_",
            new_run_id("gui", "step"): "gui_stp_",
            new_run_id("gui", "standalone"): "gui_std_",
            new_run_id("cli", "flow"): "cli_flw_",
        }
        for value, prefix in values.items():
            self.assertTrue(value.startswith(prefix))
            parsed = uuid.UUID(value[len(prefix):])
            self.assertEqual(parsed.version, 7)
            self.assertEqual(parsed.variant, uuid.RFC_4122)
        self.assertEqual(
            uuid.UUID(new_trace_id().removeprefix("trace_")).version,
            7,
        )
        self.assertEqual(
            uuid.UUID(new_session_id().removeprefix("session_")).version,
            7,
        )


class ExecutionManager202607Tests(unittest.TestCase):
    def setUp(self):
        self.manager = ExecutionManager(session_id="session_test")

    def test_workflow_is_global_and_standalone_is_per_document(self):
        _register_session(self.manager, "gui_flw_1")
        with self.assertRaises(ApplicationServiceError) as workflow_conflict:
            _register_session(
                self.manager,
                "gui_flw_2",
                doc_session_id="doc_02",
            )
        self.assertEqual(
            workflow_conflict.exception.code,
            "E_RUN_CONFLICT",
        )

        _register_session(
            self.manager,
            "gui_std_1",
            run_kind="standalone",
            doc_session_id="sql_01",
        )
        _register_session(
            self.manager,
            "gui_std_2",
            run_kind="standalone",
            doc_session_id="sql_02",
        )
        with self.assertRaises(ApplicationServiceError):
            _register_session(
                self.manager,
                "gui_std_3",
                run_kind="standalone",
                doc_session_id="sql_01",
            )

    def test_cancel_acceptance_and_lightweight_index(self):
        flow = _register_session(self.manager, "gui_flw_1")
        standalone = _register_session(
            self.manager,
            "gui_std_1",
            run_kind="standalone",
            doc_session_id="sql_01",
        )
        accepted = self.manager.request_cancel("gui_std_1")
        self.assertTrue(accepted["accepted"])
        self.assertTrue(standalone["cancel_event"].is_set())
        self.manager.mark_terminal(
            "gui_std_1",
            status="cancelled",
        )
        repeated = self.manager.request_cancel("gui_std_1")
        self.assertFalse(repeated["accepted"])

        index = self.manager.get_run_index()
        self.assertEqual(index["standalone"], [])
        self.assertEqual(index["workflows"][0]["run_id"], flow["run_id"])
        self.assertEqual(index["workflows"][0]["status"], "running")

    def test_index_retains_latest_flow_and_each_latest_step_run(self):
        _register_session(self.manager, "gui_flw_1")
        self.manager.mark_terminal("gui_flw_1", status="success")
        _register_session(
            self.manager,
            "gui_stp_1",
            run_kind="step",
            step_id="01",
        )
        self.manager.mark_terminal("gui_stp_1", status="success")
        _register_session(
            self.manager,
            "gui_stp_2",
            run_kind="step",
            step_id="02",
        )
        self.manager.mark_terminal("gui_stp_2", status="success")

        workflows = self.manager.get_run_index()["workflows"]

        self.assertEqual(
            {(item["run_id"], item.get("step_id", "")) for item in workflows},
            {
                ("gui_flw_1", ""),
                ("gui_stp_1", "01"),
                ("gui_stp_2", "02"),
            },
        )


class WorkerPoolTests(unittest.TestCase):
    def test_worker_count_never_exceeds_limit(self):
        pool = WorkerPool(max_workers=2)
        lock = threading.Lock()
        active = 0
        max_active = 0

        def run(index):
            nonlocal active, max_active
            with pool.lease(f"run_{index % 2}") as acquired:
                self.assertTrue(acquired)
                with lock:
                    active += 1
                    max_active = max(max_active, active)
                time.sleep(0.03)
                with lock:
                    active -= 1

        threads = [
            threading.Thread(target=run, args=(index,))
            for index in range(8)
        ]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=2)
        self.assertTrue(all(not thread.is_alive() for thread in threads))
        self.assertEqual(max_active, 2)
        self.assertEqual(pool.snapshot()["active_count"], 0)


class WorkflowDocumentServiceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.service = WorkflowDocumentService(CatalogService())

    def test_valid_document_selects_flow_and_projects_schema(self):
        document = _document()
        document["steps"][0]["schema"] = {
            "columns": [{
                "origin_name": "name",
                "ziz_datatype": "STRING",
            }]
        }
        plan = self.service.prepare_run(document, flow_id="01")

        self.assertEqual(plan.flow_id, "01")
        self.assertEqual(plan.step_ids, ("01",))
        compiled = plan.execution_config["steps"][0]
        self.assertEqual(compiled["connector"], "WindowsConnector")
        self.assertEqual(compiled["action"], "define_values")
        self.assertEqual(
            compiled["params"]["schema"][0]["origin_name"],
            "name",
        )

    def test_old_single_flow_and_loop_child_step_run_are_rejected(self):
        old_document = _document()
        old_document["flows"] = old_document["flows"]["01"]
        with self.assertRaises(ValueError):
            self.service.prepare_run(old_document, flow_id="01")

        steps = [
            {
                "step_id": "01",
                "flow_id": "01",
                "label": "loop",
                "connector_id": "WindowsConnector",
                "action_id": "loop_tasks",
                "node_type": "loop",
                "params": {"source_step_id": "03"},
            },
            {
                "step_id": "02",
                "flow_id": "01",
                "loop_owner_id": "01",
                "label": "child",
                "connector_id": "WindowsConnector",
                "action_id": "wait",
                "params": {"duration_seconds": 0},
            },
            {
                "step_id": "03",
                "flow_id": "01",
                "label": "source",
                "connector_id": "WindowsConnector",
                "action_id": "define_values",
                "params": {"define_values": []},
            },
        ]
        document = _document(
            steps=steps,
            edges=[
                {"from": "START", "to": "03", "order": 1},
                {"from": "03", "to": "01", "order": 1},
                {"from": "01", "to": "END", "order": 1},
            ],
            loop={
                "flows": {
                    "01": {
                        "edges": [
                            {"from": "START", "to": "02", "order": 1},
                            {"from": "02", "to": "END", "order": 1},
                        ]
                    }
                }
            },
        )
        with self.assertRaisesRegex(ValueError, "loop内step"):
            self.service.prepare_run(
                document,
                flow_id="01",
                step_id="02",
            )


class _TrackingConnector:
    def __init__(self, tracker):
        self.tracker = tracker

    def execute(self, action, params, context):
        with self.tracker["lock"]:
            self.tracker["active"] += 1
            self.tracker["max_active"] = max(
                self.tracker["max_active"],
                self.tracker["active"],
            )
            self.tracker["executed"].append(action)
        try:
            time.sleep(float(params.get("sleep") or 0))
            if params.get("fail"):
                raise RuntimeError("primary failure")
            return {"value": action}
        finally:
            with self.tracker["lock"]:
                self.tracker["active"] -= 1


class _TrackingFactory:
    def __init__(self, tracker):
        self.tracker = tracker

    def create(self, connector_id):
        return _TrackingConnector(self.tracker)


class WorkflowSchedulerTests(unittest.TestCase):
    def test_bounded_fail_fast_marks_unstarted_steps_skipped(self):
        tracker = {
            "lock": threading.Lock(),
            "active": 0,
            "max_active": 0,
            "executed": [],
        }
        statuses = []
        engine = WorkflowEngine(
            logging.getLogger("ziz.test.scheduler"),
            step_status_callback=statuses.append,
        )
        engine.connector_factory = _TrackingFactory(tracker)
        cancel_event = threading.Event()
        engine.configure_runtime(
            run_id="gui_flw_test",
            max_parallel_steps=2,
        )
        steps = [
            {
                "step_id": f"0{index}",
                "connector": "FakeConnector",
                "action": f"action_{index}",
                "params": {
                    "sleep": 0.01 if index == 1 else 0.1,
                    "fail": index == 1,
                },
                "output_variable": f"0{index}",
            }
            for index in range(1, 5)
        ]
        edges = []
        for index in range(1, 5):
            step_id = f"0{index}"
            edges.extend([
                {"from": "START", "to": step_id, "order": index},
                {"from": step_id, "to": "END", "order": index},
            ])
        report = engine.run_flow_from_config(
            {
                "metadata": {"name": "parallel"},
                "variables": {"start": []},
                "steps": steps,
                "flows": {"edges": edges},
            },
            cancel_event=cancel_event,
        )

        self.assertEqual(report["status"], "error")
        self.assertEqual(report["error"], "primary failure")
        self.assertLessEqual(tracker["max_active"], 2)
        status_by_step = {
            item["step_id"]: item["status"]
            for item in report["steps"]
        }
        self.assertEqual(status_by_step["01"], "error")
        self.assertIn("skipped", set(status_by_step.values()))
        self.assertNotIn("action_3", tracker["executed"])
        self.assertNotIn("action_4", tracker["executed"])
        self.assertTrue(cancel_event.is_set())


def _cache_report(run_id, text):
    return {
        "status": "success",
        "steps": [{
            "step_id": "01",
            "status": "success",
            "ui_cache": {
                "schema": {
                    "columns": [{
                        "origin_name": "value",
                        "new_name": "value",
                        "description": "value",
                        "ziz_datatype": "STRING",
                    }]
                },
                "preview": {
                    "columns": ["value"],
                    "rows": [[text] for _ in range(100)],
                    "row_count": 100,
                },
                "row_count": 100,
            },
        }],
    }


class ResultCacheLimitTests(unittest.TestCase):
    def test_old_terminal_preview_is_evicted_before_new_active_preview(self):
        cache = ResultCache(max_session_bytes=15_000)

        def register(run_id, flow_id):
            cache.register_run(
                run_id=run_id,
                trace_id=f"trace_{run_id}",
                doc_session_id="doc_01",
                flow_id=flow_id,
                run_kind="flow",
                execution_source="gui",
                flow_name=flow_id,
                started_at="2026-07-29T00:00:00+00:00",
                step_ids=["01"],
            )

        register("run_01", "01")
        cache.complete_run(
            "run_01",
            summary={
                "run_id": "run_01",
                "status": "success",
                "finished_at": "2026-07-29T00:00:01+00:00",
            },
            report=_cache_report("run_01", "A" * 100),
        )
        register("run_02", "02")
        cache.store_step_result(
            "run_02",
            _cache_report("run_02", "B" * 100)["steps"][0],
        )

        self.assertEqual(
            cache.get_schema("run_01", "01")["columns"][0]["new_name"],
            "value",
        )
        with self.assertRaises(ApplicationServiceError) as evicted:
            cache.get_preview("run_01", "01")
        self.assertEqual(evicted.exception.code, "E_RESULT_NOT_FOUND")
        self.assertEqual(
            len(cache.get_preview("run_02", "01")["rows"]),
            100,
        )


class StandaloneDryRunTests(unittest.TestCase):
    def test_python_dry_run_uses_catalog_metadata_without_execution(self):
        catalog = CatalogService()
        cache = ResultCache()
        service = StandaloneExecutionService(catalog, cache)
        plan = service.prepare_run(
            connector_id="PythonConnector",
            action_id="execute_python",
            params={
                "script": (
                    "import json\n"
                    "def main():\n"
                    "    return {'ok': True}\n"
                )
            },
            result_mode="text",
            dry_run=True,
        )
        result = service.execute(
            plan,
            logger=logging.getLogger("ziz.test.standalone"),
            run_id="gui_std_test",
            cancel_event=threading.Event(),
            worker_pool=WorkerPool(max_workers=1),
        )

        self.assertFalse(result["dry_run"]["executed"])
        self.assertEqual(
            result["dry_run"]["strategy"],
            "python_static_validation",
        )


if __name__ == "__main__":
    unittest.main()
