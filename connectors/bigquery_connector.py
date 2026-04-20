from typing import Optional, List, Dict, Any
import os
from datetime import datetime, date, time, timezone
from decimal import Decimal
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

    @staticmethod
    def _to_utc_iso(value: Any) -> str:
        if isinstance(value, datetime):
            dt = value
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            else:
                dt = dt.astimezone(timezone.utc)
            return dt.isoformat().replace("+00:00", "Z")
        return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

    @staticmethod
    def _build_bigquery_table_url(project_id: str, dataset_id: str, table_id: str) -> str:
        return (
            "https://console.cloud.google.com/bigquery?ws=!1m5!1m4!4m3!"
            f"1s{project_id}!2s{dataset_id}!3s{table_id}"
        )

    def _build_table_update_result(
        self,
        *,
        job: Any,
        project_id: str,
        dataset_id: str,
        table_id: str,
    ) -> pd.DataFrame:
        completed_at = self._to_utc_iso(
            getattr(job, "ended", None)
            or getattr(job, "finished", None)
            or getattr(job, "created", None)
        )
        payload = {
            "job_id": str(getattr(job, "job_id", "") or ""),
            "project_id": str(project_id or ""),
            "dataset_id": str(dataset_id or ""),
            "table_id": str(table_id or ""),
            "url": self._build_bigquery_table_url(
                str(project_id or ""),
                str(dataset_id or ""),
                str(table_id or ""),
            ),
            "excuted_at": completed_at,
        }
        schema_items = [
            {"origin_name": "job_id", "new_name": "job_id", "description": "BigQuery Job ID", "ziz_datatype": "STRING"},
            {"origin_name": "project_id", "new_name": "project_id", "description": "BigQuery Project ID", "ziz_datatype": "STRING"},
            {"origin_name": "dataset_id", "new_name": "dataset_id", "description": "BigQuery Dataset ID", "ziz_datatype": "STRING"},
            {"origin_name": "table_id", "new_name": "table_id", "description": "BigQuery Table ID", "ziz_datatype": "STRING"},
            {"origin_name": "url", "new_name": "url", "description": "BigQuery Console URL", "ziz_datatype": "STRING"},
            {"origin_name": "excuted_at", "new_name": "excuted_at", "description": "完了時刻", "ziz_datatype": "TIMESTAMP"},
        ]
        return self.attach_dataframe_schema(self.to_dataframe(payload), schema_override=schema_items)

    def _infer_target_table_from_job(self, project_id: str, query_job: Any) -> tuple[str, str]:
        candidates = [
            getattr(query_job, "ddl_target_table", None),
            getattr(query_job, "destination", None),
        ]
        referenced_tables = getattr(query_job, "referenced_tables", None)
        if isinstance(referenced_tables, list) and len(referenced_tables) == 1:
            candidates.append(referenced_tables[0])
        for table_ref in candidates:
            if table_ref is None:
                continue
            ref_project = str(getattr(table_ref, "project", "") or "")
            ref_dataset = str(getattr(table_ref, "dataset_id", "") or "")
            ref_table = str(getattr(table_ref, "table_id", "") or "")
            if ref_dataset and ref_table:
                return ref_dataset, ref_table
            if ref_project and ref_project != str(project_id or ""):
                continue
        return "", ""

    @staticmethod
    def _is_non_tabular_statement(statement_type: Any) -> bool:
        normalized = str(statement_type or "").strip().upper()
        if not normalized:
            return False
        if normalized in {"SELECT"}:
            return False
        return True

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

    @staticmethod
    def _is_nullish(value: Any) -> bool:
        if value is None:
            return True
        if value is pd.NA:
            return True
        if isinstance(value, float) and pd.isna(value):
            return True
        try:
            return bool(pd.isna(value))
        except Exception:
            return False

    @staticmethod
    def _normalize_temporal_text(value: str) -> str:
        text = str(value or "").strip()
        if not text:
            return ""
        text = text.replace("年", "-").replace("月", "-").replace("日", "")
        text = text.replace("/", "-")
        text = re.sub(r"\s+", " ", text)
        return text

    def _serialize_records_for_schema(
        self,
        records: List[Dict[str, Any]],
        schema: Optional[List[bigquery.SchemaField]],
    ) -> List[Dict[str, Any]]:
        if not records or not schema:
            return records
        return [self._serialize_record_for_schema(row, schema) for row in records]

    def _serialize_record_for_schema(
        self,
        row: Dict[str, Any],
        schema: List[bigquery.SchemaField],
    ) -> Dict[str, Any]:
        serialized = {}
        for field in schema:
            serialized[field.name] = self._serialize_value_for_field(row.get(field.name), field)
        return serialized

    def _serialize_value_for_field(self, value: Any, field: bigquery.SchemaField) -> Any:
        if self._is_nullish(value):
            return [] if getattr(field, "mode", "").upper() == "REPEATED" else None

        if getattr(field, "mode", "").upper() == "REPEATED":
            if isinstance(value, (list, tuple, set)):
                values = list(value)
            else:
                values = [value]
            element_field = bigquery.SchemaField(
                field.name,
                field.field_type,
                mode="NULLABLE",
                fields=field.fields,
                description=field.description,
            )
            return [self._serialize_value_for_field(item, element_field) for item in values]

        field_type = str(getattr(field, "field_type", "") or "").upper()
        if field_type == "RECORD":
            return self._serialize_record_value(value, field.fields or [])
        if field_type == "DATE":
            return self._serialize_date(value)
        if field_type == "DATETIME":
            return self._serialize_datetime(value)
        if field_type == "TIMESTAMP":
            return self._serialize_timestamp(value)
        if field_type == "TIME":
            return self._serialize_time(value)
        if field_type in {"NUMERIC", "BIGNUMERIC"}:
            return self._serialize_numeric(value)
        if field_type in {"INT64", "INTEGER"}:
            return int(value)
        if field_type in {"FLOAT64", "FLOAT"}:
            return float(value)
        if field_type in {"BOOL", "BOOLEAN"}:
            return bool(value)
        if field_type == "BYTES":
            return bytes(value) if isinstance(value, bytearray) else value
        return value

    def _serialize_record_value(
        self,
        value: Any,
        fields: List[bigquery.SchemaField],
    ) -> Optional[Dict[str, Any]]:
        if self._is_nullish(value):
            return None
        if isinstance(value, str):
            text = value.strip()
            if not text:
                return None
            try:
                value = json.loads(text)
            except json.JSONDecodeError:
                raise ValueError(f"STRUCT 値を JSON として解釈できません: {value}")
        if hasattr(value, "to_dict") and not isinstance(value, dict):
            value = value.to_dict()
        if not isinstance(value, dict):
            raise ValueError(f"STRUCT 値は dict である必要があります: {value}")
        serialized = {}
        for child in fields:
            serialized[child.name] = self._serialize_value_for_field(value.get(child.name), child)
        return serialized

    def _serialize_date(self, value: Any) -> Optional[str]:
        if self._is_nullish(value):
            return None
        if isinstance(value, pd.Timestamp):
            return value.date().isoformat()
        if isinstance(value, datetime):
            return value.date().isoformat()
        if isinstance(value, date):
            return value.isoformat()
        normalized = self._normalize_temporal_text(value)
        parsed = pd.to_datetime(normalized, errors="coerce")
        if pd.isna(parsed):
            raise ValueError(f"DATE 値を解釈できません: {value}")
        return parsed.date().isoformat()

    def _serialize_datetime(self, value: Any) -> Optional[str]:
        if self._is_nullish(value):
            return None
        if isinstance(value, pd.Timestamp):
            if value.tzinfo is not None:
                value = value.tz_convert("UTC").tz_localize(None)
            return value.isoformat()
        if isinstance(value, datetime):
            if value.tzinfo is not None:
                normalized = pd.Timestamp(value).tz_convert("UTC").tz_localize(None).to_pydatetime()
            else:
                normalized = value
            return normalized.isoformat()
        normalized = self._normalize_temporal_text(value)
        parsed = pd.to_datetime(normalized, errors="coerce")
        if pd.isna(parsed):
            raise ValueError(f"DATETIME 値を解釈できません: {value}")
        if isinstance(parsed, pd.Timestamp) and parsed.tzinfo is not None:
            parsed = parsed.tz_convert("UTC").tz_localize(None)
        return parsed.isoformat()

    def _serialize_timestamp(self, value: Any) -> Optional[str]:
        if self._is_nullish(value):
            return None
        if isinstance(value, pd.Timestamp):
            parsed = value
        elif isinstance(value, datetime):
            parsed = pd.Timestamp(value)
        else:
            normalized = self._normalize_temporal_text(value)
            parsed = pd.to_datetime(normalized, errors="coerce", utc=True)
            if pd.isna(parsed):
                raise ValueError(f"TIMESTAMP 値を解釈できません: {value}")
        if parsed.tzinfo is None:
            parsed = parsed.tz_localize("UTC")
        else:
            parsed = parsed.tz_convert("UTC")
        return parsed.isoformat().replace("+00:00", "Z")

    def _serialize_time(self, value: Any) -> Optional[str]:
        if self._is_nullish(value):
            return None
        if isinstance(value, pd.Timestamp):
            return value.time().isoformat()
        if isinstance(value, datetime):
            return value.time().isoformat()
        if isinstance(value, time):
            return value.isoformat()
        normalized = self._normalize_temporal_text(value)
        parsed = pd.to_datetime(normalized, errors="coerce")
        if pd.isna(parsed):
            raise ValueError(f"TIME 値を解釈できません: {value}")
        return parsed.time().isoformat()

    @staticmethod
    def _serialize_numeric(value: Any) -> Optional[str]:
        if value is None:
            return None
        if isinstance(value, Decimal):
            return format(value, "f")
        return str(value)

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
        
        statement_type = str(getattr(query_job, "statement_type", "") or "").strip().upper()
        has_schema = bool(getattr(query_job, "schema", None))
        if self._is_non_tabular_statement(statement_type) and not has_schema and not results:
            dataset_id, table_id = self._infer_target_table_from_job(project_id, query_job)
            return self._build_table_update_result(
                job=query_job,
                project_id=str(project_id),
                dataset_id=dataset_id,
                table_id=table_id,
            )

        if not results:
            schema_columns = [str(field.name) for field in (getattr(query_job, "schema", None) or [])]
            return self.attach_dataframe_schema(pd.DataFrame(columns=schema_columns))

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
                   schema: Optional[List[Any]] = None) -> pd.DataFrame:
        data = context.get(input_data)
        if data is None:
            raise ValueError(f"変数 '{input_data}' にデータがありません。")
        records = self._to_bq_records(data)
        if not records:
            raise ValueError(f"変数 '{input_data}' にデータがありません。")

        resolved_schema = self._resolve_schema_definition(data, schema)

        # 1. schema に従って BigQuery JSON へ直列化
        records = self._serialize_records_for_schema(records, resolved_schema)

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

        return self._build_table_update_result(
            job=load_job,
            project_id=str(project_id),
            dataset_id=str(dataset_id),
            table_id=str(table_id),
        )
