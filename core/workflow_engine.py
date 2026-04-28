import copy
import concurrent.futures
import os
import warnings
import yaml
import importlib
import inspect
import pkgutil
import re
import heapq
import threading
from datetime import datetime
import getpass
from collections import defaultdict
from connectors.base_connector import BaseConnector

warnings.filterwarnings("ignore")

class WorkflowEngine:
    def __init__(self, logger, step_status_callback=None):
        self.logger = logger
        self.step_status_callback = step_status_callback
        self.context = {}  # データを一時保持するメモリ空間
        self.connector_classes = {}  # 必要になった時点で遅延ロード
        self._connector_lock = threading.Lock()
        self._cancel_event = None
        self._context_ref_param_keys = {"input_data", "input_data_rename"}

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

    def _resolve_connector_class_from_module(self, module, cache_keys=None):
        for name, obj in inspect.getmembers(module, inspect.isclass):
            if issubclass(obj, BaseConnector) and obj is not BaseConnector:
                for key in (cache_keys or []):
                    if key:
                        self.connector_classes[key] = obj
                return obj
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
                    self.connector_classes[conn_name] = obj
                    self.connector_classes[module_name] = obj
                    return obj, module_name

        return None, None

    def _get_connector_class(self, conn_name):
        """
        指定されたコネクタクラスを遅延ロードして返す（2回目以降はキャッシュを返す）
        """
        if not conn_name:
            raise ValueError("コネクタ名が指定されていません。")

        with self._connector_lock:
            connector_class = self.connector_classes.get(conn_name)
            if connector_class:
                return connector_class

            for module_name in self._connector_module_candidates(conn_name):
                full_module_name = f"connectors.{module_name}"
                try:
                    module = importlib.import_module(full_module_name)
                except ModuleNotFoundError as e:
                    if e.name == full_module_name:
                        continue
                    raise

                connector_class = self._resolve_connector_class_from_module(module, cache_keys=[conn_name, module_name])
                if connector_class:
                    self.logger.info(f"コネクタをロードしました: {conn_name} (module: {module_name})")
                    return connector_class
                raise Exception(f"コネクタ '{conn_name}' は見つかりましたが、BaseConnector実装がありません。")

            connector_class, resolved_module = self._load_connector_by_class_name_scan(conn_name)
            if connector_class:
                self.logger.info(f"コネクタをロードしました: {conn_name} (module: {resolved_module})")
                return connector_class

        raise Exception(f"コネクタ '{conn_name}' が見つかりません。")

    def _create_connector(self, conn_name):
        connector_class = self._get_connector_class(conn_name)
        return connector_class()

    def _normalize_context_ref(self, value):
        text = str(value or "").strip()
        if not text:
            return ""
        double_brace_match = re.match(r"^\{\{\s*([a-zA-Z0-9_]+)\s*\}\}$", text)
        if double_brace_match:
            return double_brace_match.group(1).strip()
        match = re.match(r"^\$?\{([^}]+)\}$", text)
        return match.group(1).strip() if match else text

    def _load_start_variables(self, config):
        variables = config.get("variables", {}) or {}
        start_variables = variables.get("start")
        if isinstance(start_variables, list):
            for item in start_variables:
                if not isinstance(item, dict):
                    continue
                name = str(item.get("name") or "").strip()
                if not name:
                    continue
                self.context[name] = item.get("value")
            return
        if isinstance(start_variables, dict):
            for name, value in start_variables.items():
                normalized_name = str(name or "").strip()
                if not normalized_name:
                    continue
                self.context[normalized_name] = value

    def _resolve_runtime_user_name(self) -> str:
        candidates = [
            os.environ.get("ZIZ_USER_NAME"),
            os.environ.get("USERNAME"),
            os.environ.get("USER"),
        ]
        try:
            candidates.append(getpass.getuser())
        except Exception:
            pass
        try:
            candidates.append(os.getlogin())
        except Exception:
            pass
        for candidate in candidates:
            text = str(candidate or "").strip()
            if text:
                return text
        return "unknown"

    def _load_system_variables(self):
        now = datetime.now()
        system_values = {
            "current_date": now.strftime("%Y-%m-%d"),
            "user_name": self._resolve_runtime_user_name(),
        }
        for name, value in system_values.items():
            self.context[name] = value

    def _resolve_scalar_reference(self, name: str):
        normalized_name = str(name or "").strip()
        if normalized_name.endswith("()"):
            normalized_name = normalized_name[:-2].strip()
        if not normalized_name:
            raise ValueError("変数名が空です。")
        if normalized_name in self.context:
            return self.context[normalized_name]

        parts = normalized_name.split(".")
        root_name = parts[0].strip()
        if root_name not in self.context:
            raise ValueError(f"変数 '{normalized_name}' が定義されていません。")

        value = self.context[root_name]
        for part in parts[1:]:
            key = str(part or "").strip()
            if not key:
                raise ValueError(f"変数参照が不正です: {normalized_name}")
            value = self._resolve_nested_value(value, key, normalized_name)
        return value

    def _resolve_nested_value(self, value, key: str, original_name: str):
        if value is None:
            raise ValueError(f"変数 '{original_name}' の値が存在しません。")
        if hasattr(value, "iloc") and hasattr(value, "columns"):
            if len(value.index) == 0:
                raise ValueError(f"変数 '{original_name}' の参照元 DataFrame が空です。")
            if key not in value.columns:
                raise ValueError(f"変数 '{original_name}' の列 '{key}' が見つかりません。")
            return value.iloc[0][key]
        if isinstance(value, list):
            if not value:
                raise ValueError(f"変数 '{original_name}' の参照元配列が空です。")
            return self._resolve_nested_value(value[0], key, original_name)
        if isinstance(value, dict):
            if key not in value:
                raise ValueError(f"変数 '{original_name}' のキー '{key}' が見つかりません。")
            return value[key]
        raise ValueError(f"変数 '{original_name}' の値から '{key}' を参照できません。")

    def _stringify_template_value(self, key: str, value):
        if value is None:
            return ""
        if isinstance(value, (str, int, float, bool)):
            return str(value)
        raise ValueError(f"{key} に埋め込む変数は文字列化できる値である必要があります。")

    def _resolve_template_string(self, value: str, key: str | None = None):
        text = str(value)
        ref_name = self._normalize_context_ref(text)
        if key in self._context_ref_param_keys:
            return ref_name

        exact_match = re.fullmatch(r"\{\{\s*([a-zA-Z0-9_\.]+(?:\(\))?)\s*\}\}", text.strip())
        if exact_match:
            return self._resolve_scalar_reference(exact_match.group(1).strip())

        pattern = re.compile(r"\{\{\s*([a-zA-Z0-9_\.]+(?:\(\))?)\s*\}\}")
        if not pattern.search(text):
            return value

        def replace(match):
            name = match.group(1).strip()
            resolved = self._resolve_scalar_reference(name)
            return self._stringify_template_value(key or "text", resolved)

        return pattern.sub(replace, text)

    def _resolve_step_params(self, value, key: str | None = None):
        if isinstance(value, dict):
            return {sub_key: self._resolve_step_params(sub_value, key=str(sub_key)) for sub_key, sub_value in value.items()}
        if isinstance(value, list):
            return [self._resolve_step_params(item, key=key) for item in value]
        if isinstance(value, str):
            return self._resolve_template_string(value, key=key)
        return value

    def _build_execution_runtime(self, config):
        steps = config.get("steps", []) or []
        step_by_id = {}
        ordered_step_ids = []
        sequential_steps = []

        for step in steps:
            step_id = str(step.get("step_id") or "").strip()
            if not step_id or step_id in step_by_id:
                continue
            step_by_id[step_id] = step
            ordered_step_ids.append(step_id)
            sequential_steps.append(step)

        flows = config.get("flows", {}) or {}
        raw_edges = flows.get("edges", [])
        if not isinstance(raw_edges, list) or not raw_edges:
            return {
                "mode": "sequential",
                "steps": sequential_steps,
            }

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
            return {
                "mode": "sequential",
                "steps": sequential_steps,
            }

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
            return {
                "mode": "sequential",
                "steps": sequential_steps,
            }

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

        unreachable_ids = [step_id for step_id in ordered_step_ids if step_id not in reachable]
        if unreachable_ids:
            self.logger.warning(
                "START から到達できないステップは実行対象外です: %s",
                ", ".join(unreachable_ids)
            )

        return {
            "mode": "dag",
            "step_by_id": step_by_id,
            "adjacency": adjacency,
            "indegree": indegree,
            "ready": ready,
            "visit_rank": visit_rank,
            "reachable": reachable,
        }

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

    def _emit_step_status(self, step_id, status, message=None):
        if not self.step_status_callback or not step_id:
            return
        try:
            self.step_status_callback({
                "step_id": str(step_id),
                "status": str(status),
                "message": str(message or ""),
            })
        except Exception:
            return

    def _execute_step(self, step, context):
        if self._is_cancel_requested():
            raise RuntimeError("__FLOW_CANCELLED__")
        step_id = step.get("step_id")
        conn_name = step.get("connector")
        action = step.get("action")
        params = self._resolve_step_params(step.get("params", {}) or {})

        if action == "loop_tasks":
            ref_key = self._normalize_context_ref(params.get("input_data"))
            passthrough = context.get(ref_key) if ref_key else None
            self._emit_step_status(step_id, "running", f"{conn_name} -> {action}")
            self.logger.info(f"[{step_id}] loop_tasks は未実装のためスキップします。")
            self._emit_step_status(step_id, "success", f"{conn_name} -> {action}")
            return passthrough

        self._emit_step_status(step_id, "running", f"{conn_name} -> {action}")
        self.logger.info(f"[{step_id}] 実行中: {conn_name} -> {action}")
        connector = self._create_connector(conn_name)
        if hasattr(connector, "set_execution_logger"):
            connector.set_execution_logger(self.logger, step_id)
        try:
            result = connector.execute(action, params, context)
        finally:
            if hasattr(connector, "clear_execution_logger"):
                connector.clear_execution_logger()
        return result

    def _run_step_sequential(self, step, report):
        sid = step.get("step_id")
        if self._is_cancel_requested():
            self._mark_cancelled(report)
            return report["error"]
        try:
            result = self._execute_step(step, copy.copy(self.context))
            output_var = step.get("output_variable")
            if output_var:
                self.context[output_var] = result
            report["steps"].append(self._build_step_report(step, "success", result=result))
            self._emit_step_status(sid, "success", f"{step.get('connector')} -> {step.get('action')}")
            return None
        except Exception as e:
            if str(e) == "__FLOW_CANCELLED__":
                self._mark_cancelled(report)
                return report["error"]
            message = str(e)
            report["steps"].append(self._build_step_report(step, "error", error=message))
            report["error"] = message
            self._emit_step_status(sid, "error", message)
            self.logger.error(f"[{sid}] エラー発生: {message}")
            return message

    def _run_ready_queue(self, runtime, report):
        step_by_id = runtime["step_by_id"]
        adjacency = runtime["adjacency"]
        indegree = dict(runtime["indegree"])
        visit_rank = runtime["visit_rank"]
        reachable = set(runtime["reachable"])
        ready = list(runtime["ready"])
        heapq.heapify(ready)

        pending = {}
        active_output_vars = {}
        started = set()
        cycle_warned = False

        max_workers = max(1, len(reachable))
        executor = concurrent.futures.ThreadPoolExecutor(max_workers=max_workers)
        try:
            while pending or ready or len(started) < len(reachable):
                if self._is_cancel_requested() and not pending:
                    self._mark_cancelled(report)
                    break

                while ready and not report["error"]:
                    if self._is_cancel_requested():
                        break
                    _, step_id = heapq.heappop(ready)
                    if step_id in started:
                        continue
                    step = step_by_id[step_id]
                    output_var = str(step.get("output_variable") or "").strip()
                    if output_var and output_var in active_output_vars:
                        message = (
                            f"並行実行中に output_variable が競合しています: {output_var} "
                            f"({active_output_vars[output_var]} / {step_id})"
                        )
                        report["steps"].append(self._build_step_report(step, "error", error=message))
                        report["error"] = message
                        self._emit_step_status(step_id, "error", message)
                        self.logger.error(f"[{step_id}] エラー発生: {message}")
                        break

                    future = executor.submit(self._execute_step, step, copy.copy(self.context))
                    pending[future] = (step, output_var)
                    started.add(step_id)
                    if output_var:
                        active_output_vars[output_var] = step_id

                if not pending:
                    if report["error"]:
                        break
                    if self._is_cancel_requested():
                        self._mark_cancelled(report)
                        break

                    remaining_ids = [
                        step_id for step_id in reachable
                        if step_id not in started
                    ]
                    if not remaining_ids:
                        break

                    remaining_ids.sort(key=lambda step_id: (visit_rank.get(step_id, len(visit_rank)), step_id))
                    if not cycle_warned:
                        self.logger.warning(
                            "flows.edges に循環または未解決の依存があるため、一部ステップを到達順で補完します: %s",
                            ", ".join(remaining_ids)
                        )
                        cycle_warned = True
                    heapq.heappush(ready, (visit_rank.get(remaining_ids[0], len(visit_rank)), remaining_ids[0]))
                    continue

                done, _ = concurrent.futures.wait(
                    list(pending.keys()),
                    return_when=concurrent.futures.FIRST_COMPLETED,
                )

                for future in done:
                    step, output_var = pending.pop(future)
                    sid = step.get("step_id")
                    if output_var:
                        active_output_vars.pop(output_var, None)

                    try:
                        result = future.result()
                        if self._is_cancel_requested():
                            self._mark_cancelled(report)
                        if output_var:
                            self.context[output_var] = result
                        report["steps"].append(self._build_step_report(step, "success", result=result))
                        self._emit_step_status(sid, "success", f"{step.get('connector')} -> {step.get('action')}")
                        if not report["error"] and not report.get("cancelled"):
                            for _, next_id in adjacency.get(sid, []):
                                if next_id == "END" or next_id not in indegree:
                                    continue
                                indegree[next_id] -= 1
                                if indegree[next_id] == 0 and next_id not in started:
                                    heapq.heappush(ready, (visit_rank.get(next_id, len(visit_rank)), next_id))
                    except Exception as e:
                        if str(e) == "__FLOW_CANCELLED__":
                            self._mark_cancelled(report)
                            continue
                        message = str(e)
                        report["steps"].append(self._build_step_report(step, "error", error=message))
                        if not report["error"]:
                            report["error"] = message
                        self._emit_step_status(sid, "error", message)
                        self.logger.error(f"[{sid}] エラー発生: {message}")

            return report["error"]
        finally:
            executor.shutdown(wait=True, cancel_futures=bool(report["error"]))

    def _is_cancel_requested(self):
        return bool(self._cancel_event and self._cancel_event.is_set())

    def _mark_cancelled(self, report, message="実行がキャンセルされました。"):
        if report.get("cancelled"):
            return
        report["cancelled"] = True
        report["status"] = "cancelled"
        report["error"] = message
        self.logger.warning(message)

    def _run_config(self, config, flow_path, cancel_event=None, initial_context=None, only_step_id=None):
        report = {
            "flow_path": os.path.abspath(str(flow_path)),
            "flow_name": "Untitled",
            "workflow_path": os.path.abspath(str(flow_path)),
            "workflow_name": "Untitled",
            "status": "error",
            "steps": [],
            "error": None,
            "cancelled": False,
        }
        self.context = {}
        if isinstance(initial_context, dict) and initial_context:
            self.context.update(copy.copy(initial_context))
        self._cancel_event = cancel_event

        if not isinstance(config, dict):
            message = "フロー定義は辞書形式である必要があります。"
            self.logger.error(message)
            report["error"] = message
            return report

        if only_step_id:
            steps = config.get("steps") if isinstance(config.get("steps"), list) else []
            target_step = None
            for step in steps:
                if str(step.get("step_id") or "") == str(only_step_id):
                    target_step = copy.deepcopy(step)
                    break
            if not target_step:
                message = f"対象ステップが見つかりません: {only_step_id}"
                self.logger.error(message)
                report["error"] = message
                return report
            config = {
                "metadata": copy.deepcopy(config.get("metadata") or {}),
                "variables": copy.deepcopy(config.get("variables") or {}),
                "steps": [target_step],
                "flows": {},
            }

        meta = config.get("metadata", {}) or {}
        report["flow_name"] = meta.get("name", "Untitled")
        report["workflow_name"] = report["flow_name"]
        self._load_start_variables(config)
        self._load_system_variables()
        self.logger.info(f"--- フロー開始: {report['flow_name']} ---")

        runtime = self._build_execution_runtime(config)
        if runtime["mode"] == "sequential":
            for step in runtime["steps"]:
                error = self._run_step_sequential(step, report)
                if error:
                    if report.get("cancelled"):
                        return report
                    return report
        else:
            error = self._run_ready_queue(runtime, report)
            if error:
                return report

        if report.get("cancelled"):
            return report

        self.logger.info("--- フロー完了 ---")
        report["status"] = "success"
        return report

    def run_flow(self, yaml_path, cancel_event=None):
        if not os.path.exists(yaml_path):
            message = f"YAMLファイルが見つかりません: {yaml_path}"
            self.logger.error(message)
            return {
                "flow_path": os.path.abspath(str(yaml_path)),
                "flow_name": "Untitled",
                "workflow_path": os.path.abspath(str(yaml_path)),
                "workflow_name": "Untitled",
                "status": "error",
                "steps": [],
                "error": message,
                "cancelled": False,
            }

        try:
            with open(yaml_path, 'r', encoding='utf-8') as f:
                config = yaml.safe_load(f) or {}
        except Exception as e:
            message = f"フロー読込中にエラーが発生しました: {e}"
            self.logger.error(message)
            return {
                "flow_path": os.path.abspath(str(yaml_path)),
                "flow_name": "Untitled",
                "workflow_path": os.path.abspath(str(yaml_path)),
                "workflow_name": "Untitled",
                "status": "error",
                "steps": [],
                "error": message,
                "cancelled": False,
            }

        try:
            return self._run_config(config, yaml_path, cancel_event=cancel_event)
        finally:
            self._cancel_event = None

    def run_flow_from_config(self, config, flow_path="<gui>", cancel_event=None, initial_context=None, only_step_id=None):
        try:
            return self._run_config(
                config,
                flow_path,
                cancel_event=cancel_event,
                initial_context=initial_context,
                only_step_id=only_step_id,
            )
        finally:
            self._cancel_event = None

    def run_workflow(self, yaml_path):
        return self.run_flow(yaml_path)
