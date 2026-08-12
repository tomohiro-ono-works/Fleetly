from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path
from typing import Any

from connectors.base_connector import BaseConnector
from core.security_policies import is_web_target_allowed


class ChromeConnector(BaseConnector):
    ACTION_OPEN_IN_CHROME = "open_in_chrome"

    def execute(self, action: str, params: dict[str, Any] | None, context: dict[str, Any]):
        params = params or {}
        if action == self.ACTION_OPEN_IN_CHROME:
            return self.open_in_chrome(params, context)
        raise ValueError(f"Unknown action: {action}")

    def open_in_chrome(self, params: dict[str, Any], context: dict[str, Any]):
        url = str(params.get("url") or "").strip()
        if not url:
            raise ValueError("url は必須です。")
        if not is_web_target_allowed(url):
            raise ValueError(f"Web allowlist で許可されていない URL です: {url}")

        chrome_path = self._find_chrome_executable()
        try:
            subprocess.Popen(
                [str(chrome_path), url],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
        except OSError as error:
            raise ValueError("Chrome の起動に失敗しました。") from error

        result = self.build_execution_metadata(target=url, path=url)
        output_var = str(params.get("output_var") or "").strip()
        if output_var:
            context[output_var] = result
        return result

    @staticmethod
    def _find_chrome_executable() -> Path:
        if os.name != "nt":
            raise OSError("ChromeConnector は Windows 環境でのみ実行できます。")

        candidates = []
        chrome_on_path = shutil.which("chrome.exe")
        if chrome_on_path:
            candidates.append(Path(chrome_on_path))

        for variable_name, relative_path in (
            ("PROGRAMFILES", Path("Google/Chrome/Application/chrome.exe")),
            ("PROGRAMFILES(X86)", Path("Google/Chrome/Application/chrome.exe")),
            ("LOCALAPPDATA", Path("Google/Chrome/Application/chrome.exe")),
        ):
            root = str(os.environ.get(variable_name) or "").strip()
            if root:
                candidates.append(Path(root) / relative_path)

        for candidate in candidates:
            if candidate.is_file():
                return candidate
        raise ValueError("Google Chrome が見つかりません。Chrome をインストールしてから再実行してください。")
