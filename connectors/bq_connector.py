from typing import Optional, List, Dict, Any
import os
from datetime import datetime, date  # date型もインポート
import re

from google.cloud import bigquery
from google.auth.exceptions import DefaultCredentialsError

from connectors.base_connector import BaseConnector

class BQConnector(BaseConnector):
    def __init__(self):
        # project_id ごとにクライアントを再利用する
        self.clients: Dict[str, bigquery.Client] = {}

    def _get_client(self, project_id):
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

    def google_auth_login(self):
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

    def execute(self, action: str, params: dict, context: dict) -> Any:
        project_id = params.get("project_id")
        if not project_id:
            raise ValueError("project_id は必須です。")

        if action == "execute_sql":
            return self.execute_sql(
                project_id,
                sql=params.get("sql_query"),
                sql_file=params.get("sql_file"),
                encoding=params.get("encoding", "utf-8"),
                is_output=params.get("is_output", True)
                )
                
        elif action == "load_data":
            return self.load_data(
                project_id, 
                params.get("dataset_id"), 
                params.get("table_id"), 
                params.get("input_data"), 
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
        # 1. まず排他チェック（どちらか片方のみが存在することを保証）
        if not (bool(sql) ^ bool(sql_file)):
            raise ValueError("引数 'sql' または 'sql_file' のどちらか一方のみを指定してください。")

        # 2. sql が指定されている場合
        if sql is not None:
            return sql
        
        # 3. ここに来る時点で XORチェックにより「sql_file は絶対に None ではない」が確定する
        # しかし、静的解析ツールのために明示的に型を絞り込む
        if sql_file is not None:
            sql_file = self.normalize_file_path(sql_file)
            if not os.path.exists(sql_file):
                raise FileNotFoundError(f"SQLファイルが見つかりません: {sql_file}")
                 
            with open(sql_file, 'r', encoding=encoding) as f:
                return f.read()

        # ここには到達しないはずだが、戻り値の型(str)を保証するために例外を置く
        raise RuntimeError("予期しないエラー: クエリを取得できませんでした。")

    def _clean_date_columns(self, data: Any, schema: Optional[List[Any]]) -> None:
        if not isinstance(data, list) or not schema:
            return

        # スキーマから日付・時刻系のカラム名を一括抽出
        target_cols = {f.name for f in schema if getattr(f, "field_type", "").upper() in ['DATE', 'DATETIME', 'TIMESTAMP']}

        for row in data:
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


    def execute_sql(
            self, 
            project_id,
            sql=None, 
            sql_file=None, 
            encoding='utf-8', 
            is_output=True):
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
            
        return results

    def load_data(self,
                   project_id, 
                   dataset_id, 
                   table_id, 
                   input_data, 
                   write_disposition, 
                   context, 
                   schema=None):
        data = context.get(input_data)
        if not data:
            raise ValueError(f"変数 '{input_data}' にデータがありません。")

        # 1. データのクレンジング（utilsへ委譲）
        self._clean_date_columns(data, schema)

        # 2. 引数の変換
        disposition_map = {
            "create_or_replace": "WRITE_TRUNCATE",
            "create_or_insert": "WRITE_APPEND"
        }
        bq_disposition = disposition_map.get(write_disposition, write_disposition)

        client = self._get_client(project_id)
        table_ref = f"{project_id}.{dataset_id}.{table_id}"

        # 3. JobConfigの作成
        # schemaがあれば適用し、なければautodetectを有効化
        job_config = bigquery.LoadJobConfig(
            write_disposition=bq_disposition,
            schema=schema if schema else None,
            autodetect=False if schema else True
        )

        load_job = client.load_table_from_json(data, table_ref, job_config=job_config)
        load_job.result()
        
        return f"Loaded {len(data)} rows to {table_ref}."
