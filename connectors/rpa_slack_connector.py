import subprocess
import time
from pathlib import Path
from typing import Any, Optional

import pyautogui
import pygetwindow as gw
import pyperclip
import win32gui

from connectors.base_connector import BaseConnector


class RpaSlackConnector(BaseConnector):
    def execute(self, action: str, params: dict[str, Any], context: dict[str, Any]) -> Any:
        if action == "move_channel":
            base_url = self._required_text(params, "base_url")
            channel_name = self._required_text(params, "channel_name")
            speed = self._parse_speed(params.get("speed", 1.0))
            return self.move_channel(base_url=base_url, channel_name=channel_name, speed=speed)

        if action == "delete_draft":
            speed = self._parse_speed(params.get("speed", 1.0))
            return self.delete_draft(speed=speed)

        if action == "write_draft":
            message = self._required_text(params, "message")
            speed = self._parse_speed(params.get("speed", 1.0))
            return self.write_draft(message=message, speed=speed)

        if action == "get_chrome_info":
            return self.get_chrome_info()

        raise ValueError(f"Unknown action: {action}")

    @staticmethod
    def _normalize_optional_text(value: Any) -> Optional[str]:
        if value is None:
            return None
        text = str(value).strip()
        return text or None

    def _required_text(self, params: dict[str, Any], key: str) -> str:
        value = self._normalize_optional_text(params.get(key))
        if not value:
            raise ValueError(f"{key} は必須です。")
        return value

    @staticmethod
    def _parse_speed(value: Any) -> float:
        speed = float(value)
        if speed <= 0:
            raise ValueError("speed は 0 より大きい値を指定してください。")
        return speed

    @staticmethod
    def _find_chrome_executable() -> Optional[str]:
        from shutil import which
        import os

        executable = which("chrome") or which("chrome.exe")
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

    def _open_in_chrome(self, url: str) -> None:
        chrome_path = self._find_chrome_executable()
        if not chrome_path:
            raise FileNotFoundError("Chrome が見つかりませんでした。")
        subprocess.Popen([chrome_path, url])

    @staticmethod
    def get_window_title() -> Optional[str]:
        active_window = gw.getActiveWindow()
        return active_window.title if active_window else None

    def get_chrome_info(self) -> dict[str, str]:
        hwnd = win32gui.GetForegroundWindow()
        full_title = win32gui.GetWindowText(hwnd)
        tab_name = "不明なアプリ"
        app_name = "不明なアプリ内区分"
        if " - Google Chrome" in full_title:
            tab_name, app_name = full_title.rsplit(" - ", 1)

        info = {
            "window_title": full_title,
            "tab_name": tab_name,
            "app_name": app_name,
        }
        self.log_execution(f"タブ名: {tab_name}")
        self.log_execution(f"アプリ名: {app_name}")
        return info

    def move_channel(self, base_url: str, channel_name: str, speed: float = 1.0) -> str:
        self.get_chrome_info()
        self._open_in_chrome(base_url)
        time.sleep(4 * speed)
        self.get_chrome_info()
        pyautogui.hotkey("ctrl", "k")
        time.sleep(1.3 * speed)
        pyperclip.copy(channel_name)
        pyautogui.hotkey("ctrl", "v")
        time.sleep(1.3 * speed)
        pyautogui.press("enter")
        self.get_chrome_info()
        return f"Slack チャンネルへ移動しました: {channel_name}"

    def delete_draft(self, speed: float = 1.0) -> str:
        time.sleep(1.3 * speed)
        pyautogui.hotkey("ctrl", "a")
        pyautogui.press("backspace")
        return "下書きを削除しました。"

    def write_draft(self, message: str, speed: float = 1.0) -> str:
        pyperclip.copy(message)
        time.sleep(1.3 * speed)
        pyautogui.hotkey("ctrl", "v")
        return "下書きへメッセージを書き込みました。"
