import os
import shutil
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional
from urllib.parse import urlparse

import pandas as pd

from connectors.base_connector import BaseConnector
from core.security_policies import is_web_target_allowed


class WebConnector(BaseConnector):
    def execute(self, action: str, params: dict[str, Any], context: dict[str, Any]) -> Any:
        if action not in {"open_chrome_page", "lookat_pages", "lookat_page"}:
            raise ValueError(f"Unknown action: {action}")

        target = self._normalize_optional_text(params.get("url"))
        if not target:
            raise ValueError("url は必須です。")

        try:
            result = self.open_chrome_page(target)
            return self._build_result_dataframe(
                action=action,
                target=result["target"],
                status="success",
                message=result["message"],
            )
        except Exception as error:
            raise RuntimeError(str(error)) from error

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

    def _build_result_dataframe(self, *, action: str, target: str, status: str, message: str) -> pd.DataFrame:
        return pd.DataFrame([{
            "status": str(status),
            "executed_at": datetime.now(timezone.utc).isoformat(),
            "connector": "WebConnector",
            "action": str(action),
            "target": str(target or ""),
            "message": str(message or ""),
        }])

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

    def open_chrome_page(self, target: str) -> dict[str, str]:
        chrome_path = self._find_chrome_executable()
        if not chrome_path:
            raise FileNotFoundError("Chrome が見つかりませんでした。")

        open_target = self._resolve_open_target(target)
        parsed = urlparse(open_target)
        if parsed.scheme in {"http", "https"} and not is_web_target_allowed(open_target):
            raise ValueError(f"Web allowlist に未登録のため開けません: {parsed.netloc}{parsed.path or '/'}")
        subprocess.Popen([chrome_path, open_target])
        return {
            "target": open_target,
            "message": f"Chrome で開きました: {open_target}",
        }
