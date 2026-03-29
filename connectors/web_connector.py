import os
import shutil
import subprocess
from pathlib import Path
from typing import Any, Optional
from urllib.parse import urlparse

from connectors.base_connector import BaseConnector


class WebConnector(BaseConnector):
    def execute(self, action: str, params: dict[str, Any], context: dict[str, Any]) -> Any:
        if action == "open_chrome_page":
            target = self._normalize_optional_text(params.get("url"))
            if not target:
                raise ValueError("url は必須です。")
            return self.open_chrome_page(target)
        raise ValueError(f"Unknown action: {action}")

    @staticmethod
    def _normalize_optional_text(value: Any) -> Optional[str]:
        if value is None:
            return None
        text = str(value).strip()
        return text or None

    @staticmethod
    def _find_chrome_executable() -> Optional[str]:
        executable = shutil.which("chrome") or shutil.which("chrome.exe")
        if executable:
            return executable

        candidates = [
            Path(os.environ.get("PROGRAMFILES", "")) / "Google" / "Chrome" / "Application" / "chrome.exe",
            Path(os.environ.get("PROGRAMFILES(X86)", "")) / "Google" / "Chrome" / "Application" / "chrome.exe",
            Path(os.environ.get("LOCALAPPDATA", "")) / "Google" / "Chrome" / "Application" / "chrome.exe",
        ]
        for candidate in candidates:
            if str(candidate) and candidate.exists():
                return str(candidate)
        return None

    def _resolve_open_target(self, target: str) -> str:
        normalized_target = self.normalize_file_path(target)
        if not normalized_target:
            raise ValueError("url は必須です。")

        parsed = urlparse(normalized_target)
        if parsed.scheme in {"http", "https", "file"}:
            return normalized_target

        path = Path(normalized_target)
        if path.exists():
            return path.resolve().as_uri()

        if "://" in normalized_target:
            return normalized_target

        return f"https://{normalized_target}"

    def open_chrome_page(self, target: str) -> str:
        chrome_path = self._find_chrome_executable()
        if not chrome_path:
            raise FileNotFoundError("Chrome が見つかりませんでした。")

        open_target = self._resolve_open_target(target)
        subprocess.Popen([chrome_path, open_target])
        return f"Chrome で開きました: {open_target}"
