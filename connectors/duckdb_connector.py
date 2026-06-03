from __future__ import annotations

import os
from datetime import datetime
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
            return self.execute_sql_file(db_file=db_file, sql_file=sql_file, encoding=encoding)

        if action == "execute_sql":
            db_file = self._require_text(params.get("db_file"), "db_file")
            sql = self._require_text(params.get("sql"), "sql")
            return self.execute_sql(db_file=db_file, sql=sql)

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
        database_name = os.path.splitext(os.path.basename(normalized_db_file))[0]

        payload = {
            "file_path": normalized_db_file,
            "db_file": os.path.basename(normalized_db_file),
            "database": database_name,
            "created_at": datetime.now().isoformat(timespec="seconds"),
        }
        return self.attach_dataframe_schema(self.to_dataframe(payload))

    def execute_sql_file(self, db_file: str, sql_file: str, encoding: str = "utf-8") -> Optional[pd.DataFrame]:
        normalized_sql_file = self._normalize_abspath(sql_file)
        if not os.path.exists(normalized_sql_file):
            raise FileNotFoundError(f"SQLファイルが見つかりません: {normalized_sql_file}")
        with open(normalized_sql_file, "r", encoding=encoding) as f:
            sql = f.read()
        return self.execute_sql(db_file=db_file, sql=sql)

    def execute_sql(self, db_file: str, sql: str) -> Optional[pd.DataFrame]:
        conn, normalized_db_file = self._connect(db_file)
        try:
            cursor = conn.execute(str(sql))
            if cursor.description is None:
                return self.attach_dataframe_schema(
                    self.to_dataframe(
                        {
                            "db_file": normalized_db_file,
                            "status": "executed",
                            "executed_at": datetime.now().isoformat(timespec="seconds"),
                        }
                    )
                )
            dataframe = cursor.df()
            return self.attach_dataframe_schema(dataframe)
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
            row_count = int(len(dataframe.index))
        finally:
            try:
                conn.unregister("_ziz_input_df")
            except Exception:
                pass
            conn.close()

        payload = {
            "db_file": normalized_db_file,
            "table_name": normalized_table_name,
            "rows": row_count,
            "source_step": input_data,
            "created_at": datetime.now().isoformat(timespec="seconds"),
        }
        return self.attach_dataframe_schema(self.to_dataframe(payload))
