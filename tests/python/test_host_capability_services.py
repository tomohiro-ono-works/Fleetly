import subprocess
import tempfile
import threading
import unittest
from pathlib import Path
from types import SimpleNamespace

from app.services.errors import ApplicationServiceError
from app.services.google_auth_service import GoogleAuthService
from app.services.host_capability_service import HostCapabilityService
from app.services.preview_service import PreviewService


class HostCapabilityServiceTests(unittest.TestCase):
    def test_capabilities_and_callbacks_are_exposed_by_role(self):
        calls = []
        service = HostCapabilityService(
            pick_file=lambda title, filters: calls.append(
                ("file", title, filters)
            ) or "C:/input.csv",
            pick_folder=lambda title: calls.append(
                ("folder", title)
            ) or "C:/output",
            window_control=lambda action: calls.append(
                ("window", action)
            ) or "minimized",
            open_external=lambda url, prefer: calls.append(
                ("external", url, prefer)
            ) or "chrome",
        )

        self.assertEqual(
            service.capabilities,
            frozenset({
                "external_open",
                "file_picker",
                "folder_picker",
                "window_control",
            }),
        )
        self.assertEqual(
            service.pick_file(title="入力", filters=[{"patterns": ["*.csv"]}]),
            "C:/input.csv",
        )
        self.assertEqual(
            service.pick_folder(title="出力"),
            "C:/output",
        )
        self.assertEqual(
            service.control_window("minimize")["state"],
            "minimized",
        )
        self.assertEqual(
            service.open_external(
                url="https://example.com/path",
                prefer="chrome",
            )["opened_via"],
            "chrome",
        )
        self.assertEqual(len(calls), 4)

    def test_host_callback_is_rejected_outside_owner_thread(self):
        callback_calls = []
        errors = []
        service = HostCapabilityService(
            window_control=lambda action: callback_calls.append(action),
        )

        worker = threading.Thread(
            target=lambda: self._capture_error(
                errors,
                lambda: service.control_window("close"),
            ),
        )
        worker.start()
        worker.join(timeout=1.0)

        self.assertEqual(callback_calls, [])
        self.assertEqual(len(errors), 1)
        self.assertIsInstance(errors[0], ApplicationServiceError)
        self.assertEqual(errors[0].code, "E_NOT_READY")

    def test_external_url_rejects_credentials(self):
        service = HostCapabilityService(
            open_external=lambda url, prefer: "default-browser",
        )

        with self.assertRaises(ValueError):
            service.open_external(
                url="https://user:pass@example.com/",
                prefer="default",
            )

    def _capture_error(self, output, callback):
        try:
            callback()
        except Exception as error:
            output.append(error)


class GoogleAuthServiceTests(unittest.TestCase):
    def test_login_uses_fixed_windows_command_without_exposing_it(self):
        calls = []
        gcloud_command = (
            r"C:\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd"
        )
        service = GoogleAuthService(
            popen=lambda args, **kwargs: calls.append((args, kwargs)),
            os_name="nt",
            which=lambda _name: gcloud_command,
        )

        result = service.login(mode="application-default")

        self.assertEqual(result, {
            "launched": True,
            "provider": "google",
            "mode": "application-default",
        })
        self.assertNotIn("command", result)
        self.assertEqual(
            calls[0][0],
            [
                "cmd.exe",
                "/k",
                gcloud_command,
                "auth",
                "application-default",
                "login",
            ],
        )
        self.assertFalse(calls[0][1]["shell"])

    def test_status_discards_access_token_output(self):
        calls = []
        gcloud_command = (
            r"C:\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd"
        )
        results = iter([
            SimpleNamespace(
                returncode=0,
                stdout="user@example.com\n",
                stderr="",
            ),
            SimpleNamespace(returncode=0, stderr=""),
        ])

        def run(args, **kwargs):
            calls.append((args, kwargs))
            return next(results)

        service = GoogleAuthService(
            run=run,
            os_name="nt",
            which=lambda _name: gcloud_command,
        )

        result = service.get_status(mode="application-default")

        self.assertEqual(result, {
            "mode": "application-default",
            "authenticated": True,
            "account": "user@example.com",
            "error": "",
        })
        self.assertIs(calls[1][1]["stdout"], subprocess.DEVNULL)
        self.assertNotIn("capture_output", calls[1][1])
        self.assertNotIn("token", result)
        self.assertEqual(calls[0][0][0], gcloud_command)
        self.assertEqual(calls[1][0][0], gcloud_command)

    def test_missing_gcloud_is_reported_before_process_start(self):
        service = GoogleAuthService(
            os_name="nt",
            which=lambda _name: None,
        )

        with self.assertRaisesRegex(
            ApplicationServiceError,
            "gcloud コマンドが見つかりません",
        ):
            service.get_status(mode="application-default")


class PreviewServiceTests(unittest.TestCase):
    def setUp(self):
        self._temp_dir = tempfile.TemporaryDirectory()
        self.base_dir = Path(self._temp_dir.name)

    def tearDown(self):
        self._temp_dir.cleanup()

    def test_csv_preview_limits_display_and_schema_rows(self):
        path = self.base_dir / "input.csv"
        lines = ["id,name"]
        lines.extend(
            f"{index},{'' if index == 1 else f'name-{index}'}"
            for index in range(1, 105)
        )
        path.write_text("\n".join(lines), encoding="utf-8")

        result = PreviewService().read_csv(
            file_path=path,
            encoding="utf8",
            delimiter=",",
        )

        self.assertEqual(result["file_name"], "input.csv")
        self.assertEqual(result["encoding"], "utf-8")
        self.assertEqual(result["columns"], ["A", "B"])
        self.assertEqual(len(result["rows2d"]), 30)
        self.assertEqual(len(result["schema_rows2d"]), 100)
        self.assertIsNone(result["schema_rows2d"][1][1])

    def test_csv_preview_rejects_control_character_delimiter(self):
        path = self.base_dir / "input.csv"
        path.write_text("a,b", encoding="utf-8")

        with self.assertRaises(ValueError):
            PreviewService().read_csv(
                file_path=path,
                delimiter="\n",
            )

    def test_excel_preview_uses_shared_limits(self):
        path = self.base_dir / "input.xlsx"
        path.touch()
        calls = []

        class FakeExcelConnector:
            def preview_excel(self, file_path, *, sheet_name, max_rows):
                calls.append((file_path, sheet_name, max_rows))
                return {
                    "sheets": ["Data"],
                    "sheet_name": "Data",
                    "columns": ["A"],
                    "rows2d": [["value"]],
                    "schema_rows2d": [["value"]],
                    "base_row": 0,
                    "col_count": 1,
                }

        result = PreviewService(
            excel_connector_factory=FakeExcelConnector
        ).read_excel(
            file_path=path,
            sheet_name="Data",
        )

        self.assertEqual(result["file_name"], "input.xlsx")
        self.assertEqual(calls, [(str(path.resolve()), "Data", 30)])


if __name__ == "__main__":
    unittest.main()
