from __future__ import annotations

import json
import os
import re
import shutil
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pandas as pd

from connectors.base_connector import BaseConnector


class WindowsConnector(BaseConnector):
    VARIABLE_NAME_PATTERN = re.compile(r"^[a-zA-Z0-9_\u3040-\u309F\u30A0-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\u3005]+$")
    SYSTEM_FIXED_VARIABLES = {"current_date", "user_name"}

    def execute(self, action: str, params: dict[str, Any], context: dict[str, Any]):
        if action == "define_values":
            return self.define_values(params.get("define_values"), context)
        if action == "rename_and_move_file":
            return self.rename_and_move_file(params)
        if action == "create_markdown_file":
            return self.create_markdown_file(params)
        if action == "search_files_by_name":
            return self.search_files_by_name(params)
        if action == "search_text_in_files":
            return self.search_text_in_files(params)
        raise ValueError(f"Unknown action: {action}")

    def _normalize_define_values(self, raw_define_values):
        if raw_define_values is None:
            return []

        parsed = raw_define_values
        if isinstance(parsed, str):
            text = parsed.strip()
            if not text:
                return []
            try:
                parsed = json.loads(text)
            except json.JSONDecodeError as error:
                raise ValueError(f"define_values は JSON 形式で指定してください: {error}") from error

        if isinstance(parsed, dict):
            parsed = [{"name": key, "value": value} for key, value in parsed.items()]

        if not isinstance(parsed, list):
            raise ValueError("define_values は配列で指定してください。")

        rows = []
        for item in parsed:
            if not isinstance(item, dict):
                raise ValueError("define_values の各要素はオブジェクトで指定してください。")
            rows.append({
                "name": str(item.get("name") or item.get("key") or "").strip(),
                "value": item.get("value", item.get("val")),
            })
        return rows

    def _validate_define_values(self, rows):
        for row in rows:
            name = str(row.get("name") or "").strip()
            if not name:
                continue
            if not self.VARIABLE_NAME_PATTERN.fullmatch(name):
                raise ValueError(f"変数名 '{name}' は無効です。ひらがな / カタカナ / 漢字 / 英数字 / _ のみ使用できます。")

    def define_values(self, define_values, context):
        rows = self._normalize_define_values(define_values)
        self._validate_define_values(rows)

        output_rows = []
        for row in rows:
            name = str(row.get("name") or "").strip()
            if not name:
                continue
            existed_before = name in context
            if name in self.SYSTEM_FIXED_VARIABLES:
                fixed_value = context.get(name, row.get("value"))
                context[name] = fixed_value
                output_rows.append({
                    "variable_name": name,
                    "value": fixed_value,
                    "definition_type": "overwritten" if existed_before else "defined",
                })
                continue

            value = row.get("value")
            context[name] = value
            output_rows.append({
                "variable_name": name,
                "value": value,
                "definition_type": "overwritten" if existed_before else "defined",
            })

        return self.to_dataframe(output_rows)

    def rename_and_move_file(self, params: dict[str, Any]) -> pd.DataFrame:
        source_file_path = self._required_path_text(params, "source_file_path")
        destination_folder = self._optional_path_text(params.get("destination_folder"))
        destination_file_name = self._optional_text(params.get("destination_file_name"))
        allow_missing_source = self._to_bool(params.get("allow_missing_source"))

        source_path = Path(source_file_path).expanduser().resolve()
        if not source_path.exists():
            if allow_missing_source:
                message = f"対象ファイルが存在しないためスキップしました: {source_file_path}"
                self.log_execution(message, level="warning")
                return self._build_result_dataframe(
                    action="rename_and_move_file",
                    target=str(source_file_path),
                    status="success",
                    message=message,
                )
            raise ValueError(f"対象ファイルが見つかりません: {source_file_path}")
        if not source_path.is_file():
            raise ValueError(f"対象ファイルではありません: {source_file_path}")

        if not destination_folder and not destination_file_name:
            raise ValueError("変更後フォルダ または 変更後ファイル名 のいずれかを指定してください。")

        target_dir = Path(destination_folder).expanduser() if destination_folder else source_path.parent
        target_dir.mkdir(parents=True, exist_ok=True)
        target_name = destination_file_name or source_path.name
        target_path = (target_dir / target_name).resolve()

        shutil.move(str(source_path), str(target_path))
        message = f"ファイルを移動しました: {target_path}"
        self.log_execution(message)
        return self._build_result_dataframe(
            action="rename_and_move_file",
            target=str(target_path),
            status="success",
            message=message,
        )

    def create_markdown_file(self, params: dict[str, Any]) -> pd.DataFrame:
        write_mode = str(params.get("write_mode") or "replace").strip().lower()
        if write_mode not in {"replace", "append"}:
            raise ValueError("write_mode は replace または append を指定してください。")

        target_file_path = self._required_path_text(params, "target_file_path")
        content = str(params.get("content") or "")
        target_path = Path(target_file_path).expanduser()
        if not target_path.suffix:
            target_path = target_path.with_suffix(".md")
        target_path = target_path.resolve()
        target_path.parent.mkdir(parents=True, exist_ok=True)

        file_mode = "a" if write_mode == "append" else "w"
        with open(target_path, file_mode, encoding="utf-8", newline="") as handle:
            handle.write(content)

        message = f"Markdown を保存しました: {target_path}"
        self.log_execution(message)
        return self._build_result_dataframe(
            action="create_markdown_file",
            target=str(target_path),
            status="success",
            message=message,
        )

    def search_files_by_name(self, params: dict[str, Any]) -> pd.DataFrame:
        root_folder = Path(self._required_path_text(params, "root_folder")).expanduser().resolve()
        if not root_folder.exists() or not root_folder.is_dir():
            raise ValueError(f"ルートフォルダが見つかりません: {root_folder}")

        recursive = self._to_bool(params.get("recursive"))
        file_name_regex = self._compile_optional_regex(params.get("file_name_pattern"), "検索するファイル名")
        extension_regex = self._compile_optional_regex(params.get("file_extension_pattern"), "検索するファイルの拡張子")
        max_elapsed_seconds = self._parse_timeout_seconds(params.get("max_elapsed_seconds"))

        started_at = time.monotonic()
        rows = []
        timed_out = False
        for file_path in self._iter_candidate_files(root_folder, recursive):
            if time.monotonic() - started_at > max_elapsed_seconds:
                timed_out = True
                break
            if not self._matches_file_filters(file_path, file_name_regex, extension_regex):
                continue
            rows.append({
                "folder_path": str(file_path.parent),
                "file_name": file_path.name,
            })

        if timed_out:
            self.log_execution("ファイル名検索は制限時間に達したため途中で終了しました。", level="warning")
        else:
            self.log_execution(f"ファイル名検索が完了しました: {len(rows)} 件")
        return pd.DataFrame(rows, columns=["folder_path", "file_name"])

    def search_text_in_files(self, params: dict[str, Any]) -> pd.DataFrame:
        root_folder = Path(self._required_path_text(params, "root_folder")).expanduser().resolve()
        if not root_folder.exists() or not root_folder.is_dir():
            raise ValueError(f"ルートフォルダが見つかりません: {root_folder}")

        recursive = self._to_bool(params.get("recursive"))
        file_name_regex = self._compile_optional_regex(params.get("file_name_pattern"), "検索するファイル名")
        extension_regex = self._compile_optional_regex(params.get("file_extension_pattern"), "検索するファイルの拡張子")
        content_regex = self._compile_optional_regex(params.get("content_pattern"), "検索する文字列", required=True)
        context_lines = self._parse_non_negative_int(params.get("context_lines", 0), "取得行")
        max_elapsed_seconds = self._parse_timeout_seconds(params.get("max_elapsed_seconds"))

        started_at = time.monotonic()
        rows = []
        timed_out = False
        for file_path in self._iter_candidate_files(root_folder, recursive):
            if time.monotonic() - started_at > max_elapsed_seconds:
                timed_out = True
                break
            if not self._matches_file_filters(file_path, file_name_regex, extension_regex):
                continue
            rows.extend(self._search_file_content(file_path, content_regex, context_lines))

        if timed_out:
            self.log_execution("ファイル内文字列検索は制限時間に達したため途中で終了しました。", level="warning")
        else:
            self.log_execution(f"ファイル内文字列検索が完了しました: {len(rows)} 件")
        return pd.DataFrame(rows, columns=[
            "folder_path",
            "file_name",
            "line_number",
            "matched_line",
            "context_excerpt",
        ])

    def _build_result_dataframe(self, *, action: str, target: str, status: str, message: str) -> pd.DataFrame:
        return pd.DataFrame([{
            "status": str(status),
            "executed_at": datetime.now(timezone.utc).isoformat(),
            "connector": "WindowsConnector",
            "action": str(action),
            "target": str(target or ""),
            "message": str(message or ""),
        }])

    @staticmethod
    def _optional_text(value: Any) -> str:
        if value is None:
            return ""
        return str(value).strip()

    def _required_path_text(self, params: dict[str, Any], key: str) -> str:
        value = self._optional_path_text(params.get(key))
        if not value:
            raise ValueError(f"{key} は必須です。")
        return value

    @staticmethod
    def _optional_path_text(value: Any) -> str:
        if value is None:
            return ""
        text = str(value).strip()
        return text.replace("/", "\\")

    @staticmethod
    def _to_bool(value: Any) -> bool:
        if isinstance(value, bool):
            return value
        text = str(value or "").strip().lower()
        return text in {"1", "true", "yes", "on"}

    @staticmethod
    def _parse_non_negative_int(value: Any, label: str) -> int:
        try:
            parsed = int(value)
        except (TypeError, ValueError):
            raise ValueError(f"{label} は 0 以上の整数で指定してください。")
        if parsed < 0:
            raise ValueError(f"{label} は 0 以上の整数で指定してください。")
        return parsed

    def _parse_timeout_seconds(self, value: Any) -> int:
        seconds = self._parse_non_negative_int(value if value not in {None, ""} else 120, "最大経過時間")
        if seconds < 30 or seconds > 480:
            raise ValueError("最大経過時間 は 30 秒から 480 秒（8 分）の範囲で指定してください。")
        return seconds

    @staticmethod
    def _compile_optional_regex(value: Any, label: str, required: bool = False):
        text = str(value or "").strip()
        if not text:
            if required:
                raise ValueError(f"{label} は必須です。")
            return None
        try:
            return re.compile(text)
        except re.error as error:
            raise ValueError(f"{label} の正規表現が不正です: {error}") from error

    def _iter_candidate_files(self, root_folder: Path, recursive: bool):
        if recursive:
            for dirpath, _, filenames in os.walk(root_folder):
                for filename in filenames:
                    yield Path(dirpath) / filename
            return
        for entry in root_folder.iterdir():
            if entry.is_file():
                yield entry

    @staticmethod
    def _matches_file_filters(file_path: Path, file_name_regex, extension_regex) -> bool:
        file_stem = file_path.stem
        suffix = file_path.suffix
        if file_name_regex and not file_name_regex.search(file_stem):
            return False
        if extension_regex:
            suffix_value = suffix or ""
            suffix_plain = suffix_value[1:] if suffix_value.startswith(".") else suffix_value
            if not (extension_regex.search(suffix_value) or extension_regex.search(suffix_plain)):
                return False
        return True

    @staticmethod
    def _read_text_lines(file_path: Path) -> list[str]:
        encodings = ("utf-8", "utf-8-sig", "cp932", "shift_jis")
        for encoding in encodings:
            try:
                return file_path.read_text(encoding=encoding).splitlines()
            except UnicodeDecodeError:
                continue
        return file_path.read_text(encoding="utf-8", errors="ignore").splitlines()

    def _search_file_content(self, file_path: Path, content_regex, context_lines: int) -> list[dict[str, Any]]:
        lines = self._read_text_lines(file_path)
        rows = []
        for index, line in enumerate(lines):
            if not content_regex.search(line):
                continue
            start = max(0, index - context_lines)
            end = min(len(lines), index + context_lines + 1)
            excerpt = "\n".join(lines[start:end])
            rows.append({
                "folder_path": str(file_path.parent),
                "file_name": file_path.name,
                "line_number": index + 1,
                "matched_line": line,
                "context_excerpt": excerpt,
            })
        return rows
