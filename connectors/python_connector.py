import json
import os
import shutil
import subprocess
import sys
import tempfile
from typing import Any

from connectors.base_connector import BaseConnector

RESULT_MARKER = "__ZIZ_RESULT__="


class PythonConnector(BaseConnector):
    def __init__(self) -> None:
        super().__init__()

    def execute(self, action: str, params: dict[str, Any], context: dict[str, Any]) -> Any:
        if action != "execute_python":
            raise ValueError(f"Unknown action: {action}")

        script = params.get("script")
        if not script:
            raise ValueError("script は必須です。")

        return self.execute_python(
            env_path=str(params.get("env_path", "default")),
            script=str(script),
            context=context,
        )

    def _resolve_python_command(self, env_path: str) -> str:
        normalized_env_path = self.normalize_file_path(env_path)
        if not normalized_env_path or normalized_env_path.lower() in {"default", "defult", "system"}:
            return sys.executable

        if os.path.isfile(normalized_env_path):
            return normalized_env_path

        if os.path.isdir(normalized_env_path):
            candidates = [
                os.path.join(normalized_env_path, "Scripts", "python.exe"),
                os.path.join(normalized_env_path, "bin", "python"),
            ]
            for candidate in candidates:
                if os.path.exists(candidate):
                    return candidate
            raise FileNotFoundError(f"Python 実行環境が見つかりません: {normalized_env_path}")

        executable = shutil.which(normalized_env_path)
        if executable:
            return executable

        raise FileNotFoundError(f"Python 実行環境が見つかりません: {normalized_env_path}")

    def _parse_stdout(self, stdout_text: str) -> Any:
        stripped = stdout_text.strip()
        if not stripped:
            return "Python実行成功（出力なし）"

        marker_payload = None
        lines = stripped.splitlines()
        for line in reversed(lines):
            if line.startswith(RESULT_MARKER):
                marker_payload = line[len(RESULT_MARKER):]
                break

        if marker_payload is not None:
            parsed = json.loads(marker_payload)
            if self.is_tabular_data(parsed):
                return self.to_dataframe(parsed)
            return parsed

        try:
            parsed = json.loads(stripped)
        except json.JSONDecodeError:
            return stripped

        if self.is_tabular_data(parsed):
            return self.to_dataframe(parsed)
        return parsed

    def execute_python(self, env_path: str, script: str, context: dict[str, Any]) -> Any:
        python_command = self._resolve_python_command(env_path)

        script_file_path = ""
        wrapper_file_path = ""
        try:
            with tempfile.NamedTemporaryFile("w", delete=False, suffix=".py", encoding="utf-8") as temp_file:
                script_file_path = temp_file.name
                temp_file.write(script)

            wrapper_script = f"""
import json
from pathlib import Path

import pandas as pd

RESULT_MARKER = {RESULT_MARKER!r}
USER_SCRIPT_PATH = Path({script_file_path!r})

namespace = {{"__name__": "__ziz_user__"}}
code = USER_SCRIPT_PATH.read_text(encoding="utf-8")
exec(compile(code, str(USER_SCRIPT_PATH), "exec"), namespace)

if "main" not in namespace or not callable(namespace["main"]):
    raise ValueError("main() が定義されていません。")

output = namespace["main"]()

if isinstance(output, pd.DataFrame):
    serialized = output.to_dict(orient="records")
else:
    serialized = output

print(RESULT_MARKER + json.dumps(serialized, ensure_ascii=False, default=str))
""".strip()

            with tempfile.NamedTemporaryFile("w", delete=False, suffix=".py", encoding="utf-8") as temp_file:
                wrapper_file_path = temp_file.name
                temp_file.write(wrapper_script)

            process = subprocess.Popen(
                [python_command, "-u", wrapper_file_path],
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                encoding="utf-8",
            )

            output_lines: list[str] = []
            assert process.stdout is not None
            for raw_line in process.stdout:
                line = raw_line.rstrip("\r\n")
                output_lines.append(line)
                if line and not line.startswith(RESULT_MARKER):
                    self.log_execution(line)

            return_code = process.wait()
            stdout_text = "\n".join(output_lines)
            if return_code != 0:
                raise subprocess.CalledProcessError(return_code, [python_command, "-u", wrapper_file_path], output=stdout_text)

            return self._parse_stdout(stdout_text)
        except subprocess.CalledProcessError as e:
            stdout_text = (e.output or "").strip()
            raise Exception(
                "Python実行エラー"
                f"\nExit Code: {e.returncode}"
                f"\nStdout: {stdout_text}"
            ) from e
        finally:
            if script_file_path and os.path.exists(script_file_path):
                os.remove(script_file_path)
            if wrapper_file_path and os.path.exists(wrapper_file_path):
                os.remove(wrapper_file_path)
