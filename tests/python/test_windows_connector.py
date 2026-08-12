import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import call, patch

import pandas as pd

from connectors.windows_connector import WindowsConnector
from core.logger import setup_logger
from core.workflow_engine import WorkflowEngine


class WindowsConnectorTests(unittest.TestCase):
    def setUp(self):
        self.connector = WindowsConnector()

    def test_rename_and_move_file_moves_to_new_folder_and_name(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            source = root / "source.txt"
            source.write_text("hello", encoding="utf-8")

            result = self.connector.execute("rename_and_move_file", {
                "source_file_path": str(source),
                "destination_folder": str(root / "moved"),
                "destination_file_name": "renamed.txt",
            }, {})

            target = root / "moved" / "renamed.txt"
            self.assertIsInstance(result, pd.DataFrame)
            self.assertTrue(target.exists())
            self.assertEqual(target.read_text(encoding="utf-8"), "hello")
            self.assertEqual(result.columns.tolist(), ["job_id", "target", "path", "executed_at"])
            self.assertEqual(result.iloc[0]["target"], str(target))
            self.assertEqual(result.iloc[0]["path"], str(target))

    def test_create_markdown_file_supports_append_and_replace(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            target = Path(temp_dir) / "memo.md"
            self.connector.execute("create_markdown_file", {
                "write_mode": "replace",
                "target_file_path": str(target),
                "content": "first\n",
            }, {})
            self.connector.execute("create_markdown_file", {
                "write_mode": "append",
                "target_file_path": str(target),
                "content": "second\n",
            }, {})
            self.assertEqual(target.read_text(encoding="utf-8"), "first\nsecond\n")

    def test_rename_and_move_file_can_skip_missing_source(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            missing = Path(temp_dir) / "missing.txt"
            result = self.connector.execute("rename_and_move_file", {
                "source_file_path": str(missing),
                "allow_missing_source": True,
            }, {})
            self.assertEqual(result.columns.tolist(), ["job_id", "target", "path", "executed_at"])
            self.assertEqual(result.iloc[0]["target"], str(missing))
            self.assertEqual(result.iloc[0]["path"], str(missing))

    def test_search_files_by_name_returns_folder_and_file_name(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            (root / "売上_202604.csv").write_text("a", encoding="utf-8")
            (root / "memo.txt").write_text("b", encoding="utf-8")

            result = self.connector.execute("search_files_by_name", {
                "root_folder": str(root),
                "recursive": False,
                "file_name_pattern": "^売上_",
                "file_extension_pattern": "csv",
                "max_elapsed_seconds": 120,
            }, {})

            self.assertEqual(len(result), 1)
            self.assertEqual(result.iloc[0]["folder_path"], str(root))
            self.assertEqual(result.iloc[0]["file_name"], "売上_202604.csv")

    def test_search_text_in_files_returns_line_and_context(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            target = root / "sample.md"
            target.write_text("line1\nhello target\nline3\n", encoding="utf-8")

            result = self.connector.execute("search_text_in_files", {
                "root_folder": str(root),
                "recursive": False,
                "file_name_pattern": "^sample$",
                "file_extension_pattern": "md",
                "content_pattern": "hello",
                "context_lines": 1,
                "max_elapsed_seconds": 120,
            }, {})

            self.assertEqual(len(result), 1)
            self.assertEqual(result.iloc[0]["folder_path"], str(root))
            self.assertEqual(result.iloc[0]["file_name"], "sample.md")
            self.assertEqual(int(result.iloc[0]["line_number"]), 2)
            self.assertEqual(result.iloc[0]["matched_line"], "hello target")
            self.assertIn("line1", result.iloc[0]["context_excerpt"])
            self.assertIn("line3", result.iloc[0]["context_excerpt"])

    def test_define_values_accepts_japanese_names(self):
        context = {"current_date": "2026-05-25", "user_name": "tester"}
        result = self.connector.execute("define_values", {
            "define_values": [
                {"name": "売上_合計", "value": 100},
                {"name": "顧客名", "value": "山田"}
            ]
        }, context)

        self.assertEqual(context["売上_合計"], 100)
        self.assertEqual(context["顧客名"], "山田")
        self.assertEqual(result.columns.tolist(), ["job_id", "target", "path", "executed_at"])
        self.assertEqual(result.iloc[0]["target"], "売上_合計, 顧客名")
        define_rows = result.attrs.get("ziz_define_values")
        self.assertEqual(define_rows[0]["definition_type"], "defined")
        self.assertEqual(define_rows[1]["definition_type"], "defined")

    def test_define_values_duplicate_name_overwrites_without_error(self):
        context = {}
        result = self.connector.execute("define_values", {
            "define_values": [
                {"name": "変数A", "value": 1},
                {"name": "変数A", "value": 2}
            ]
        }, context)

        self.assertEqual(context["変数A"], 2)
        self.assertEqual(len(result), 1)
        define_rows = result.attrs.get("ziz_define_values")
        self.assertEqual(len(define_rows), 2)
        self.assertEqual(define_rows[0]["definition_type"], "defined")
        self.assertEqual(define_rows[1]["definition_type"], "overwritten")

    def test_mouse_click_sends_right_double_click_at_specified_coordinates(self):
        with patch("connectors.windows_connector.pyautogui.click") as click:
            result = self.connector.execute("mouse_click", {
                "x": 640,
                "y": 480,
                "button": "right",
                "click_count": 2,
            }, {})

        click.assert_called_once_with(x=640, y=480, clicks=2, button="right")
        self.assertEqual(result.iloc[0]["target"], "screen:(640, 480)")

    def test_mouse_click_uses_runtime_cursor_position_when_requested(self):
        with patch("connectors.windows_connector.pyautogui.position", return_value=SimpleNamespace(x=12, y=34)) as position, patch(
            "connectors.windows_connector.pyautogui.click"
        ) as click:
            result = self.connector.execute("mouse_click", {
                "coordinate_mode": "current",
                "button": "left",
                "click_count": 1,
            }, {})

        position.assert_called_once_with()
        click.assert_called_once_with(x=12, y=34, clicks=1, button="left")
        self.assertEqual(result.iloc[0]["target"], "screen:(12, 34)")

    def test_input_text_replace_selects_all_before_pasting_unicode_text(self):
        with patch("connectors.windows_connector.pyautogui.hotkey") as hotkey, patch(
            "connectors.windows_connector.pyperclip.paste",
            return_value="original",
        ) as paste, patch("connectors.windows_connector.pyperclip.copy") as copy:
            result = self.connector.execute("input_text", {
                "input_mode": "replace",
                "text": "あ",
            }, {})

        hotkey.assert_has_calls([call("ctrl", "a"), call("ctrl", "v")])
        paste.assert_called_once_with()
        copy.assert_has_calls([call("あ"), call("original")])
        self.assertEqual(result.iloc[0]["target"], "active_window")

    def test_send_keys_combines_selected_modifiers_and_special_key(self):
        with patch("connectors.windows_connector.pyautogui.hotkey") as hotkey, patch(
            "connectors.windows_connector.time.sleep"
        ) as sleep:
            result = self.connector.execute("send_keys", {
                "modifier_keys": ["ctrl", "shift"],
                "key": "ENTER",
                "wait_seconds": 2,
            }, {})

        hotkey.assert_called_once_with("ctrl", "shift", "enter")
        sleep.assert_called_once_with(2)
        self.assertEqual(result.iloc[0]["target"], "active_window")

    def test_wait_sleeps_for_requested_duration(self):
        with patch("connectors.windows_connector.time.sleep") as sleep:
            result = self.connector.execute("wait", {"duration_seconds": 2}, {})

        sleep.assert_called_once_with(2)
        self.assertEqual(result.iloc[0]["target"], "active_window")

    def test_send_keys_rejects_unsupported_key(self):
        with self.assertRaisesRegex(ValueError, "key は英数字"):
            self.connector.execute("send_keys", {"key": "CTRL+A"}, {})

    def test_wait_rejects_duration_over_ten_minutes(self):
        with self.assertRaisesRegex(ValueError, "600 秒"):
            self.connector.execute("wait", {"duration_seconds": 601}, {})


class WorkflowEngineTemplateResolutionTests(unittest.TestCase):
    def test_markdown_action_can_resolve_dataframe_first_row_reference(self):
        engine = WorkflowEngine(setup_logger())
        with tempfile.TemporaryDirectory() as temp_dir:
            target = Path(temp_dir) / "output.md"
            dataframe = pd.DataFrame([{"field_name": "value-1"}, {"field_name": "value-2"}])
            config = {
                "metadata": {"name": "template-test"},
                "steps": [
                    {
                        "step_id": "step2",
                        "connector": "WindowsConnector",
                        "action": "create_markdown_file",
                        "params": {
                            "write_mode": "replace",
                            "target_file_path": str(target),
                            "content": "Result: {{step1.field_name}}",
                        },
                        "output_variable": "step2",
                    }
                ],
                "flows": {},
            }

            report = engine.run_flow_from_config(
                config,
                flow_path=str(target),
                initial_context={"step1": dataframe},
            )

            self.assertEqual(report["status"], "success")
            self.assertEqual(target.read_text(encoding="utf-8"), "Result: value-1")

    def test_template_can_resolve_japanese_variable_name(self):
        engine = WorkflowEngine(setup_logger())
        with tempfile.TemporaryDirectory() as temp_dir:
            target = Path(temp_dir) / "output_ja.md"
            config = {
                "metadata": {"name": "template-ja-test"},
                "steps": [
                    {
                        "step_id": "step1",
                        "connector": "WindowsConnector",
                        "action": "define_values",
                        "params": {
                            "define_values": [
                                {"name": "売上_合計", "value": 12345}
                            ]
                        },
                        "output_variable": "step1",
                    },
                    {
                        "step_id": "step2",
                        "connector": "WindowsConnector",
                        "action": "create_markdown_file",
                        "params": {
                            "write_mode": "replace",
                            "target_file_path": str(target),
                            "content": "売上={{売上_合計}}",
                        },
                        "output_variable": "step2",
                    },
                ],
                "flows": {},
            }

            report = engine.run_flow_from_config(config, flow_path=str(target))
            self.assertEqual(report["status"], "success")
            self.assertEqual(target.read_text(encoding="utf-8"), "売上=12345")


if __name__ == "__main__":
    unittest.main()
