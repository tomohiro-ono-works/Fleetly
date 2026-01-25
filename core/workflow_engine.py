import os
import yaml
import importlib
import pkgutil
import inspect
from connectors.base_connector import BaseConnector

class WorkflowEngine:
    def __init__(self, logger):
        self.logger = logger
        self.context = {}  # データを一時保持するメモリ空間
        self.connectors = self._load_connectors()

    def _load_connectors(self):
        """
        connectorsフォルダから、BaseConnectorを継承したクラスを自動ロードする
        """
        connectors_dict = {}
        
        # 1. connectorsパッケージのパスを取得
        import connectors
        package_path = os.path.dirname(str(connectors.__file__))

        # 2. パッケージ内のモジュール（ファイル）をループ
        for loader, module_name, is_pkg in pkgutil.iter_modules([package_path]):
            # base_connector自体はスキップ
            if module_name == "base_connector":
                continue

            # 3. モジュールを動的にインポート
            full_module_name = f"connectors.{module_name}"
            module = importlib.import_module(full_module_name)

            # 4. モジュール内のクラスを走査
            for name, obj in inspect.getmembers(module, inspect.isclass):
                # BaseConnectorを継承しており、かつBaseConnector自体ではないクラスを探す
                if issubclass(obj, BaseConnector) and obj is not BaseConnector:
                    # キー名はファイル名にする（例: "file_connector"）
                    # クラスをインスタンス化して格納
                    connectors_dict[module_name] = obj()
                    self.logger.info(f"コネクタをロードしました: {module_name}")
                    break # 1ファイル1コネクタ前提

        return connectors_dict

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
                connector = self.connectors.get(conn_name)
                if not connector:
                    raise Exception(f"コネクタ '{conn_name}' が登録されていません。")

                # 実行
                result = connector.execute(action, params, self.context)

                # 結果を変数に保存
                if out_var:
                    self.context[out_var] = result

            except Exception as e:
                self.logger.error(f"[{sid}] エラー発生: {str(e)}")
                raise e # 処理を中断

        self.logger.info("--- ワークフロー完了 ---")