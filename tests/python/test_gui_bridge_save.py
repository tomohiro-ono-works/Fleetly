import tempfile
import unittest
from pathlib import Path

import yaml

from app.gui.bridge import BridgeRuntime


class DocumentSaveBridgeTests(unittest.TestCase):
    def setUp(self):
        self._temp_dir = tempfile.TemporaryDirectory()
        self.base_dir = Path(self._temp_dir.name)

    def tearDown(self):
        self._temp_dir.cleanup()

    def test_document_save_always_uses_save_callback(self):
        calls = []
        target_path = self.base_dir / "saved" / "renamed.zizd"

        def save_callback(mode, suggested_name, current_path):
            calls.append(
                {
                    "mode": mode,
                    "suggested_name": suggested_name,
                    "current_path": current_path,
                }
            )
            return str(target_path)

        runtime = BridgeRuntime(base_dir=self.base_dir, save_flow_callback=save_callback)
        workspace_root = self.base_dir / "workflows"
        workspace_root.mkdir()
        existing_path = workspace_root / "existing.zizd"
        existing_path.write_text(
            "metadata:\n  mode: dataflow\nsteps: []\nflows: {}\n",
            encoding="utf-8",
        )
        runtime.workspace_root = workspace_root
        loaded = runtime._handle_documents_load({
            "doc_session_id": "tab1",
            "scope": "root",
            "rel_path": "existing.zizd",
        })

        payload = {
            "mode": "dataflow",
            "file_name": "renamed.zizd",
            "doc_session_id": "tab1",
            "document_ref": loaded["document_ref"],
            "document": {
                "metadata": {"name": "テスト"},
                "steps": [],
                "flows": {},
            },
        }

        result = runtime._handle_documents_save(payload)

        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0]["mode"], "dataflow")
        self.assertEqual(calls[0]["suggested_name"], "renamed.zizd")
        self.assertTrue(calls[0]["current_path"].endswith("existing.zizd"))
        self.assertTrue(result["saved"])
        self.assertEqual(result["file_name"], "renamed.zizd")
        self.assertTrue(target_path.exists())

        saved = yaml.safe_load(target_path.read_text(encoding="utf-8"))
        self.assertEqual(saved["metadata"]["name"], "テスト")

    def test_document_save_cancelled_when_callback_returns_none(self):
        calls = []

        def save_callback(mode, suggested_name, current_path):
            calls.append((mode, suggested_name, current_path))
            return None

        runtime = BridgeRuntime(base_dir=self.base_dir, save_flow_callback=save_callback)
        workspace_root = self.base_dir / "workflows"
        workspace_root.mkdir()
        existing_path = workspace_root / "existing.zizd"
        existing_path.write_text(
            "metadata:\n  mode: dataflow\nsteps: []\nflows: {}\n",
            encoding="utf-8",
        )
        runtime.workspace_root = workspace_root
        loaded = runtime._handle_documents_load({
            "doc_session_id": "tab1",
            "scope": "root",
            "rel_path": "existing.zizd",
        })

        payload = {
            "mode": "dataflow",
            "file_name": "renamed.zizd",
            "doc_session_id": "tab1",
            "document_ref": loaded["document_ref"],
            "document": {"metadata": {"name": "テスト"}, "steps": [], "flows": {}},
        }

        result = runtime._handle_documents_save(payload)

        self.assertEqual(len(calls), 1)
        self.assertFalse(result["saved"])
        self.assertEqual(result["file_name"], "renamed.zizd")

    def test_coordinate_capture_start_delegates_to_native_callback(self):
        received_capture_ids = []
        runtime = BridgeRuntime(
            base_dir=self.base_dir,
            coordinate_capture_callback=received_capture_ids.append,
        )

        result = runtime._handle_mouse_coordinate_capture_start({"capture_id": "coordinate_1"})

        self.assertEqual(received_capture_ids, ["coordinate_1"])
        self.assertTrue(result["started"])
        self.assertEqual(result["capture_id"], "coordinate_1")


if __name__ == "__main__":
    unittest.main()
