from typing import Optional, List, Dict, Any
import os
from datetime import datetime, date  # date型もインポート
import json
import re

from google.cloud import bigquery
from google.auth.exceptions import DefaultCredentialsError
import pandas as pd

from connectors.base_connector import BaseConnector
from core.type_registry import (
    build_dataframe_schema,
    resolve_bigquery_type,
    split_struct_field,
    split_top_level,
)

class BQConnector(BaseConnector):
    def __init__(self):
        # project_id ごとにクライアントを再利用する
        self.clients: Dict[str, bigquery.Client] = {}

    def _get_client(self, project_id: str) -> bigquery.Client:
        """project_id ごとのクライアントを取得する（未作成時のみ生成）"""
        if not project_id:
            raise ValueError("project_id は必須です。")

        cached_client = self.clients.get(project_id)
        if cached_client is not None:
            return cached_client

        try:
            client = bigquery.Client(project=project_id)
        except DefaultCredentialsError:
            print("認証情報が見つからないか、期限が切れています。")
            self.google_auth_login()
            client = bigquery.Client(project=project_id)

        self.clients[project_id] = client
        return client

    def google_auth_login(self) -> None:
        """gcloud auth application-default login を実行"""
        import subprocess
        import sys
        print("Google Cloudの認証を開始します...")
        try:
            subprocess.run(["gcloud", "auth", "application-default", "login"], check=True)
            print("認証が完了しました。")
        except Exception as e:
            print(f"認証の自動起動に失敗しました。手動で 'gcloud auth application-default login' を実行してください。: {e}", file=sys.stderr)
            raise

    def _to_bq_records(self, data: Any) -> List[Dict[str, Any]]:
        records = self.to_records(data)
        normalized_records: List[Dict[str, Any]] = []
        for row in records:
            if not isinstance(row, dict):
                raise TypeError("BigQuery に渡す表データは辞書配列である必要があります。")
            normalized_records.append({str(key): value for key, value in row.items()})
        return normalized_records

    @staticmethod
    def _normalize_optional_text(value: Any) -> Optional[str]:
        if value is None:
            return None
        text = str(value).strip()
        return text or None

    def execute(self, action: str, params: dict[str, Any], context: dict[str, Any]) -> Any:
        project_id = params.get("project_id")
        if not project_id:
            raise ValueError("project_id は必須です。")

        if action == "execute_sql":
            return self.execute_sql(
                str(project_id),
                sql=self._normalize_optional_text(params.get("sql")) or self._normalize_optional_text(params.get("sql_query")),
                sql_file=self._normalize_optional_text(params.get("sql_file")),
                encoding=params.get("encoding", "utf-8"),
                is_output=params.get("is_output", True)
                )
        elif action == "execute_sql_file":
            sql_file = self._normalize_optional_text(params.get("sql_file"))
            if not sql_file:
                raise ValueError("sql_file は必須です。")
            return self.execute_sql_file(
                str(project_id),
                sql_file=sql_file,
                encoding=str(params.get("encoding", "utf-8")),
                is_output=params.get("is_output", True),
            )
                 
        elif action == "load_data":
            dataset_id = params.get("dataset_id")
            table_id = params.get("table_id")
            input_data = params.get("input_data")
            if not dataset_id:
                raise ValueError("dataset_id は必須です。")
            if not table_id:
                raise ValueError("table_id は必須です。")
            if not input_data:
                raise ValueError("input_data は必須です。")
            return self.load_data(
                project_id, 
                str(dataset_id), 
                str(table_id), 
                str(input_data), 
                params.get("write_disposition", "create_or_replace"),
                context,
                params.get("schema", None)
            )
        else:
            raise ValueError(f"Unknown action: {action}")

    def _get_query(self, sql: Optional[str] = None, sql_file: Optional[str] = None, encoding: str = 'utf-8') -> str:
        """
        引数の排他チェックとクエリ文字列の取得
        
        :param sql: 直接入力されたSQL文字列
        :param sql_file: SQLファイルのパス
        :param encoding: ファイルのエンコーディング
        :return: 実行するSQL文字列
        """
        sql = self._normalize_optional_text(sql)
        sql_file = self._normalize_optional_text(sql_file)

        # 1. まず排他チェック（どちらか片方のみが存在することを保証）
        if not (bool(sql) ^ bool(sql_file)):
            raise ValueError("引数 'sql' または 'sql_file' のどちらか一方のみを指定してください。")

        # 2. sql が指定されている場合
        if sql is not None:
            return sql
        
        # 3. ここに来る時点で XORチェックにより「sql_file は絶対に None ではない」が確定する
        # しかし、静的解析ツールのために明示的に型を絞り込む
        if sql_file is not None:
            normalized_sql_file = self.normalize_file_path(sql_file)
            if normalized_sql_file is None:
                raise ValueError("sql_file が指定されていません。")
            if not os.path.exists(normalized_sql_file):
                raise FileNotFoundError(f"SQLファイルが見つかりません: {normalized_sql_file}")

            with open(normalized_sql_file, 'r', encoding=encoding) as f:
                return f.read()

        # ここには到達しないはずだが、戻り値の型(str)を保証するために例外を置く
        raise RuntimeError("予期しないエラー: クエリを取得できませんでした。")

    def _clean_date_columns(self, data: Any, schema: Optional[List[Any]]) -> List[Dict[str, Any]]:
        records = self._to_bq_records(data)
        if not records or not schema:
            return records

        # スキーマから日付・時刻系のカラム名を一括抽出
        target_cols = {f.name for f in schema if getattr(f, "field_type", "").upper() in ['DATE', 'DATETIME', 'TIMESTAMP']}

        for row in records:
            for col in target_cols:
                val = row.get(col)
                if val is None:
                    continue

                # 1. datetime / date オブジェクトの場合
                if isinstance(val, (datetime, date)):
                    # タイムゾーンを消し、ISO文字列化（DATEは YYYY-MM-DD, DATETIMEは T付き に自動変換）
                    dt_val = val.replace(tzinfo=None) if isinstance(val, datetime) else val
                    row[col] = dt_val.isoformat()

                # 2. 文字列の場合（"2026/1/31" などを "2026-01-31" へ）
                elif isinstance(val, str):
                    nums = re.findall(r'\d+', val)
                    if len(nums) == 3:
                        y, m, d = nums
                        row[col] = f"{y}-{m.zfill(2)}-{d.zfill(2)}"
        return records

    def _resolve_schema_definition(self, data: Any, schema: Any) -> Optional[List[bigquery.SchemaField]]:
        schema_value = schema
        source_dataframe = None
        if isinstance(data, pd.DataFrame):
            source_dataframe = data
        elif self.is_tabular_data(data):
            source_dataframe = self.to_dataframe(data)

        if not schema_value and source_dataframe is not None:
            schema_value = source_dataframe.attrs.get("ziz_schema") or build_dataframe_schema(source_dataframe)
        if not schema_value:
            return None
        if isinstance(schema_value, str):
            text = schema_value.strip()
            if not text:
                return None
            schema_value = json.loads(text)
        if not isinstance(schema_value, list):
            raise ValueError("schema は JSON 配列または schema リストで指定してください。")
        return [self._build_bq_schema_field(item) for item in schema_value]

    def _build_bq_schema_field(self, item: Any) -> bigquery.SchemaField:
        if not isinstance(item, dict):
            raise ValueError("schema の各要素はオブジェクトで指定してください。")
        origin_name = str(item.get("origin_name") or item.get("name") or "").strip()
        new_name = str(item.get("new_name") or item.get("name_en") or "").strip()
        description = str(item.get("description") or item.get("name_ja") or "").strip()
        field_name = new_name or origin_name
        if not field_name:
            raise ValueError("schema の new_name または origin_name が必要です。")

        raw_type = str(item.get("ziz_datatype") or item.get("type") or item.get("bigquery_type") or "").strip()
        explicit_fields = item.get("fields")
        if explicit_fields and not raw_type:
            raw_type = "STRUCT"
        if not raw_type:
            raise ValueError(f"schema の型が不正です: {field_name}")
        description = description or None
        return self._schema_field_from_type(field_name, raw_type, explicit_fields, description)

    def _schema_field_from_type(
        self,
        field_name: str,
        raw_type: str,
        explicit_fields: Any = None,
        description: Optional[str] = None,
    ) -> bigquery.SchemaField:
        normalized = str(raw_type or "").strip()
        if normalized.startswith("ARRAY<") and normalized.endswith(">"):
            inner = normalized[len("ARRAY<"):-1].strip()
            if inner.startswith("STRUCT<") and inner.endswith(">"):
                nested_fields = self._schema_fields_from_struct(inner, explicit_fields)
                return bigquery.SchemaField(field_name, "RECORD", mode="REPEATED", fields=nested_fields, description=description)
            return bigquery.SchemaField(field_name, resolve_bigquery_type(inner), mode="REPEATED", description=description)

        if normalized.startswith("STRUCT<") and normalized.endswith(">"):
            nested_fields = self._schema_fields_from_struct(normalized, explicit_fields)
            return bigquery.SchemaField(field_name, "RECORD", fields=nested_fields, description=description)

        if explicit_fields:
            nested_fields = [self._build_bq_schema_field(field) for field in explicit_fields]
            return bigquery.SchemaField(field_name, "RECORD", fields=nested_fields, description=description)

        return bigquery.SchemaField(field_name, resolve_bigquery_type(normalized), description=description)

    def _schema_fields_from_struct(self, struct_type: str, explicit_fields: Any = None) -> List[bigquery.SchemaField]:
        if explicit_fields:
            return [self._build_bq_schema_field(field) for field in explicit_fields]
        body = struct_type[len("STRUCT<"):-1].strip()
        fields = []
        for raw_field in split_top_level(body):
            child_name, child_type = split_struct_field(raw_field)
            fields.append(self._schema_field_from_type(child_name, child_type))
        return fields


    def execute_sql(
            self, 
            project_id: str,
            sql: Optional[str] = None, 
            sql_file: Optional[str] = None, 
            encoding: str = 'utf-8', 
            is_output: bool = True) -> Any:
        query_str = self._get_query(sql, sql_file, encoding)
        client = self._get_client(project_id)
        query_job = client.query(query_str)
        
        # 完了を待機
        rows = query_job.result()
        
        # 出力不要なら即終了
        if not is_output:
            return None

        results = []
        for row in rows:
            dict_row = dict(row.items()) # rowオブジェクトから辞書を作成
            
            for key, value in dict_row.items():
                # --- クレンジング処理を追加 ---
                # datetime型（Timestamp）かつ タイムゾーン情報がある場合
                if isinstance(value, datetime) and value.tzinfo is not None:
                    # 15:00という数値を維持したままタイムゾーン(UTC等)を消去
                    dict_row[key] = value.replace(tzinfo=None)
                
                # もし format_date という別関数を通す必要があるならここで適用
                # dict_row[key] = format_date(dict_row[key]) 
                
            results.append(dict_row)
            
        return self.attach_dataframe_schema(self.to_dataframe(results))

    def execute_sql_file(
            self,
            project_id: str,
            sql_file: str,
            encoding: str = 'utf-8',
            is_output: bool = True) -> Any:
        return self.execute_sql(
            project_id=project_id,
            sql=None,
            sql_file=sql_file,
            encoding=encoding,
            is_output=is_output,
        )

    def load_data(self,
                   project_id: str,
                   dataset_id: str,
                   table_id: str,
                   input_data: str,
                   write_disposition: str,
                   context: dict[str, Any],
                   schema: Optional[List[Any]] = None) -> str:
        data = context.get(input_data)
        if data is None:
            raise ValueError(f"変数 '{input_data}' にデータがありません。")
        records = self._to_bq_records(data)
        if not records:
            raise ValueError(f"変数 '{input_data}' にデータがありません。")

        resolved_schema = self._resolve_schema_definition(data, schema)

        # 1. データのクレンジング（utilsへ委譲）
        records = self._clean_date_columns(records, resolved_schema)

        # 2. 引数の変換
        disposition_map = {
            "create_or_replace": "WRITE_TRUNCATE",
            "create_or_insert": "WRITE_APPEND"
        }
        bq_disposition = disposition_map.get(write_disposition, write_disposition)

        client = self._get_client(project_id)
        table_ref = f"{project_id}.{dataset_id}.{table_id}"

        # 3. JobConfigの作成
        # schema 未指定時も、可能なら ziz ルールから推論した schema を適用する
        job_config = bigquery.LoadJobConfig(
            write_disposition=bq_disposition,
            schema=resolved_schema if resolved_schema else None,
            autodetect=False if resolved_schema else True
        )

        load_job = client.load_table_from_json(records, table_ref, job_config=job_config)
        load_job.result()
        
        return f"Loaded {len(records)} rows to {table_ref}."
