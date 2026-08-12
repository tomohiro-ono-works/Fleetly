import base64
import tempfile
from pathlib import Path
import unittest
from unittest.mock import patch

from connectors.selenium_connector import SeleniumConnector


class _FakeDriver:
    def __init__(self):
        self.cdp_calls = []
        self.saved_viewport_path = None

    def execute_cdp_cmd(self, method, params):
        self.cdp_calls.append((method, params))
        if method == "Page.getLayoutMetrics":
            return {"contentSize": {"width": 120, "height": 340}}
        if method == "Page.captureScreenshot":
            return {"data": base64.b64encode(b"full-page").decode("ascii")}
        raise AssertionError(f"unexpected CDP method: {method}")

    def execute_script(self, _script):
        return {"width": 80, "height": 90}

    def save_screenshot(self, path):
        self.saved_viewport_path = path
        Path(path).write_bytes(b"viewport")
        return True


class _ScreenshotConnector(SeleniumConnector):
    def __init__(self, driver):
        self.driver = driver

    def _get_page(self, _params, context):
        context[self.RUNTIME_KEY] = {"session_id": "sid"}
        return self.driver


class _SwitchTo:
    def __init__(self, driver):
        self.driver = driver

    def window(self, handle):
        self.driver.active_handle = handle


class _NavigateDriver:
    def __init__(self, current_url):
        self.current_url = current_url
        self.title = "Test page"
        self.window_handles = ["handle-main"]
        self.current_window_handle = "handle-main"
        self.switch_to = _SwitchTo(self)
        self.active_handle = "handle-main"
        self.get_calls = []
        self.scripts = []
        self.page_load_timeout = None

    def set_page_load_timeout(self, timeout):
        self.page_load_timeout = timeout

    def get(self, url):
        self.get_calls.append(url)
        if url == "about:blank":
            self.current_url = url

    def execute_script(self, script):
        self.scripts.append(script)


class _NavigateConnector(SeleniumConnector):
    def __init__(self, driver=None):
        self.driver = driver or _NavigateDriver("https://allowed.example/app")
        self.ensure_count = 0

    def _ensure_runtime(self, _params, context):
        self.ensure_count += 1
        runtime = {
            "driver": self.driver,
            "tabs": {"main:current": "handle-main"},
        }
        context[self.RUNTIME_KEY] = runtime
        return runtime


class SeleniumConnectorScreenshotTests(unittest.TestCase):
    def test_page_screenshot_uses_full_page_cdp_when_requested(self):
        driver = _FakeDriver()
        connector = _ScreenshotConnector(driver)
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "shot.png"
            result = connector.screenshot({"path": str(path), "full_page": True}, {})

            self.assertEqual(path.read_bytes(), b"full-page")
            self.assertEqual(result.columns.tolist(), ["job_id", "target", "path", "executed_at"])
            self.assertEqual(result.iloc[0]["job_id"], "sid")
            self.assertEqual(result.iloc[0]["target"], "page")
            self.assertEqual(result.iloc[0]["path"], str(path))
            self.assertEqual(driver.cdp_calls[0][0], "Page.getLayoutMetrics")
            capture_method, capture_params = driver.cdp_calls[1]
            self.assertEqual(capture_method, "Page.captureScreenshot")
            self.assertTrue(capture_params["captureBeyondViewport"])
            self.assertEqual(capture_params["clip"]["height"], 340)

    def test_page_screenshot_can_use_viewport_only(self):
        driver = _FakeDriver()
        connector = _ScreenshotConnector(driver)
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "shot.png"
            result = connector.screenshot({"path": str(path), "full_page": "false"}, {})

            self.assertEqual(path.read_bytes(), b"viewport")
            self.assertEqual(result.iloc[0]["job_id"], "sid")
            self.assertEqual(result.iloc[0]["path"], str(path))
            self.assertEqual(driver.saved_viewport_path, str(path))
            self.assertEqual(driver.cdp_calls, [])


class SeleniumConnectorAllowlistTests(unittest.TestCase):
    def test_navigate_rejects_disallowed_url_before_runtime_creation(self):
        connector = _NavigateConnector()
        with patch("connectors.selenium_connector.is_web_target_allowed", return_value=False):
            with self.assertRaisesRegex(ValueError, "Web allowlist"):
                connector.navigate({"url": "https://blocked.example/"}, {})

        self.assertEqual(connector.ensure_count, 0)

    def test_navigate_allows_allowlisted_url(self):
        driver = _NavigateDriver("https://allowed.example/app")
        connector = _NavigateConnector(driver)
        with patch("connectors.selenium_connector.is_web_target_allowed", return_value=True):
            result = connector.navigate({"url": "https://allowed.example/app", "tab_mode": "current"}, {})

        self.assertEqual(driver.get_calls, ["https://allowed.example/app"])
        self.assertEqual(result.columns.tolist(), ["job_id", "target", "path", "executed_at"])
        self.assertEqual(result.iloc[0]["target"], "https://allowed.example/app")
        self.assertEqual(result.iloc[0]["path"], "https://allowed.example/app")
        self.assertTrue(str(result.iloc[0]["job_id"]).strip())

    def test_navigate_blocks_disallowed_redirect_target(self):
        driver = _NavigateDriver("https://blocked.example/private")
        connector = _NavigateConnector(driver)

        def allowed(url):
            return str(url).startswith("https://allowed.example/")

        with patch("connectors.selenium_connector.is_web_target_allowed", side_effect=allowed):
            with self.assertRaisesRegex(ValueError, "遷移しました"):
                connector.navigate({"url": "https://allowed.example/start", "tab_mode": "current"}, {})

        self.assertEqual(driver.get_calls, ["https://allowed.example/start", "about:blank"])
        self.assertIn("window.stop();", driver.scripts)
        self.assertEqual(driver.current_url, "about:blank")


if __name__ == "__main__":
    unittest.main()
