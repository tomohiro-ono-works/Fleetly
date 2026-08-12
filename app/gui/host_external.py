import os
import shutil
import subprocess
from pathlib import Path


def _find_chrome_executable():
    candidates = [
        shutil.which("chrome"),
        shutil.which("chrome.exe"),
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        str(
            Path.home()
            / r"AppData\Local\Google\Chrome\Application\chrome.exe"
        ),
    ]
    for candidate in candidates:
        text = str(candidate or "").strip()
        if text and Path(text).exists():
            return text
    return ""


def open_external_url(url, prefer="chrome"):
    if os.name != "nt":
        raise OSError("external openはWindows GUIでのみ利用できます。")
    normalized_prefer = str(prefer or "").strip().lower() or "chrome"
    if normalized_prefer == "chrome":
        chrome_executable = _find_chrome_executable()
        if chrome_executable:
            subprocess.Popen(
                [chrome_executable, str(url)],
                shell=False,
            )
            return "chrome"
        subprocess.Popen(
            ["cmd.exe", "/c", "start", "", "chrome", str(url)],
            creationflags=int(
                getattr(subprocess, "CREATE_NO_WINDOW", 0x08000000)
            ),
            shell=False,
        )
        return "chrome-cmd-start"
    os.startfile(str(url))
    return "default-browser"
