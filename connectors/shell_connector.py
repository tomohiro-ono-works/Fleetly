from datetime import datetime, timezone
import os
import subprocess
from typing import Any

import pandas as pd

from connectors.base_connector import BaseConnector


class ShellConnector(BaseConnector):
    def execute(self, action: str, params: dict, context: dict) -> Any:
        params = params or {}
        if action == "execute_bat":
            return self.execute_bat(
                params.get("file_path"),
                params.get("args", "")
            )
        raise ValueError(f"Unknown action: {action}")

    def execute_bat(self, file_path, args):
        file_path = self.normalize_file_path(file_path)
        if not file_path:
            raise ValueError("file_path は必須です。")
        if not os.path.exists(file_path):
            raise FileNotFoundError(f"BATファイルが見つかりません: {file_path}")

        command_str = self._build_command(file_path, args)

        try:
            # shell=True は Windows で BAT を実行する際に必要
            result = subprocess.run(
                command_str,
                shell=True,
                check=True,
                capture_output=True,
                text=True,
                encoding="cp932",
                errors="replace",
            )

        except subprocess.CalledProcessError as e:
            error_msg = f"BAT実行エラー (Exit Code: {e.returncode})\nStdout: {e.stdout}\nStderr: {e.stderr}"
            raise RuntimeError(error_msg) from e

        stdout = (result.stdout or "").strip()
        stderr = (result.stderr or "").strip()
        message = "BAT実行成功" if stdout else "BAT実行成功（出力なし）"
        self.log_execution(f"{message}: {file_path}")
        return pd.DataFrame([{
            "status": "success",
            "executed_at": datetime.now(timezone.utc).isoformat(),
            "connector": "ShellConnector",
            "action": "execute_bat",
            "target": str(file_path),
            "message": message,
            "stdout": stdout,
            "stderr": stderr,
            "returncode": result.returncode,
        }])

    @staticmethod
    def _build_command(file_path: str, args: Any) -> str:
        base_command = subprocess.list2cmdline([file_path])
        if args is None:
            return base_command
        if isinstance(args, str):
            arg_text = args.strip()
            return f"{base_command} {arg_text}" if arg_text else base_command
        if isinstance(args, (list, tuple)):
            arg_values = [str(arg) for arg in args if arg is not None]
            return subprocess.list2cmdline([file_path, *arg_values])
        return subprocess.list2cmdline([file_path, str(args)])
