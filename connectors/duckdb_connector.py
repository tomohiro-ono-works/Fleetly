from __future__ import annotations

import os
import re
from typing import Any, Optional

import pandas as pd

from connectors.base_connector import BaseConnector

try:
    import duckdb
except ImportError:  # pragma: no cover
    duckdb = None


class DuckConnector(BaseConnector):
    def execute(self, action: str, params: dict[str, Any], context: dict[str, Any]) -> Any:
        if duckdb is None:
            raise ImportError("duckdb がインストールされていません。'pip install duckdb' を実行してください。")

        if action == "create_db_file":
            return self.create_db_file(
                db_folder=params.get("db_folder"),
                db_file_name=params.get("db_file_name"),
            )

        if action == "execute_sql_file":
            db_file = self._require_text(params.get("db_file"), "db_file")
            sql_file = self._require_text(params.get("sql_file"), "sql_file")
            encoding = str(params.get("encoding") or "utf-8")
            return self.execute_sql_file(
                db_file=db_file,
                sql_file=sql_file,
                encoding=encoding,
                schema=params.get("schema"),
            )

        if action == "execute_sql":
            db_file = self._require_text(params.get("db_file"), "db_file")
            sql = self._require_text(params.get("sql"), "sql")
            return self.execute_sql(db_file=db_file, sql=sql, schema=params.get("schema"))

        if action == "create_table":
            db_file = self._require_text(params.get("db_file"), "db_file")
            input_data = self._require_text(params.get("input_data"), "input_data")
            table_name = self._require_text(params.get("table_name"), "table_name")
            return self.create_table(
                db_file=db_file,
                input_data=input_data,
                table_name=table_name,
                context=context,
            )

        raise ValueError(f"Unknown action: {action}")

    def dry_run(
        self,
        action: str,
        params: dict[str, Any],
        context: dict[str, Any],
    ) -> dict[str, Any]:
        if action not in {"execute_sql", "execute_sql_file"}:
            return super().dry_run(action, params, context)
        if duckdb is None:
            raise ImportError("duckdb がインストールされていません。")
        db_file = self._require_text(params.get("db_file"), "db_file")
        if action == "execute_sql_file":
            sql_file = self._require_text(params.get("sql_file"), "sql_file")
            normalized_sql_file = self._normalize_abspath(sql_file)
            if not os.path.isfile(normalized_sql_file):
                raise FileNotFoundError(
                    f"SQLファイルが見つかりません: {normalized_sql_file}"
                )
            encoding = str(params.get("encoding") or "utf-8")
            with open(
                normalized_sql_file,
                "r",
                encoding=encoding,
            ) as handle:
                sql = handle.read()
        else:
            sql = self._require_text(params.get("sql"), "sql")
        statement = re.sub(
            r"(?s)^\s*(?:--[^\n]*\n|/\*.*?\*/\s*)*",
            "",
            sql,
        )
        first_keyword = (
            statement.split(None, 1)[0].upper()
            if statement.strip()
            else ""
        )
        if first_keyword not in {"SELECT", "WITH", "VALUES"}:
            normalized_db_file = self._normalize_abspath(db_file)
            if not os.path.exists(normalized_db_file):
                raise FileNotFoundError(
                    f"DBファイルが見つかりません: {normalized_db_file}"
                )
            return {
                "kind": "dry_run",
                "strategy": "duckdb_input_validation",
                "executed": False,
                "validated": True,
                "scope": ["params", "db_file", "sql_presence"],
                "not_validated": ["sql_execution", "result_schema"],
            }
        connection, normalized_db_file = self._connect(db_file)
        try:
            rows = connection.execute(f"EXPLAIN {sql}").fetchall()
        finally:
            connection.close()
        return {
            "kind": "dry_run",
            "strategy": "duckdb_explain",
            "executed": False,
            "validated": True,
            "db_file": normalized_db_file,
            "plan_lines": [str(row[-1]) for row in rows[:100]],
            "scope": ["params", "db_file", "sql_parse", "query_plan"],
        }

    @staticmethod
    def _require_text(value: Any, field_name: str) -> str:
        text = str(value or "").strip()
        if not text:
            raise ValueError(f"{field_name} は必須です。")
        return text

    @staticmethod
    def _normalize_abspath(path_value: str) -> str:
        normalized = BaseConnector.normalize_file_path(path_value)
        return os.path.abspath(str(normalized))

    @staticmethod
    def _normalize_db_file_name(file_name: str) -> str:
        name = str(file_name or "").strip()
        if not name:
            raise ValueError("db_file_name は必須です。")
        if os.path.sep in name or "/" in name or "\\" in name:
            raise ValueError("db_file_name にはファイル名のみ指定してください。")
        if not os.path.splitext(name)[1]:
            name += ".duckdb"
        return name

    @staticmethod
    def _validate_table_name(table_name: str) -> str:
        text = str(table_name or "").strip()
        if not text:
            raise ValueError("table_name は必須です。")
        if not all(ch.isalnum() or ch == "_" for ch in text) or text[0].isdigit():
            raise ValueError("table_name は英数字とアンダースコアのみ使用可能で、先頭は数字不可です。")
        return text

    def _connect(self, db_file: str):
        normalized = self._normalize_abspath(db_file)
        parent = os.path.dirname(normalized)
        if parent and not os.path.exists(parent):
            raise FileNotFoundError(f"DBファイルの親フォルダが存在しません: {parent}")
        return duckdb.connect(normalized), normalized

    def create_db_file(self, db_folder: Any, db_file_name: Any) -> pd.DataFrame:
        folder = self._require_text(db_folder, "db_folder")
        file_name = self._normalize_db_file_name(self._require_text(db_file_name, "db_file_name"))
        abs_folder = self._normalize_abspath(folder)
        os.makedirs(abs_folder, exist_ok=True)

        db_file = os.path.join(abs_folder, file_name)
        conn = duckdb.connect(db_file)
        conn.close()
        normalized_db_file = self._normalize_abspath(db_file)
        return self.build_execution_metadata(
            target=normalized_db_file,
            path=normalized_db_file,
        )

    def execute_sql_file(
        self,
        db_file: str,
        sql_file: str,
        encoding: str = "utf-8",
        schema: Any = None,
    ) -> Optional[pd.DataFrame]:
        normalized_sql_file = self._normalize_abspath(sql_file)
        if not os.path.exists(normalized_sql_file):
            raise FileNotFoundError(f"SQLファイルが見つかりません: {normalized_sql_file}")
        with open(normalized_sql_file, "r", encoding=encoding) as f:
            sql = f.read()
        return self.execute_sql(db_file=db_file, sql=sql, schema=schema)

    def execute_sql(self, db_file: str, sql: str, schema: Any = None) -> Optional[pd.DataFrame]:
        conn, normalized_db_file = self._connect(db_file)
        try:
            cursor = conn.execute(str(sql))
            if cursor.description is None:
                return self.build_execution_metadata(
                    target=normalized_db_file,
                    path=normalized_db_file,
                )
            dataframe = cursor.df()
            return self.attach_dataframe_schema(dataframe, schema_override=schema, allow_rename=False)
        finally:
            conn.close()

    def create_table(self, db_file: str, input_data: str, table_name: str, context: dict[str, Any]) -> pd.DataFrame:
        source = context.get(input_data)
        if source is None:
            raise ValueError(f"変数 '{input_data}' にデータがありません。")

        dataframe = self.to_dataframe(source)
        if dataframe.empty:
            raise ValueError(f"変数 '{input_data}' に有効なデータがありません。")

        normalized_table_name = self._validate_table_name(table_name)
        conn, normalized_db_file = self._connect(db_file)
        try:
            conn.register("_ziz_input_df", dataframe)
            conn.execute(f"CREATE OR REPLACE TABLE \"{normalized_table_name}\" AS SELECT * FROM _ziz_input_df")
        finally:
            try:
                conn.unregister("_ziz_input_df")
            except Exception:
                pass
            conn.close()

        return self.build_execution_metadata(
            target=f"{normalized_db_file}/{normalized_table_name}",
            path=normalized_db_file,
        )
