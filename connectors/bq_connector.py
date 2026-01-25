from google.cloud import bigquery
from google.api_core import exceptions
from connectors.base_connector import BaseConnector
from typing import Any


class BQConnector(BaseConnector):
    def __init__(self):
        # 認証設定が済んでいれば、引数なしでクライアントを初期化可能
        self.client = None

    def _get_client(self, project_id):
        if self.client is None:
            self.client = bigquery.Client(project=project_id)
        return self.client

    def execute(self, action: str, params: dict, context: dict) -> Any:
        project_id = params.get("project_id")
        if not project_id:
            raise ValueError("project_id は必須です。")

        if action == "execute_sql":
            return self.execute_sql(project_id, params.get("sql_query"))
        
        elif action == "query_to_jsonl":
            return self.query_to_jsonl(project_id, params.get("sql_query"))
        
        elif action == "load_from_jsonl":
            return self.load_from_jsonl(
                project_id, 
                params.get("dataset_id"), 
                params.get("table_id"), 
                params.get("input_data"), 
                params.get("write_disposition", "WRITE_APPEND"),
                context
            )
        else:
            raise ValueError(f"Unknown action: {action}")

    def execute_sql(self, project_id, sql):
        client = self._get_client(project_id)
        query_job = client.query(sql)
        query_job.result()  # 完了を待機
        return f"SQL executed successfully. Job ID: {query_job.job_id}"

    def query_to_jsonl(self, project_id, sql):
        client = self._get_client(project_id)
        query_job = client.query(sql)
        rows = query_job.result()
        
        # BQの結果(RowIterator)をPythonのList[dict]に変換
        return [dict(row) for row in rows]

    def load_from_jsonl(self, project_id, dataset_id, table_id, input_var, write_disposition, context):
        data = context.get(input_var)
        if not data:
            raise ValueError(f"変数 '{input_var}' にデータがありません。")

        client = self._get_client(project_id)
        table_ref = f"{project_id}.{dataset_id}.{table_id}"

        # Write Dispositionの設定 (WRITE_TRUNCATE: 上書き, WRITE_APPEND: 追記)
        job_config = bigquery.LoadJobConfig(
            write_disposition=write_disposition,
        )

        load_job = client.load_table_from_json(data, table_ref, job_config=job_config)
        load_job.result()  # 完了を待機
        
        return f"Loaded {len(data)} rows to {table_ref}."