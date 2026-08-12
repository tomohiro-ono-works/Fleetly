from pathlib import Path
import unittest
from unittest.mock import patch

from connectors.chrome_connector import ChromeConnector


class ChromeConnectorTests(unittest.TestCase):
    def test_open_in_chrome_rejects_disallowed_url_before_starting_chrome(self):
        connector = ChromeConnector()
        with patch("connectors.chrome_connector.is_web_target_allowed", return_value=False), patch.object(
            connector, "_find_chrome_executable"
        ) as find_chrome, patch("connectors.chrome_connector.subprocess.Popen") as popen:
            with self.assertRaisesRegex(ValueError, "Web allowlist"):
                connector.open_in_chrome({"url": "https://blocked.example/"}, {})

        find_chrome.assert_not_called()
        popen.assert_not_called()

    def test_open_in_chrome_starts_chrome_with_allowed_url(self):
        connector = ChromeConnector()
        url = "https://allowed.example/path"
        with patch("connectors.chrome_connector.is_web_target_allowed", return_value=True), patch.object(
            connector, "_find_chrome_executable", return_value=Path(r"C:\Chrome\chrome.exe")
        ), patch("connectors.chrome_connector.subprocess.Popen") as popen:
            result = connector.open_in_chrome({"url": url}, {})

        self.assertEqual(result.columns.tolist(), ["job_id", "target", "path", "executed_at"])
        self.assertEqual(result.iloc[0]["target"], url)
        self.assertEqual(result.iloc[0]["path"], url)
        self.assertEqual(popen.call_args.args[0], [r"C:\Chrome\chrome.exe", url])
