import os
import warnings
import yaml
import importlib
import inspect
import pkgutil
import re
from connectors.base_connector import BaseConnector

warnings.filterwarnings("ignore")

class WorkflowEngine:
    def __init__(self, logger):
        self.logger = logger
        self.context = {}  # データを一時保持するメモリ空間
        self.connectors = {}  # 必要になった時点で遅延ロード

    def _to_snake_case(self, name: str) -> str:
        text = str(name or "")
        text = re.sub(r"([A-Z]+)([A-Z][a-z])", r"\1_\2", text)
        text = re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", text)
        return text.lower()

    def _connector_module_candidates(self, conn_name: str):
        raw = str(conn_name or "").strip()
        snake = self._to_snake_case(raw)
        candidates = []
        for name in [raw, snake, f"{snake}_connector" if snake and not snake.endswith("_connector") else snake]:
            if name and name not in candidates:
                candidates.append(name)
        return candidates

    def _instantiate_connector_from_module(self, module, cache_keys=None):
        for name, obj in inspect.getmembers(module, inspect.isclass):
            if issubclass(obj, BaseConnector) and obj is not BaseConnector:
                connector = obj()
                for key in (cache_keys or []):
                    if key:
                        self.connectors[key] = connector
                return connector
        return None

    def _load_connector_by_class_name_scan(self, conn_name: str):
        import connectors

        package_path = os.path.dirname(str(connectors.__file__))
        for _, module_name, is_pkg in pkgutil.iter_modules([package_path]):
            if is_pkg or module_name == "base_connector":
                continue

            full_module_name = f"connectors.{module_name}"
            module = importlib.import_module(full_module_name)
            for name, obj in inspect.getmembers(module, inspect.isclass):
                if obj is BaseConnector or not issubclass(obj, BaseConnector):
                    continue
                if name == conn_name:
                    connector = obj()
                    self.connectors[conn_name] = connector
                    self.connectors[module_name] = connector
                    return connector, module_name

        return None, None

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

        for module_name in self._connector_module_candidates(conn_name):
            full_module_name = f"connectors.{module_name}"
            try:
                module = importlib.import_module(full_module_name)
            except ModuleNotFoundError as e:
                if e.name == full_module_name:
                    continue
                raise

            connector = self._instantiate_connector_from_module(module, cache_keys=[conn_name, module_name])
            if connector:
                self.logger.info(f"コネクタをロードしました: {conn_name} (module: {module_name})")
                return connector
            raise Exception(f"コネクタ '{conn_name}' は見つかりましたが、BaseConnector実装がありません。")

        connector, resolved_module = self._load_connector_by_class_name_scan(conn_name)
        if connector:
            self.logger.info(f"コネクタをロードしました: {conn_name} (module: {resolved_module})")
            return connector

        raise Exception(f"コネクタ '{conn_name}' が見つかりません。")

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
