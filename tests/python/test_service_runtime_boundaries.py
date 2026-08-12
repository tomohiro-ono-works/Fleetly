import ast
import inspect
import logging
import tempfile
import threading
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import app.main as app_main
import app.runtime.execution_manager as execution_manager_module
import app.services.run_service as run_service_module
import app.services.workflow_execution_service as workflow_execution_service_module
from app.runtime.execution_manager import ExecutionManager
from app.services.errors import ApplicationServiceError
from app.services.workflow_execution_service import WorkflowExecutionService


class _FakeEngine:
    instances = []

    def __init__(
        self,
        logger,
        step_status_callback=None,
        performance_callback=None,
        step_result_callback=None,
    ):
        self.logger = logger
        self.step_status_callback = step_status_callback
        self.performance_callback = performance_callback
        self.step_result_callback = step_result_callback
        self.context = {}
        self.calls = []
        self.__class__.instances.append(self)

    def configure_runtime(self, **kwargs):
        self.runtime_config = kwargs

    def run_flow(self, flow_path, cancel_event=None):
        self.calls.append(("file", flow_path, cancel_event))
        self.context = {"source": "file"}
        return {"status": "success", "steps": []}

    def run_flow_from_config(
        self,
        config,
        flow_path="<gui>",
        cancel_event=None,
        initial_context=None,
        only_step_id=None,
    ):
        self.calls.append(
            (
                "config",
                config,
                flow_path,
                cancel_event,
                initial_context,
                only_step_id,
            )
        )
        self.context = {"source": "config"}
        return {"status": "success", "steps": []}


class WorkflowExecutionServiceTests(unittest.TestCase):
    def setUp(self):
        _FakeEngine.instances = []
        self.service = WorkflowExecutionService(engine_factory=_FakeEngine)
        self.logger = logging.getLogger("ziz.test.execution_service")

    def test_run_config_returns_report_and_engine_context(self):
        cancel_event = threading.Event()
        step_events = []
        performance_events = []

        result = self.service.run_config(
            {"steps": []},
            logger=self.logger,
            flow_path="<test>",
            cancel_event=cancel_event,
            initial_context={"seed": 1},
            only_step_id="step_01",
            step_status_callback=step_events.append,
            performance_callback=lambda event, detail: performance_events.append((event, detail)),
        )

        self.assertEqual(result.report["status"], "success")
        self.assertEqual(result.context, {"source": "config"})
        engine = _FakeEngine.instances[-1]
        engine.step_status_callback({"status": "running"})
        engine.performance_callback("event", {"value": 1})
        self.assertEqual(step_events, [{"status": "running"}])
        self.assertEqual(performance_events, [("event", {"value": 1})])
        self.assertEqual(engine.calls[0][2], "<test>")
        self.assertIs(engine.calls[0][3], cancel_event)
        self.assertEqual(engine.calls[0][4], {"seed": 1})
        self.assertEqual(engine.calls[0][5], "step_01")

    def test_run_file_uses_same_service_boundary(self):
        result = self.service.run_file("sample.zizd", logger=self.logger)

        self.assertEqual(result.report["status"], "success")
        self.assertEqual(result.context, {"source": "file"})
        self.assertEqual(_FakeEngine.instances[-1].calls[0][0:2], ("file", "sample.zizd"))


class CliExecutionServiceTests(unittest.TestCase):
    def test_cli_uses_run_service(self):
        calls = []

        class _FakeService:
            def run_cli_file(self, flow_path, *, logger):
                calls.append((flow_path, logger))
                return {"status": "success", "steps": []}

        with tempfile.TemporaryDirectory() as temp_dir:
            flow_path = Path(temp_dir) / "sample.zizd"
            flow_path.write_text("metadata:\n  name: sample\n", encoding="utf-8")
            with patch.object(app_main, "resolve_flow_path", return_value=str(flow_path)):
                with patch.object(
                    app_main,
                    "_build_cli_run_service",
                    return_value=_FakeService(),
                ):
                    report = app_main.run_cli(str(flow_path))

        self.assertEqual(report["status"], "success")
        self.assertEqual(calls[0][0], str(flow_path))
        self.assertIs(calls[0][1], app_main.logger)


