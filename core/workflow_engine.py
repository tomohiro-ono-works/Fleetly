import os
import warnings
import yaml
import importlib
import inspect
from connectors.base_connector import BaseConnector

warnings.filterwarnings("ignore")

class WorkflowEngine:
    def __init__(self, logger):
        self.logger = logger
        self.context = {}  # データを一時保持するメモリ空間
        self.connectors = {}  # 必要になった時点で遅延ロード

    def _get_or_load_connector(self, conn_name):
        """
        指定されたコネクタを遅延ロードして返す（2回目以降はキャッシュを返す）
        """
        if not conn_name:
            raise ValueError("コネクタ名が指定されていません。")

        # 既にインスタンス化済みなら再利用
        connector = self.connectors.get(conn_name)
        if connector:
            return connector

        full_module_name = f"connectors.{conn_name}"
        try:
            module = importlib.import_module(full_module_name)
        except ModuleNotFoundError as e:
            # コネクタ自身が存在しない場合のみ分かりやすいメッセージに変換
            if e.name == full_module_name:
                raise Exception(f"コネクタ '{conn_name}' が見つかりません。") from e
            raise

        for name, obj in inspect.getmembers(module, inspect.isclass):
            # BaseConnectorを継承しており、かつBaseConnector自体ではないクラスを探す
            if issubclass(obj, BaseConnector) and obj is not BaseConnector:
                connector = obj()
                self.connectors[conn_name] = connector
                self.logger.info(f"コネクタをロードしました: {conn_name}")
                return connector

        raise Exception(f"コネクタ '{conn_name}' は見つかりましたが、BaseConnector実装がありません。")

    def run_workflow(self, yaml_path):
        if not os.path.exists(yaml_path):
            self.logger.error(f"YAMLファイルが見つかりません: {yaml_path}")
            return

        with open(yaml_path, 'r', encoding='utf-8') as f:
            config = yaml.safe_load(f)

        meta = config.get("workflow_metadata", {})
        self.logger.info(f"--- ワークフロー開始: {meta.get('name', 'Untitled')} ---")

        for step in config.get("steps", []):
            sid = step.get("step_id")
            conn_name = step.get("connector")
            action = step.get("action")
            params = step.get("params", {})
            out_var = step.get("output_variable")

            self.logger.info(f"[{sid}] 実行中: {conn_name} -> {action}")

            try:
                connector = self._get_or_load_connector(conn_name)

                # 実行
                result = connector.execute(action, params, self.context)

                # 結果を変数に保存
                if out_var:
                    self.context[out_var] = result

            except Exception as e:
                self.logger.error(f"[{sid}] エラー発生: {str(e)}")
                raise e # 処理を中断

        self.logger.info("--- ワークフロー完了 ---")
