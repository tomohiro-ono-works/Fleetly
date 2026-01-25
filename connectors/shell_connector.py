import subprocess
import os
from connectors.base_connector import BaseConnector
from typing import Any


class ShellConnector(BaseConnector):
    def execute(self, action: str, params: dict, context: dict) -> Any:
        if action == "execute_bat":
            return self.execute_bat(
                params.get("file_path"),
                params.get("args", [])
            )
        else:
            raise ValueError(f"Unknown action: {action}")

    def execute_bat(self, file_path, args):
        if not os.path.exists(file_path):
            raise FileNotFoundError(f"BATファイルが見つかりません: {file_path}")

        # コマンドの組み立て (ファイルパスにスペースがある場合を考慮してダブルクォートで囲む)
        command = [f'"{file_path}"'] + [str(arg) for arg in args]
        command_str = " ".join(command)

        try:
            # shell=True は Windows で BAT を実行する際に必要
            # text=True, capture_output=True で実行結果を取得
            result = subprocess.run(
                command_str,
                shell=True,
                check=True,  # エラー時に例外を投げる
                capture_output=True,
                text=True,
                encoding='cp932' # Windowsの標準エンコード
            )
            
            output = result.stdout.strip()
            return f"BAT実行成功:\n{output}" if output else "BAT実行成功（出力なし）"

        except subprocess.CalledProcessError as e:
            # 実行に失敗した場合（終了コードが0以外の場合）
            error_msg = f"BAT実行エラー (Exit Code: {e.returncode})\nStdout: {e.stdout}\nStderr: {e.stderr}"
            raise Exception(error_msg)