class ExecutionManagerTests(unittest.TestCase):
    def setUp(self):
        self.manager = ExecutionManager()

    def test_register_conflict_cancel_and_release(self):
        first_cancel = threading.Event()
        self.manager.register_session({
            "run_id": "run_1",
            "flow_key": "dataflow|sample",
            "status": "running",
            "cancel_event": first_cancel,
        })

        with self.assertRaises(ApplicationServiceError) as raised:
            self.manager.register_session({
                "run_id": "run_2",
                "flow_key": "dataflow|sample",
                "status": "running",
                "cancel_event": threading.Event(),
            })
        self.assertEqual(raised.exception.code, "E_RUN_CONFLICT")

        self.manager.request_cancel("run_1")
        self.assertTrue(first_cancel.is_set())
        self.manager.release_active("run_1")
        self.assertNotIn("dataflow|sample", self.manager.active_run_by_flow)

    def test_latest_result_keeps_runtime_object_without_serializing(self):
        result_object = object()
        self.manager.update_latest_by_flow(
            "dataflow|sample",
            {"seed": "value"},
            {
                "steps": [{
                    "step_id": "step_01",
                    "status": "success",
                    "result": result_object,
                    "ui_cache": {"row_count": 1},
                }]
            },
            final_context={
                "step_01": result_object,
                "final": result_object,
            },
        )

        context = self.manager.get_latest_flow_context("dataflow|sample")
        payload = self.manager.get_latest_step_payload("step_01", "dataflow|sample")
        self.assertIs(context["step_01"], result_object)
        self.assertIs(context["final"], result_object)
        self.assertIs(payload["result"], result_object)
        self.assertEqual(payload["ui_cache"]["row_count"], 1)

    def test_invalidate_document_steps_removes_runtime_seed_values(self):
        self.manager.update_latest_by_flow(
            "docsession_1|01",
            {},
            {
                "steps": [{
                    "step_id": "01",
                    "status": "success",
                    "result": object(),
                    "ui_cache": {"row_count": 1},
                }]
            },
        )

        result = self.manager.invalidate_document_steps(
            "docsession_1",
            ["01"],
        )

        self.assertEqual(result["invalidated_step_ids"], ["01"])
        with self.assertRaises(ApplicationServiceError):
            self.manager.get_latest_step_payload(
                "01",
                "docsession_1|01",
            )

    def test_close_document_releases_terminal_run_and_latest_cache(self):
        self.manager.register_session({
            "run_id": "run_1",
            "flow_key": "dataflow|sample",
            "workspace_tab_id": "docsession_1",
            "status": "running",
            "cancel_event": threading.Event(),
        })
        self.manager.runs["run_1"]["status"] = "success"
        self.manager.latest_by_flow["dataflow|sample"] = {
            "step_ui_cache": {"01": {"row_count": 1}},
        }
        self.manager.release_active("run_1")

        released = self.manager.close_document("docsession_1")

        self.assertEqual(released["released_run_count"], 1)
        self.assertEqual(released["released_flow_count"], 1)
        self.assertNotIn("run_1", self.manager.runs)
        self.assertNotIn("dataflow|sample", self.manager.latest_by_flow)

    def test_close_document_does_not_cancel_or_remove_running_run(self):
        cancel_event = threading.Event()
        self.manager.register_session({
            "run_id": "run_1",
            "flow_key": "dataflow|sample",
            "doc_session_id": "docsession_1",
            "status": "running",
            "cancel_event": cancel_event,
        })

        with self.assertRaises(ApplicationServiceError) as raised:
            self.manager.close_document("docsession_1")

        self.assertEqual(raised.exception.code, "E_RUN_CONFLICT")
        self.assertFalse(cancel_event.is_set())
        self.assertIn("run_1", self.manager.runs)


class ServiceRuntimeDependencyTests(unittest.TestCase):
    def test_service_and_runtime_do_not_import_gui_transport(self):
        for module in (
            workflow_execution_service_module,
            execution_manager_module,
            run_service_module,
        ):
            source = inspect.getsource(module)
            tree = ast.parse(source)
            imports = set()
            for node in ast.walk(tree):
                if isinstance(node, ast.Import):
                    imports.update(alias.name for alias in node.names)
                elif isinstance(node, ast.ImportFrom) and node.module:
                    imports.add(node.module)

            self.assertFalse(any(name == "PySide6" or name.startswith("PySide6.") for name in imports))
            self.assertFalse(any(name == "app.gui" or name.startswith("app.gui.") for name in imports))


if __name__ == "__main__":
    unittest.main()
