import tempfile
import unittest
from pathlib import Path

from app.gui.bridge import BridgeRuntime


class FilePickerBridgeTests(unittest.TestCase):
    def setUp(self):
        self._temp_dir = tempfile.TemporaryDirectory()
        self.base_dir = Path(self._temp_dir.name)

    def tearDown(self):
        self._temp_dir.cleanup()

    def test_pick_folder_uses_native_picker_for_empty_current_value(self):
        calls = []
        selected = self.base_dir / "out"
        selected.mkdir()

        def pick_folder(title):
            calls.append(("pick", title))
            return str(selected)

        def edit_folder(title, current_path):
            calls.append(("edit", title, current_path))
            return None

        runtime = BridgeRuntime(
            base_dir=self.base_dir,
            pick_folder_callback=pick_folder,
            edit_folder_callback=edit_folder,
        )

        result = runtime._handle_file_pick_folder({
            "title": "出力フォルダを選択",
            "step_name": "step1",
            "field_key": "output_folder",
            "workspace_tab_id": "__standalone__",
        })

        self.assertEqual(calls, [("pick", "出力フォルダを選択")])
        self.assertTrue(result["selected"])
        self.assertEqual(result["display_name"], "out")

    def test_pick_folder_uses_edit_dialog_for_existing_hidden_ref(self):
        calls = []
        original = self.base_dir / "original"
        edited = self.base_dir / "edited"
        original.mkdir()
        edited.mkdir()

        def pick_folder(title):
            calls.append(("pick", title))
            return None

        def edit_folder(title, current_path):
            calls.append(("edit", title, current_path))
            return str(edited)

        runtime = BridgeRuntime(
            base_dir=self.base_dir,
            pick_folder_callback=pick_folder,
            edit_folder_callback=edit_folder,
        )
        ref, _ = runtime.hidden_value_service.store_value(
            doc_session_id="tab1",
            step_name="step1",
            field_key="output_folder",
            actual_value=str(original),
        )

        result = runtime._handle_file_pick_folder({
            "title": "出力フォルダを選択",
            "step_name": "step1",
            "field_key": "output_folder",
            "current_ref": ref,
            "workspace_tab_id": "tab1",
        })

        self.assertEqual(calls, [("edit", "出力フォルダを選択", str(original))])
        self.assertTrue(result["selected"])
        self.assertEqual(result["display_name"], "edited")


if __name__ == "__main__":
    unittest.main()
