import os
import subprocess
from typing import Any

from connectors.base_connector import BaseConnector
from shared.process_runner import ProcessRunner


class ShellConnector(BaseConnector):
    def __init__(self, *, process_runner=None):
        super().__init__()
        self._process_runner = process_runner or ProcessRunner()

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
        self._process_runner.run(
            command_str,
            label="ShellConnector.execute_bat",
            shell=True,
            encoding="cp932",
            cancel_event=self._execution_cancel_event,
            secrets=self._execution_secret_values,
            on_stdout=lambda line: self.log_execution(line),
            on_stderr=lambda line: self.log_execution(
                line,
                level="warning",
            ),
        )

        message = "BAT実行成功"
        self.log_execution(f"{message}: {file_path}")
        return self.build_execution_metadata(target=file_path, path=file_path)

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
