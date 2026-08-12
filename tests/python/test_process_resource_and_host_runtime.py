import logging
import os
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch

import zizai
from app.gui.single_instance import GuiSingleInstanceGuard
from app.runtime.managed_resources import ManagedResourceRegistry
from connectors.python_connector import PythonConnector
from connectors.selenium_connector import SeleniumConnector
from connectors.shell_connector import ShellConnector
from core.logger import RETENTION_DAYS, _prune_log_files
from shared.process_runner import (
    ProcessCancelledError,
    ProcessExitError,
    ProcessRunner,
    ProcessTimeoutError,
    TRUNCATED_MARKER,
)
from shared.security_sanitizer import MASK


class ProcessRunnerTests(unittest.TestCase):
    def test_captures_streams_masks_secret_and_reports_exit(self):
        stdout_lines = []
        stderr_lines = []
        runner = ProcessRunner()
        code = (
            "import sys;"
            "print('token=secret-value');"
            "print('diagnostic', file=sys.stderr);"
            "raise SystemExit(3)"
        )

        with self.assertRaises(ProcessExitError) as context:
            runner.run(
                [sys.executable, "-c", code],
                label="test.process",
                secrets={"secret-value"},
                on_stdout=stdout_lines.append,
                on_stderr=stderr_lines.append,
            )

        error = context.exception
        self.assertEqual(error.result.returncode, 3)
        self.assertIn(MASK, error.result.stdout)
        self.assertNotIn("secret-value", str(error))
        self.assertEqual(stdout_lines, [f"token={MASK}"])
        self.assertEqual(stderr_lines, ["diagnostic"])
        self.assertIn("Exit Code: 3", str(error))

    def test_output_is_bounded_and_truncation_is_reported_once(self):
        events = []
        runner = ProcessRunner(output_limit_bytes=64)

        result = runner.run(
            [sys.executable, "-c", "print('X' * 4096)"],
            on_stdout=events.append,
        )

        self.assertTrue(result.stdout_truncated)
        self.assertIn(TRUNCATED_MARKER.strip(), result.stdout)
        self.assertEqual(
            events.count(TRUNCATED_MARKER.strip()),
            1,
        )
        self.assertLess(len(result.stdout.encode("utf-8")), 128)

    def test_cancel_stops_running_process(self):
        cancel_event = threading.Event()
        timer = threading.Timer(0.2, cancel_event.set)
        timer.start()
        started = time.monotonic()
        try:
            with self.assertRaises(ProcessCancelledError):
                ProcessRunner().run(
                    [
                        sys.executable,
                        "-c",
                        "import time; time.sleep(30)",
                    ],
                    cancel_event=cancel_event,
                )
        finally:
            timer.cancel()

        self.assertLess(time.monotonic() - started, 5)

    def test_timeout_stops_running_process(self):
        started = time.monotonic()
        with self.assertRaises(ProcessTimeoutError):
            ProcessRunner().run(
                [
                    sys.executable,
                    "-c",
                    "import time; time.sleep(30)",
                ],
                timeout_seconds=0.2,
            )

        self.assertLess(time.monotonic() - started, 5)


