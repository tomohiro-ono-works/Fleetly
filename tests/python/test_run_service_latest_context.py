import tempfile
import unittest
from pathlib import Path

from app.gui.bridge import BridgeRuntime


class RunServiceLatestContextTests(unittest.TestCase):
    def setUp(self):
        self._temp_dir = tempfile.TemporaryDirectory()
        self.base_dir = Path(self._temp_dir.name)
        self.runtime = BridgeRuntime(base_dir=self.base_dir)
        self.doc_session_id = "docsession_latest_context"

    def tearDown(self):
        self.runtime.shutdown()
        self._temp_dir.cleanup()

    def test_sequential_step_runs_use_latest_context(self):
        output_path = self.base_dir / "out.md"
        document = self._document(output_path)

        first = self._run_step(document, "01")
        self.assertEqual(first["status"], "success")
        flow_key = self.runtime.execution_manager.build_flow_key(
            self.doc_session_id,
            "01",
        )
        latest = self.runtime.execution_manager.get_latest_flow_context(
            flow_key
        )
        self.assertEqual(latest.get("table_name"), "orders")

        second = self._run_step(document, "02")

        self.assertEqual(second["status"], "success")
        self.assertEqual(
            output_path.read_text(encoding="utf-8"),
            "tbl=orders",
        )

    def _run_step(self, document, step_id):
        accepted = self.runtime._handle_run_start({
            "doc_session_id": self.doc_session_id,
            "flow_id": "01",
            "step_id": step_id,
            "document": document,
        })
        session = self.runtime.execution_manager.require_session(
            accepted["run_id"]
        )
        worker = session["thread"]
        worker.join(timeout=5)
        self.assertFalse(worker.is_alive())
        return session

    def _document(self, output_path):
        return {
            "metadata": {
                "mode": "dataflow",
                "name": "latest-context",
                "default_flow_id": "01",
            },
            "steps": [
                {
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
                },
                {
                    "step_id": "02",
                    "flow_id": "01",
                    "label": "Markdown出力",
                    "connector_id": "WindowsConnector",
                    "action_id": "create_markdown_file",
                    "params": {
                        "write_mode": "replace",
                        "target_file_path": str(output_path),
                        "content": "tbl={{table_name}}",
                    },
                },
            ],
            "flows": {
                "01": {
                    "label": "latest-context",
                    "start": {
                        "ui_position": {"x": 80, "y": 120},
                        "variables": [],
                    },
                    "end": {
                        "ui_position": {"x": 880, "y": 120},
                    },
                    "edges": [
                        {"from": "START", "to": "01", "order": 1},
                        {"from": "01", "to": "02", "order": 1},
                        {"from": "02", "to": "END", "order": 1},
                    ],
                },
            },
            "notes": [],
        }


if __name__ == "__main__":
    unittest.main()
