import os
import subprocess

from app.services.errors import ApplicationServiceError
from shared.google_cloud_cli import resolve_gcloud_command


def _safe_text(value):
    return str(value or "").strip()


class GoogleAuthService:
    MODE = "application-default"

    def __init__(
        self,
        *,
        popen=None,
        run=None,
        os_name=None,
        which=None,
    ):
        self._popen = popen or subprocess.Popen
        self._run = run or subprocess.run
        self._os_name = str(os_name or os.name)
        self._which = which

    def login(self, *, mode=None):
        normalized_mode = self._normalize_mode(mode)
        self._require_windows()
        command = [
            self._resolve_gcloud_command(),
            "auth",
            "application-default",
            "login",
        ]
        creation_flags = int(
            getattr(subprocess, "CREATE_NEW_CONSOLE", 0x00000010)
        )
        try:
            self._popen(
                ["cmd.exe", "/k", *command],
                creationflags=creation_flags,
                shell=False,
            )
        except FileNotFoundError as error:
            raise ApplicationServiceError(
                "E_NOT_READY",
                "gcloud コマンドが見つかりません。",
            ) from error
        except OSError as error:
            raise ApplicationServiceError(
                "E_NOT_READY",
                "Googleログインを起動できませんでした。",
            ) from error
        return {
            "launched": True,
            "provider": "google",
            "mode": normalized_mode,
        }

    def get_status(self, *, mode=None):
        normalized_mode = self._normalize_mode(mode)
        self._require_windows()
        account = ""
        try:
            gcloud_command = self._resolve_gcloud_command()
            account_result = self._run(
                [
                    gcloud_command,
                    "config",
                    "get-value",
                    "account",
                ],
                capture_output=True,
                text=True,
                timeout=10,
                shell=False,
            )
            if account_result.returncode == 0:
                value = _safe_text(account_result.stdout)
                if value and value != "(unset)":
                    account = value

            auth_result = self._run(
                [
                    gcloud_command,
                    "auth",
                    "application-default",
                    "print-access-token",
                ],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,
                text=True,
                timeout=20,
                shell=False,
            )
        except FileNotFoundError as error:
            raise ApplicationServiceError(
                "E_NOT_READY",
                "gcloud コマンドが見つかりません。",
            ) from error
        except (OSError, subprocess.SubprocessError):
            return {
                "mode": normalized_mode,
                "authenticated": False,
                "account": account,
                "error": "認証状態を確認できませんでした。",
            }

        authenticated = auth_result.returncode == 0
        return {
            "mode": normalized_mode,
            "authenticated": authenticated,
            "account": account,
            "error": "" if authenticated else "ADC is not authenticated.",
        }

    def _resolve_gcloud_command(self):
        try:
            return resolve_gcloud_command(which=self._which)
        except FileNotFoundError as error:
            raise ApplicationServiceError(
                "E_NOT_READY",
                "gcloud コマンドが見つかりません。",
            ) from error

    def _normalize_mode(self, mode):
        normalized = _safe_text(mode) or self.MODE
        if normalized != self.MODE:
            raise ValueError("mode が不正です。")
        return normalized

    def _require_windows(self):
        if self._os_name != "nt":
            raise ApplicationServiceError(
                "E_NOT_READY",
                "Google認証helperはWindows GUIでのみ利用できます。",
            )
