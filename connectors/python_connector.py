import ast
import importlib.util
import json
import os
import sys
import tempfile
from typing import Any

from connectors.base_connector import BaseConnector
from shared.process_runner import ProcessRunner

RESULT_MARKER = "__ZIZ_RESULT__="


class PythonConnector(BaseConnector):
    def __init__(self, *, process_runner=None) -> None:
        super().__init__()
        self._process_runner = process_runner or ProcessRunner()

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

    def dry_run(
        self,
        action: str,
        params: dict[str, Any],
        context: dict[str, Any],
    ) -> dict[str, Any]:
        if action != "execute_python":
            return super().dry_run(action, params, context)
        script = str(params.get("script") or "")
        if not script.strip():
            raise ValueError("script は必須です。")
        tree = ast.parse(script, filename="<zizai-python-dry-run>")
        main_function = next(
            (
                node
                for node in tree.body
                if isinstance(node, ast.FunctionDef)
                and node.name == "main"
            ),
            None,
        )
        if main_function is None:
            raise ValueError("トップレベルにmain()を定義してください。")
        positional = list(main_function.args.posonlyargs) + list(
            main_function.args.args
        )
        required_positional = positional[
            : max(0, len(positional) - len(main_function.args.defaults))
        ]
        required_keyword = [
            argument
            for argument, default in zip(
                main_function.args.kwonlyargs,
                main_function.args.kw_defaults,
            )
            if default is None
        ]
        if required_positional or required_keyword:
            raise ValueError("main()は引数なしで呼び出せる必要があります。")

        checked_imports = []
        missing_imports = []
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                names = [alias.name for alias in node.names]
            elif isinstance(node, ast.ImportFrom):
                if node.level:
                    missing_imports.append(
                        "." * node.level + str(node.module or "")
                    )
                    continue
                names = [str(node.module or "")]
            else:
                continue
            for name in names:
                root_name = name.split(".", 1)[0].strip()
                if not root_name or root_name in checked_imports:
                    continue
                checked_imports.append(root_name)
                try:
                    available = importlib.util.find_spec(root_name) is not None
                except (ImportError, ModuleNotFoundError, ValueError):
                    available = False
                if not available:
                    missing_imports.append(root_name)
        if missing_imports:
            raise ImportError(
                "利用できないlibraryがあります: "
                + ", ".join(sorted(set(missing_imports)))
            )
        return {
            "kind": "dry_run",
            "strategy": "python_static_validation",
            "executed": False,
            "validated": True,
            "checked_imports": checked_imports,
            "scope": [
                "syntax",
                "top_level_main",
                "argumentless_main",
                "static_import_availability",
            ],
            "not_validated": [
                "dynamic_import",
                "runtime_error",
                "return_value",
            ],
        }

    def _resolve_python_command(self, env_path: str) -> str:
        normalized_env_path = self.normalize_file_path(env_path)
        if not normalized_env_path or normalized_env_path.lower() in {"default", "defult", "system"}:
            return sys.executable
        raise ValueError(
            "202607版ではPython実行環境を指定できません。"
            "app同居venvを使用してください。"
        )

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

            result = self._process_runner.run(
                [python_command, "-u", wrapper_file_path],
                label="PythonConnector.execute_python",
                encoding="utf-8",
                cancel_event=self._execution_cancel_event,
                secrets=self._execution_secret_values,
                on_stdout=lambda line: (
                    None
                    if line.startswith(RESULT_MARKER)
                    else self.log_execution(line)
                ),
                on_stderr=lambda line: self.log_execution(
                    line,
                    level="warning",
                ),
            )
            return self._parse_stdout(result.stdout)
        finally:
            if script_file_path and os.path.exists(script_file_path):
                os.remove(script_file_path)
            if wrapper_file_path and os.path.exists(wrapper_file_path):
                os.remove(wrapper_file_path)