class LogRetentionTests(unittest.TestCase):
    def test_prune_removes_expired_and_oldest_but_keeps_today(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            log_dir = Path(temp_dir)
            today = log_dir / "gui_app_log_today.log"
            yesterday = log_dir / "cli_app_log_yesterday.log"
            expired = log_dir / "run_log_expired.jsonl"
            for path in (today, yesterday, expired):
                path.write_bytes(b"x" * 64)
            os.utime(
                yesterday,
                (time.time() - 86400, time.time() - 86400),
            )
            os.utime(
                expired,
                (time.time() - (11 * 86400),) * 2,
            )

            _prune_log_files(
                log_dir,
                retention_days=10,
                total_limit_bytes=1,
            )

            self.assertTrue(today.exists())
            self.assertFalse(yesterday.exists())
            self.assertFalse(expired.exists())


class PythonConnectorProcessTests(unittest.TestCase):
    def test_uses_current_interpreter_and_logs_print(self):
        messages = []

        class _Logger:
            def info(self, message, **_kwargs):
                messages.append(str(message))

            warning = info

        connector = PythonConnector()
        connector.set_execution_logger(_Logger())
        try:
            result = connector.execute(
                "execute_python",
                {
                    "script": (
                        "def main():\n"
                        "    print('hello')\n"
                        "    return {'value': 7}\n"
                    )
                },
                {},
            )
        finally:
            connector.clear_execution_logger()

        self.assertEqual(result.iloc[0]["value"], 7)
        self.assertIn("hello", messages)
        with self.assertRaisesRegex(ValueError, "指定できません"):
            connector._resolve_python_command(r"C:\other\python.exe")


class ManagedResourceTests(unittest.TestCase):
    def test_step_replacement_and_document_release_cleanup_once(self):
        registry = ManagedResourceRegistry()
        cleaned = []
        first = object()
        second = object()

        registry.register(
            kind="websession",
            value=first,
            cleanup=cleaned.append,
            run_id="run_1",
            doc_session_id="doc_1",
            step_id="01",
            replace_step=True,
        )
        registry.register(
            kind="websession",
            value=second,
            cleanup=cleaned.append,
            run_id="run_2",
            doc_session_id="doc_1",
            step_id="01",
            replace_step=True,
        )

        self.assertEqual(cleaned, [first])
        self.assertEqual(registry.release_document("doc_1"), 1)
        self.assertEqual(cleaned, [first, second])
        self.assertEqual(registry.release_all(), 0)

    def test_selenium_runtime_registers_opaque_id_and_quits(self):
        class _Driver:
            def __init__(self):
                self.quit_count = 0

            def quit(self):
                self.quit_count += 1

        from app.runtime.managed_resources import managed_resource_registry

        managed_resource_registry.release_all()
        connector = SeleniumConnector()
        driver = _Driver()
        runtime = {"driver": driver, "tabs": {}}
        context = {
            "__run_id": "run_1",
            "__run_kind": "step",
            "__doc_session_id": "doc_1",
            "__step_id": "01",
        }

        resource_id = connector._store_runtime(context, runtime)

        self.assertTrue(resource_id.startswith("websession_"))
        self.assertIs(
            managed_resource_registry.get(resource_id),
            runtime,
        )
        self.assertEqual(
            managed_resource_registry.release_step("doc_1", "01"),
            1,
        )
        self.assertEqual(driver.quit_count, 1)


@unittest.skipUnless(os.name == "nt", "Windows専用")
class WindowsHostRuntimeTests(unittest.TestCase):
    def test_shell_connector_streams_output_through_process_runner(self):
        messages = []

        class _Logger:
            def info(self, message, **_kwargs):
                messages.append(("info", str(message)))

            def warning(self, message, **_kwargs):
                messages.append(("warning", str(message)))

        with tempfile.TemporaryDirectory() as temp_dir:
            batch_path = Path(temp_dir) / "success.bat"
            batch_path.write_text(
                "@echo off\n"
                "echo normal-output\n"
                "echo warning-output 1>&2\n"
                "exit /b 0\n",
                encoding="ascii",
            )
            connector = ShellConnector()
            connector.set_execution_logger(_Logger())
            try:
                result = connector.execute(
                    "execute_bat",
                    {"file_path": str(batch_path)},
                    {},
                )
            finally:
                connector.clear_execution_logger()

        self.assertEqual(
            result.iloc[0]["target"],
            str(batch_path).replace("\\", "/"),
        )
        self.assertIn(("info", "normal-output"), messages)
        self.assertTrue(
            any(
                level == "warning"
                and message.strip() == "warning-output"
                for level, message in messages
            )
        )

    def test_single_instance_lock_is_released_by_owner(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            lock_path = Path(temp_dir) / "gui.lock"
            first = GuiSingleInstanceGuard(lock_path)
            second = GuiSingleInstanceGuard(lock_path)
            self.assertTrue(first.acquire())
            self.assertFalse(second.acquire())
            first.release()
            self.assertTrue(second.acquire())
            second.release()

    def test_entrypoint_rejects_second_instance_before_backend(self):
        args = type(
            "Args",
            (),
            {
                "show_help": False,
                "flow_path": None,
                "debug": False,
            },
        )()
        guard = unittest.mock.MagicMock()
        guard.acquire.return_value = False
        with patch("zizai.parse_args", return_value=args), patch(
            "zizai.GuiSingleInstanceGuard",
            return_value=guard,
        ), patch("zizai.run_webview_app") as run_webview:
            result = zizai.main()

        self.assertEqual(result, 2)
        run_webview.assert_not_called()

    def test_logger_separates_mode_debug_and_masks_standard_path(self):
        repo_root = Path(__file__).resolve().parents[2]
        probe = Path(__file__).with_name("logger_mode_probe.py")
        with tempfile.TemporaryDirectory() as temp_dir:
            log_dir = Path(temp_dir)
            subprocess.run(
                [
                    sys.executable,
                    str(probe),
                    str(log_dir),
                    "cli",
                    "1",
                ],
                cwd=repo_root,
                check=True,
                timeout=15,
            )
            cli_logs = list(log_dir.glob("cli_app_log_*.log"))
            debug_logs = list(log_dir.glob("debug_log_*.log"))

            self.assertEqual(RETENTION_DAYS, 10)
            self.assertEqual(len(cli_logs), 1)
            self.assertEqual(len(debug_logs), 1)
            cli_text = cli_logs[0].read_text(encoding="utf-8")
            debug_text = debug_logs[0].read_text(encoding="utf-8")
            self.assertIn(MASK, cli_text)
            self.assertNotIn(r"C:\Users\probe", cli_text)
            self.assertIn(r"C:\Users\probe\debug.csv", debug_text)
            self.assertNotIn("secret-value", debug_text)

            regular_log_dir = log_dir / "regular"
            subprocess.run(
                [
                    sys.executable,
                    str(probe),
                    str(regular_log_dir),
                    "gui",
                    "0",
                ],
                cwd=repo_root,
                check=True,
                timeout=15,
            )
            self.assertEqual(
                len(list(regular_log_dir.glob("gui_app_log_*.log"))),
                1,
            )
            self.assertEqual(
                list(regular_log_dir.glob("debug_log_*.log")),
                [],
            )
