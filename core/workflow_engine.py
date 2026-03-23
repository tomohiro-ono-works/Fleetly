import copy
import os
import warnings
import yaml
import importlib
import inspect
import pkgutil
import re
import heapq
from collections import defaultdict
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

    def _normalize_context_ref(self, value):
        text = str(value or "").strip()
        if not text:
            return ""
        match = re.match(r"^\$?\{([^}]+)\}$", text)
        return match.group(1).strip() if match else text

    def _build_execution_plan(self, config):
        steps = config.get("steps", []) or []
        step_by_id = {}
        ordered_step_ids = []

        for step in steps:
            step_id = str(step.get("step_id") or "").strip()
            if not step_id or step_id in step_by_id:
                continue
            step_by_id[step_id] = step
            ordered_step_ids.append(step_id)

        flows = config.get("flows", {}) or {}
        raw_edges = flows.get("edges", [])
        if not isinstance(raw_edges, list) or not raw_edges:
            return steps

        adjacency = defaultdict(list)
        for edge in raw_edges:
            from_id = str(edge.get("from") or "").strip()
            to_id = str(edge.get("to") or "").strip()
            if not from_id or not to_id:
                continue
            if from_id != "START" and from_id not in step_by_id:
                continue
            if to_id != "END" and to_id not in step_by_id:
                continue
            order = edge.get("order", 0)
            try:
                order_num = int(order)
            except (TypeError, ValueError):
                order_num = 0
            adjacency[from_id].append((order_num, to_id))

        if not adjacency:
            return steps

        for edge_list in adjacency.values():
            edge_list.sort(key=lambda item: (item[0], item[1]))

        reachable = set()
        visit_rank = {}

        def visit(node_id):
            for _, next_id in adjacency.get(node_id, []):
                if next_id == "END" or next_id in reachable:
                    continue
                reachable.add(next_id)
                visit_rank[next_id] = len(visit_rank)
                visit(next_id)

        visit("START")
        if not reachable:
            return steps

        indegree = {step_id: 0 for step_id in reachable}
        for from_id, edge_list in adjacency.items():
            if from_id == "END":
                continue
            for _, to_id in edge_list:
                if to_id == "END" or to_id not in reachable:
                    continue
                if from_id in step_by_id:
                    indegree[to_id] += 1

        ready = []
        for step_id in reachable:
            if indegree.get(step_id, 0) == 0:
                heapq.heappush(ready, (visit_rank.get(step_id, len(visit_rank)), step_id))

        execution_ids = []
        while ready:
            _, step_id = heapq.heappop(ready)
            execution_ids.append(step_id)
            for _, next_id in adjacency.get(step_id, []):
                if next_id == "END" or next_id not in indegree:
                    continue
                indegree[next_id] -= 1
                if indegree[next_id] == 0:
                    heapq.heappush(ready, (visit_rank.get(next_id, len(visit_rank)), next_id))

        if len(execution_ids) < len(reachable):
            remaining_ids = sorted(
                [step_id for step_id in reachable if step_id not in execution_ids],
                key=lambda step_id: (visit_rank.get(step_id, len(visit_rank)), step_id)
            )
            self.logger.warning(
                "flows.edges に循環または未解決の依存があるため、一部ステップを到達順で補完します: %s",
                ", ".join(remaining_ids)
            )
            execution_ids.extend(remaining_ids)

        unreachable_ids = [step_id for step_id in ordered_step_ids if step_id not in reachable]
        if unreachable_ids:
            self.logger.warning(
                "START から到達できないステップは実行対象外です: %s",
                ", ".join(unreachable_ids)
            )

        return [step_by_id[step_id] for step_id in execution_ids if step_id in step_by_id]

    def _build_step_report(self, step, status, result=None, error=None):
        return {
            "step_id": step.get("step_id"),
            "connector": step.get("connector"),
            "action": step.get("action"),
            "params": copy.deepcopy(step.get("params", {}) or {}),
            "output_variable": step.get("output_variable"),
            "status": status,
            "result": result,
            "error": error,
        }

    def _execute_step(self, step):
        step_id = step.get("step_id")
        conn_name = step.get("connector")
        action = step.get("action")
        params = step.get("params", {}) or {}
        out_var = step.get("output_variable")

        if action == "loop_tasks":
            ref_key = self._normalize_context_ref(params.get("input_data"))
            passthrough = self.context.get(ref_key) if ref_key else None
            self.logger.info(f"[{step_id}] loop_tasks は未実装のためスキップします。")
            if out_var:
                self.context[out_var] = passthrough
            return passthrough

        self.logger.info(f"[{step_id}] 実行中: {conn_name} -> {action}")
        connector = self._get_or_load_connector(conn_name)
        result = connector.execute(action, params, self.context)
        if out_var:
            self.context[out_var] = result
        return result

    def run_workflow(self, yaml_path):
        report = {
            "workflow_path": os.path.abspath(str(yaml_path)),
            "workflow_name": "Untitled",
            "status": "error",
            "steps": [],
            "error": None,
        }

        if not os.path.exists(yaml_path):
            message = f"YAMLファイルが見つかりません: {yaml_path}"
            self.logger.error(message)
            report["error"] = message
            return report

        self.context = {}

        try:
            with open(yaml_path, 'r', encoding='utf-8') as f:
                config = yaml.safe_load(f) or {}
        except Exception as e:
            message = f"ワークフロー読込中にエラーが発生しました: {e}"
            self.logger.error(message)
            report["error"] = message
            return report

        if not isinstance(config, dict):
            message = "ワークフロー定義は辞書形式である必要があります。"
            self.logger.error(message)
            report["error"] = message
            return report

        meta = config.get("workflow_metadata", {})
        report["workflow_name"] = meta.get("name", "Untitled")
        self.logger.info(f"--- ワークフロー開始: {report['workflow_name']} ---")

        execution_plan = self._build_execution_plan(config)
        for step in execution_plan:
            sid = step.get("step_id")
            try:
                result = self._execute_step(step)
                report["steps"].append(self._build_step_report(step, "success", result=result))
            except Exception as e:
                message = str(e)
                report["steps"].append(self._build_step_report(step, "error", error=message))
                report["error"] = message
                self.logger.error(f"[{sid}] エラー発生: {message}")
                return report

        self.logger.info("--- ワークフロー完了 ---")
        report["status"] = "success"
        return report
