import tempfile
import time
import unittest
from pathlib import Path

from app.gui.bridge import BridgeRuntime


class StandaloneRunEventTests(unittest.TestCase):
    def test_failed_event_contains_sanitized_error_payload(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            runtime = BridgeRuntime(base_dir=Path(temp_dir))
            events = []
            runtime.set_event_sink(events.append)
            try:
                accepted = runtime._handle_run_start({
                    "doc_session_id": "docsession_python_error",
                    "run_kind": "standalone",
                    "connector_id": "PythonConnector",
                    "action_id": "execute_python",
                    "result_mode": "text",
                    "dry_run": True,
                    "params": {
                        "script": "def main(:\n    return None\n",
                    },
                })
                session = runtime.execution_manager.require_session(
                    accepted["run_id"]
                )
                session["thread"].join(timeout=10)
                self.assertFalse(session["thread"].is_alive())
            finally:
                runtime.shutdown()

        failed = next(
            event
            for event in events
            if event.get("type") == "run.failed"
        )
        self.assertEqual(failed["payload"]["status"], "error")
        self.assertEqual(failed["payload"]["error"]["code"], "E_INTERNAL")
        self.assertIn(
            "invalid syntax",
            failed["payload"]["error"]["message"],
        )

    def test_python_process_failure_exposes_bounded_traceback(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            runtime = BridgeRuntime(base_dir=Path(temp_dir))
            events = []
            runtime.set_event_sink(events.append)
            try:
                accepted = runtime._handle_run_start({
                    "doc_session_id": "docsession_python_runtime_error",
                    "run_kind": "standalone",
                    "connector_id": "PythonConnector",
                    "action_id": "execute_python",
                    "result_mode": "text",
                    "params": {
                        "script": (
                            "def main():\n"
                            "    raise RuntimeError('runtime failure')\n"
                        ),
                    },
                })
                session = runtime.execution_manager.require_session(
                    accepted["run_id"]
                )
                session["thread"].join(timeout=15)
                self.assertFalse(session["thread"].is_alive())
            finally:
                runtime.shutdown()

        failed = next(
            event
            for event in events
            if event.get("type") == "run.failed"
        )
        message = failed["payload"]["error"]["message"]
        self.assertIn("Exit Code:", message)
        self.assertIn("Traceback", message)
        self.assertIn("runtime failure", message)

    def test_python_process_cancel_reaches_cancelled_terminal_event(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            runtime = BridgeRuntime(base_dir=Path(temp_dir))
            events = []
            runtime.set_event_sink(events.append)
            try:
                accepted = runtime._handle_run_start({
                    "doc_session_id": "docsession_python_cancel",
                    "run_kind": "standalone",
                    "connector_id": "PythonConnector",
                    "action_id": "execute_python",
                    "result_mode": "text",
                    "params": {
                        "script": (
                            "def main():\n"
                            "    import time\n"
                            "    time.sleep(30)\n"
                            "    return 'late'\n"
                        ),
                    },
                })
                session = runtime.execution_manager.require_session(
                    accepted["run_id"]
                )
                deadline = time.monotonic() + 5
                while (
                    session.get("status") == "queued"
                    and time.monotonic() < deadline
                ):
                    time.sleep(0.02)
                cancel = runtime._handle_run_cancel({
                    "run_id": accepted["run_id"],
                })
                self.assertTrue(cancel["accepted"])
                session["thread"].join(timeout=15)
                self.assertFalse(session["thread"].is_alive())
            finally:
                runtime.shutdown()

        self.assertTrue(
            any(
                event.get("type") == "run.cancelled"
                for event in events
            )
        )


if __name__ == "__main__":
    unittest.main()
