import os
import subprocess
import sys
import unittest
from pathlib import Path


@unittest.skipUnless(os.name == "nt", "Windows専用")
class NativeQtIntegrationTests(unittest.TestCase):
    def _run_smoke(self, script_name, marker):
        repo_root = Path(__file__).resolve().parents[2]
        script = repo_root / "tests" / "native" / script_name
        environment = os.environ.copy()
        environment.pop("QT_QPA_PLATFORM", None)
        environment.pop("QT_OPENGL", None)
        environment.pop("QTWEBENGINE_CHROMIUM_FLAGS", None)
        completed = subprocess.run(
            [sys.executable, str(script)],
            cwd=repo_root,
            env=environment,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=45,
            check=False,
        )
        diagnostics = (
            f"stdout:\n{completed.stdout}\n"
            f"stderr:\n{completed.stderr}"
        )
        self.assertEqual(completed.returncode, 0, diagnostics)
        self.assertIn(marker, completed.stdout, diagnostics)
        self.assertNotIn("WebEnginePage still not deleted", diagnostics)

    def test_real_qwebchannel_command_round_trip(self):
        self._run_smoke(
            "qwebchannel_webengine_smoke.py",
            "QWEBCHANNEL_SMOKE_OK",
        )

    def test_production_host_starts_home_and_shuts_down(self):
        self._run_smoke(
            "gui_host_smoke.py",
            "GUI_HOST_SMOKE_OK",
        )
