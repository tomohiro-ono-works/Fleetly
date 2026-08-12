import copy
import concurrent.futures
import os
import warnings
import yaml
import re
import heapq
import time
from datetime import datetime
import getpass
from collections import defaultdict
from core.connector_factory import ConnectorFactory
from shared.tabular_preview import (
    build_dataframe_ui_cache,
    is_dataframe_like,
)
from shared.process_runner import ProcessCancelledError

warnings.filterwarnings("ignore")

class WorkflowEngine:
    VARIABLE_NAME_CHAR_CLASS = r"a-zA-Z0-9_\u3040-\u309F\u30A0-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\u3005"
    TEMPLATE_REF_PATTERN = rf"[{VARIABLE_NAME_CHAR_CLASS}]+(?:\.[{VARIABLE_NAME_CHAR_CLASS}]+)*(?:\(\))?"

    def __init__(
        self,
        logger,
        step_status_callback=None,
        performance_callback=None,
        step_result_callback=None,
    ):
        self.logger = logger
        self.step_status_callback = step_status_callback
        self.performance_callback = performance_callback
        self.step_result_callback = step_result_callback
        self.context = {}  # データを一時保持するメモリ空間
        self.connector_factory = ConnectorFactory(logger=logger)
        self._cancel_event = None
        self._worker_pool = None
        self._run_id = ""
        self._max_parallel_steps = 4
        self._secret_values = set()
        self._context_ref_param_keys = {"input_data", "input_data_rename"}
        self._loop_children_by_owner = {}
        self._inline_loop_children_enabled = False

    def configure_runtime(
        self,
        *,
        run_id="",
        worker_pool=None,
        max_parallel_steps=4,
        secret_values=None,
    ):
        self._run_id = str(run_id or "").strip()
        self._worker_pool = worker_pool
        self._max_parallel_steps = max(1, int(max_parallel_steps))
        self._secret_values = set(secret_values or set())

    def _create_connector(self, conn_name):
        return self.connector_factory.create(conn_name)

    def _normalize_context_ref(self, value):
        text = str(value or "").strip()
        if not text:
            return ""
        double_brace_match = re.match(rf"^\{{\{{\s*([{self.VARIABLE_NAME_CHAR_CLASS}]+)\s*\}}\}}$", text)
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

        exact_match = re.fullmatch(rf"\{{\{{\s*({self.TEMPLATE_REF_PATTERN})\s*\}}\}}", text.strip())
        if exact_match:
            return self._resolve_scalar_reference(exact_match.group(1).strip())

        pattern = re.compile(rf"\{{\{{\s*({self.TEMPLATE_REF_PATTERN})\s*\}}\}}")
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
        step_owner_by_id = {}
        ordered_step_ids = []
        sequential_steps = []

        for step in steps:
            step_id = str(step.get("step_id") or "").strip()
            if not step_id or step_id in step_by_id:
                continue
            step_by_id[step_id] = step
            step_owner_by_id[step_id] = str(step.get("loop_owner_id") or "").strip()
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
            # loop内ノードは loop_tasks 側でのみ実行するため、
            # 本体DAGには含めない。
            if from_id != "START" and step_owner_by_id.get(from_id):
                continue
            if to_id != "END" and step_owner_by_id.get(to_id):
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

        unreachable_ids = [
            step_id for step_id in ordered_step_ids
            if step_id not in reachable and not step_owner_by_id.get(step_id)
        ]
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

    def _index_loop_children(self, config):
        self._loop_children_by_owner = {}
        steps = config.get("steps") if isinstance(config.get("steps"), list) else []
        step_by_id = {}
        owner_children_ids = defaultdict(list)
        for step in steps:
            step_id = str(step.get("step_id") or "").strip()
            if not step_id:
                continue
            step_by_id[step_id] = step
            owner_id = str(step.get("loop_owner_id") or "").strip()
            if owner_id:
                owner_children_ids[owner_id].append(step_id)
        if not owner_children_ids:
            return

        loop_edges_by_owner = defaultdict(list)
        flows = config.get("flows", {}) or {}
        raw_edges = flows.get("edges", [])
        if isinstance(raw_edges, list):
            for edge in raw_edges:
                from_id = str(edge.get("from") or "").strip()
                to_id = str(edge.get("to") or "").strip()
                if not from_id or not to_id or to_id == "END":
                    continue
                target_step = step_by_id.get(to_id)
                if not target_step:
                    continue
                owner_id = str(target_step.get("loop_owner_id") or "").strip()
                if not owner_id:
                    continue
                source_owner_id = ""
                source_step = step_by_id.get(from_id)
                if source_step:
                    source_owner_id = str(source_step.get("loop_owner_id") or "").strip()
                if from_id != owner_id and source_owner_id != owner_id:
                    continue
                try:
                    order_num = int(edge.get("order", 0))
                except (TypeError, ValueError):
                    order_num = 0
                loop_edges_by_owner[owner_id].append((from_id, to_id, order_num))

        # 新形式: loop.flows.<owner_id>.edges（互換: flows.loop.flows）
        loop_config = config.get("loop", {}) or {}
        loop_flows = loop_config.get("flows", {}) if isinstance(loop_config, dict) else {}
        flows_loop_config = flows.get("loop", {}) if isinstance(flows, dict) else {}
        flows_loop_flows = flows_loop_config.get("flows", {}) if isinstance(flows_loop_config, dict) else {}
        merged_loop_flows = {}
        if isinstance(flows_loop_flows, dict):
            merged_loop_flows.update(flows_loop_flows)
        if isinstance(loop_flows, dict):
            merged_loop_flows.update(loop_flows)
        if isinstance(merged_loop_flows, dict):
            for owner_id, owner_flow in merged_loop_flows.items():
                owner_key = str(owner_id or "").strip()
                if not owner_key:
                    continue
                edges = owner_flow.get("edges", []) if isinstance(owner_flow, dict) else []
                if not isinstance(edges, list):
                    continue
                for edge in edges:
                    from_id = str(edge.get("from") or "").strip()
                    to_id = str(edge.get("to") or "").strip()
                    if not from_id or not to_id or to_id == "END":
                        continue
                    try:
                        order_num = int(edge.get("order", 0))
                    except (TypeError, ValueError):
                        order_num = 0
                    loop_edges_by_owner[owner_key].append((from_id, to_id, order_num))

        for owner_id, child_ids in owner_children_ids.items():
            visited = set()
            ordered_ids = []
            adjacency = defaultdict(list)
            for from_id, to_id, order_num in loop_edges_by_owner.get(owner_id, []):
                adjacency[from_id].append((order_num, to_id))
            for edge_list in adjacency.values():
                edge_list.sort(key=lambda item: (item[0], item[1]))

            def visit(node_id):
                for _, next_id in adjacency.get(node_id, []):
                    if next_id not in child_ids or next_id in visited:
                        continue
                    visited.add(next_id)
                    ordered_ids.append(next_id)
                    visit(next_id)

            visit("START")
            visit(owner_id)
            for child_id in child_ids:
                if child_id in visited:
                    continue
                visited.add(child_id)
                ordered_ids.append(child_id)
            self._loop_children_by_owner[owner_id] = [
                copy.deepcopy(step_by_id[child_id])
                for child_id in ordered_ids
                if child_id in step_by_id
            ]

    def _normalize_loop_records(self, value):
        if value is None:
            return []
        if hasattr(value, "to_dict") and callable(getattr(value, "to_dict", None)) and hasattr(value, "columns"):
            try:
                return value.to_dict(orient="records")
            except Exception:
                pass
        if isinstance(value, dict):
            return [copy.copy(value)]
        if isinstance(value, list):
            records = []
            for item in value:
                if isinstance(item, dict):
                    records.append(copy.copy(item))
                else:
                    records.append({"value": item})
            return records
        raise TypeError(f"繰り返しデータをレコード配列へ変換できません: {type(value).__name__}")

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

    def _looks_like_dataframe(self, value):
        return is_dataframe_like(value)

    def _emit_performance(self, event, payload=None):
        if not callable(self.performance_callback):
            return
        if not event:
            return
        try:
            self.performance_callback(str(event), dict(payload or {}))
        except Exception:
            return

    def _dataframe_shape_text(self, value):
        if not self._looks_like_dataframe(value):
            return ""
        try:
            return f"rows={len(value.index)} cols={len(value.columns)}"
        except Exception:
            return ""

    def _is_missing_preview_value(self, value):
        if value is None:
            return True
        try:
            result = value != value
        except Exception:
            return False
        try:
            return bool(result)
        except Exception:
            return False

    def _build_dataframe_ui_cache(self, dataframe):
        return build_dataframe_ui_cache(dataframe)

    def _collect_step_context_refs(self, value):
        refs = set()
        if isinstance(value, dict):
            for sub_value in value.values():
                refs.update(self._collect_step_context_refs(sub_value))
            return refs
        if isinstance(value, list):
            for item in value:
                refs.update(self._collect_step_context_refs(item))
            return refs
        if not isinstance(value, str):
            return refs
        text = str(value)
        exact_match = re.fullmatch(rf"\{{\{{\s*({self.TEMPLATE_REF_PATTERN})\s*\}}\}}", text.strip())
        if exact_match:
            refs.add(exact_match.group(1).strip().split(".")[0].strip())
            return refs
        pattern = re.compile(rf"\{{\{{\s*({self.TEMPLATE_REF_PATTERN})\s*\}}\}}")
        for match in pattern.findall(text):
            refs.add(str(match).split(".")[0].strip())
        shell_match = re.fullmatch(r"^\$?\{([^}]+)\}$", text.strip())
        if shell_match:
            refs.add(str(shell_match.group(1) or "").split(".")[0].strip())
        return refs

    def _build_sequential_lifetime_plan(self, steps):
        output_var_to_step = {}
        for step in steps:
            sid = str(step.get("step_id") or "").strip()
            output_var = str(step.get("output_variable") or "").strip()
            if sid and output_var:
                output_var_to_step[output_var] = sid

        consumers_by_producer = defaultdict(set)
        producers_by_consumer = defaultdict(set)
        for step in steps:
            consumer_id = str(step.get("step_id") or "").strip()
            if not consumer_id:
                continue
            params = step.get("params", {}) or {}
            refs = self._collect_step_context_refs(params)
            if str(step.get("node_type") or "task").strip() == "loop":
                source_ref = self._normalize_context_ref(
                    (params.get("source_step_id") or params.get("input_data"))
                )
                if source_ref:
                    refs.add(str(source_ref).split(".")[0].strip())
            for ref_root in refs:
                producer_id = output_var_to_step.get(ref_root)
                if not producer_id or producer_id == consumer_id:
                    continue
                consumers_by_producer[producer_id].add(consumer_id)
                producers_by_consumer[consumer_id].add(producer_id)

        remaining_consumers = {
            producer_id: len(consumers_by_producer.get(producer_id, set()))
            for producer_id in output_var_to_step.values()
        }
        return {
            "remaining_consumers": remaining_consumers,
            "producers_by_consumer": producers_by_consumer,
        }

    def _decrement_lifetime_after_step(self, step_id, plan, report):
        if not isinstance(plan, dict):
            return
        producers = (plan.get("producers_by_consumer") or {}).get(str(step_id), set())
        remaining = plan.get("remaining_consumers") or {}
        for producer_id in producers:
            if producer_id not in remaining:
                continue
            remaining[producer_id] = max(0, int(remaining.get(producer_id, 0)) - 1)
            if remaining[producer_id] != 0:
                continue
            self._release_producer_result(
                producer_id,
                step_id,
                plan,
            )
        self._release_producer_result(
            str(step_id or ""),
            str(step_id or ""),
            plan,
        )

    def _release_producer_result(self, producer_id, terminal_step_id, plan):
        if not producer_id:
            return
        if producer_id in set(plan.get("retain_producer_ids") or set()):
            return
        remaining = plan.get("remaining_consumers") or {}
        if int(remaining.get(producer_id, 0)) != 0:
            return
        producer_output_var = str(
            (plan.get("producer_step_meta") or {}).get(producer_id, "")
        ).strip()
        if producer_output_var and producer_output_var in self.context:
            del self.context[producer_output_var]
            self.logger.info(
                "[%s] context寿命管理: %s を解放しました。",
                terminal_step_id,
                producer_output_var,
            )
        report_entries = plan.get("report_entry_by_step_id") or {}
        producer_entry = report_entries.get(producer_id)
        if isinstance(producer_entry, dict):
            producer_entry["result"] = None

    def _apply_define_values_result(self, step, result):
        if str(step.get("action") or "").strip() != "define_values":
            return
        rows = []
        result_attrs = getattr(result, "attrs", None)
        if isinstance(result_attrs, dict) and isinstance(result_attrs.get("ziz_define_values"), list):
            rows = result_attrs.get("ziz_define_values") or []
        elif hasattr(result, "to_dict") and callable(getattr(result, "to_dict", None)) and hasattr(result, "columns"):
            try:
                rows = result.to_dict(orient="records")
            except Exception:
                rows = []
        elif isinstance(result, list):
            rows = result
        elif isinstance(result, dict):
            rows = [result]
        if not rows:
            return
        for row in rows:
            if not isinstance(row, dict):
                continue
            name = str(row.get("variable_name") or row.get("name") or row.get("key") or "").strip()
            if not name:
                continue
            self.context[name] = row.get("value")

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

    def _emit_step_result(self, report_entry):
        if not callable(self.step_result_callback):
            return
        if not isinstance(report_entry, dict):
            return
        try:
            self.step_result_callback(report_entry)
        except Exception:
            return

    def _execute_step(self, step, context):
        if self._is_cancel_requested():
            raise RuntimeError("__FLOW_CANCELLED__")
        step_id = step.get("step_id")
        context["__step_id"] = str(step_id or "")
        conn_name = step.get("connector")
        action = step.get("action")
        params = self._resolve_step_params(step.get("params", {}) or {})

        if str(step.get("node_type") or "task").strip() == "loop":
            ref_key = self._normalize_context_ref(params.get("source_step_id") or params.get("input_data"))
            if not ref_key:
                raise ValueError("source_step_id は必須です。")
            source_value = context.get(ref_key)
            loop_records = self._normalize_loop_records(source_value)
            try:
                if not self._inline_loop_children_enabled:
                    self._emit_step_status(step_id, "running", f"{conn_name} -> {action}")
                    self.logger.info(f"[{step_id}] loop_tasks は未実装のためスキップします。")
                    self._emit_step_status(step_id, "success", f"{conn_name} -> {action}")
                    return loop_records
                max_iterations = 0
                try:
                    max_iterations = int(params.get("max_iterations") or 0)
                except (TypeError, ValueError):
                    max_iterations = 0
                if max_iterations > 0:
                    loop_records = loop_records[:max_iterations]
                child_steps = self._loop_children_by_owner.get(str(step_id or ""), [])
                self._emit_step_status(step_id, "running", f"{conn_name} -> {action}")
                self.logger.info(
                    f"[{step_id}] loop_tasks 実行: source={ref_key} iterations={len(loop_records)} child_steps={len(child_steps)}"
                )
                if child_steps and loop_records:
                    had_current_item = "current_item" in self.context
                    prev_current_item = self.context.get("current_item")
                    had_current_index = "current_index" in self.context
                    prev_current_index = self.context.get("current_index")
                    had_source_ref = ref_key in self.context
                    prev_source_ref = self.context.get(ref_key)
                    try:
                        for index, record in enumerate(loop_records):
                            if self._is_cancel_requested():
                                raise RuntimeError("__FLOW_CANCELLED__")
                            self.context["current_item"] = record
                            self.context["current_index"] = index
                            self.context[ref_key] = record
                            for child_step in child_steps:
                                child_report = {"steps": [], "error": None, "cancelled": False}
                                child_error = self._run_step_sequential(child_step, child_report)
                                if child_error:
                                    raise RuntimeError(str(child_error))
                                if child_report.get("cancelled"):
                                    raise RuntimeError("__FLOW_CANCELLED__")
                    finally:
                        if had_current_item:
                            self.context["current_item"] = prev_current_item
                        else:
                            self.context.pop("current_item", None)
                        if had_current_index:
                            self.context["current_index"] = prev_current_index
                        else:
                            self.context.pop("current_index", None)
                        if had_source_ref:
                            self.context[ref_key] = prev_source_ref
                        else:
                            self.context.pop(ref_key, None)
                self._emit_step_status(step_id, "success", f"{conn_name} -> {action}")
                return loop_records
            finally:
                del loop_records

        connector = self._create_connector(conn_name)
        if hasattr(connector, "set_execution_logger"):
            connector.set_execution_logger(
                self.logger,
                step_id,
                self._emit_performance,
                connector_id=conn_name,
                action_id=action,
                cancel_event=self._cancel_event,
                secret_values=self._secret_values,
            )
        started = time.perf_counter()
        self._emit_performance("run.core.connector.start", {
            "step_id": step_id,
            "connector": conn_name,
            "action": action,
        })
        try:
            if self._worker_pool is None:
                self._emit_step_status(
                    step_id,
                    "running",
                    f"{conn_name} -> {action}",
                )
                self.logger.info(
                    f"[{step_id}] 実行中: {conn_name} -> {action}"
                )
                result = connector.execute(action, params, context)
            else:
                with self._worker_pool.lease(
                    self._run_id,
                    cancel_event=self._cancel_event,
                    on_queued=lambda: self._emit_step_status(
                        step_id,
                        "queued",
                        "実行待ち",
                    ),
                ) as acquired:
                    if not acquired:
                        raise RuntimeError("__FLOW_CANCELLED__")
                    self._emit_step_status(
                        step_id,
                        "running",
                        f"{conn_name} -> {action}",
                    )
                    self.logger.info(
                        f"[{step_id}] 実行中: {conn_name} -> {action}"
                    )
                    result = connector.execute(action, params, context)
        finally:
            elapsed_ms = round((time.perf_counter() - started) * 1000, 1)
            self._emit_performance("run.core.connector.finish", {
                "step_id": step_id,
                "connector": conn_name,
                "action": action,
                "elapsed_ms": elapsed_ms,
            })
            self.logger.info(
                f"[{step_id}] connector.execute 完了: {conn_name} -> {action} "
                f"elapsed_ms={elapsed_ms}"
            )
            if hasattr(connector, "clear_execution_logger"):
                connector.clear_execution_logger()
        return result

    def _run_step_sequential(self, step, report, lifetime_plan=None):
        sid = step.get("step_id")
        if self._is_cancel_requested():
            self._mark_cancelled(report)
            return report["error"]
        try:
            result = self._execute_step(step, copy.copy(self.context))
            self._apply_define_values_result(step, result)
            output_var = step.get("output_variable")
            if output_var:
                self.context[output_var] = result
            if self._looks_like_dataframe(result):
                report_entry = self._build_step_report(step, "success", result=None)
                cache_started = time.perf_counter()
                report_entry["ui_cache"] = self._build_dataframe_ui_cache(result)
                cache_elapsed_ms = round((time.perf_counter() - cache_started) * 1000, 1)
                self._emit_performance("run.core.ui_cache.finish", {
                    "step_id": sid,
                    "elapsed_ms": cache_elapsed_ms,
                    "rows": len(result.index),
                    "cols": len(result.columns),
                })
                self.logger.info(
                    f"[{sid}] ui_cache build 完了: elapsed_ms={cache_elapsed_ms} "
                    f"{self._dataframe_shape_text(result)}"
                )
            else:
                report_entry = self._build_step_report(step, "success", result=result)
            report["steps"].append(report_entry)
            self._emit_step_result(report_entry)
            report_step_map = (lifetime_plan or {}).get("report_entry_by_step_id")
            if isinstance(report_step_map, dict):
                report_step_map[str(sid or "")] = report_entry
            self._emit_step_status(sid, "success", f"{step.get('connector')} -> {step.get('action')}")
            return None
        except Exception as e:
            if isinstance(e, ProcessCancelledError) or str(e) == "__FLOW_CANCELLED__":
                self._mark_cancelled(report)
                return report["error"]
            message = str(e)
            report_entry = self._build_step_report(
                step,
                "error",
                error=message,
            )
            report["steps"].append(report_entry)
            self._emit_step_result(report_entry)
            report["error"] = message
            self._emit_step_status(sid, "error", message)
            self.logger.error(f"[{sid}] エラー発生: {message}")
            return message
        finally:
            self._decrement_lifetime_after_step(sid, lifetime_plan, report)

    def _run_ready_queue(self, runtime, report, lifetime_plan=None):
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
        queued_notified = set()
        max_workers = max(
            1,
            min(self._max_parallel_steps, len(reachable)),
        )
        for _, step_id in ready:
            self._emit_step_status(step_id, "queued", "実行待ち")
            queued_notified.add(step_id)
        executor = concurrent.futures.ThreadPoolExecutor(max_workers=max_workers)
        try:
            while pending or ready or len(started) < len(reachable):
                if (
                    self._is_cancel_requested()
                    and not report.get("_primary_error")
                    and not pending
                ):
                    self._mark_cancelled(report)
                    break

                while (
                    ready
                    and len(pending) < max_workers
                    and not report["error"]
                ):
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
                        self._record_parallel_failure(
                            report,
                            step,
                            message,
                            pending,
                            active_output_vars,
                            lifetime_plan,
                        )
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
                    message = (
                        "flows.edges に循環または未解決の依存があります: "
                        + ", ".join(remaining_ids)
                    )
                    report["error"] = message
                    report["_primary_error"] = message
                    self.logger.error(message)
                    break

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
                        if future.cancelled():
                            self._record_skipped_step(
                                report,
                                step,
                                lifetime_plan,
                            )
                            continue
                        result = future.result()
                        self._apply_define_values_result(step, result)
                        if (
                            self._is_cancel_requested()
                            and not report.get("_primary_error")
                        ):
                            self._mark_cancelled(report)
                        if output_var:
                            self.context[output_var] = result
                        if self._looks_like_dataframe(result):
                            report_entry = self._build_step_report(step, "success", result=None)
                            cache_started = time.perf_counter()
                            report_entry["ui_cache"] = self._build_dataframe_ui_cache(result)
                            cache_elapsed_ms = round((time.perf_counter() - cache_started) * 1000, 1)
                            self._emit_performance("run.core.ui_cache.finish", {
                                "step_id": sid,
                                "elapsed_ms": cache_elapsed_ms,
                                "rows": len(result.index),
                                "cols": len(result.columns),
                            })
                            self.logger.info(
                                f"[{sid}] ui_cache build 完了: elapsed_ms={cache_elapsed_ms} "
                                f"{self._dataframe_shape_text(result)}"
                            )
                        else:
                            report_entry = self._build_step_report(step, "success", result=result)
                        report["steps"].append(report_entry)
                        self._emit_step_result(report_entry)
                        report_step_map = (lifetime_plan or {}).get("report_entry_by_step_id")
                        if isinstance(report_step_map, dict):
                            report_step_map[str(sid or "")] = report_entry
                        self._emit_step_status(sid, "success", f"{step.get('connector')} -> {step.get('action')}")
                        self._decrement_lifetime_after_step(sid, lifetime_plan, report)
                        if not report["error"] and not report.get("cancelled"):
                            for _, next_id in adjacency.get(sid, []):
                                if next_id == "END" or next_id not in indegree:
                                    continue
                                indegree[next_id] -= 1
                                if indegree[next_id] == 0 and next_id not in started:
                                    heapq.heappush(ready, (visit_rank.get(next_id, len(visit_rank)), next_id))
                                    if next_id not in queued_notified:
                                        self._emit_step_status(
                                            next_id,
                                            "queued",
                                            "実行待ち",
                                        )
                                        queued_notified.add(next_id)
                    except Exception as e:
                        if (
                            isinstance(e, ProcessCancelledError)
                            or str(e) == "__FLOW_CANCELLED__"
                        ):
                            report_entry = self._build_step_report(
                                step,
                                "cancelled",
                                error="実行がキャンセルされました。",
                            )
                            report["steps"].append(report_entry)
                            self._emit_step_result(report_entry)
                            self._emit_step_status(
                                sid,
                                "cancelled",
                                "実行がキャンセルされました。",
                            )
                            if not report.get("_primary_error"):
                                self._mark_cancelled(report)
                            continue
                        message = str(e)
                        self._record_parallel_failure(
                            report,
                            step,
                            message,
                            pending,
                            active_output_vars,
                            lifetime_plan,
                        )

            if report.get("_primary_error") or report.get("cancelled"):
                completed_ids = {
                    str(step.get("step_id") or "")
                    for step in report.get("steps") or []
                }
                for step_id in sorted(
                    reachable - completed_ids,
                    key=lambda value: (
                        visit_rank.get(value, len(visit_rank)),
                        value,
                    ),
                ):
                    self._record_skipped_step(
                        report,
                        step_by_id[step_id],
                        lifetime_plan,
                    )
            report.pop("_primary_error", None)
            return report["error"]
        finally:
            executor.shutdown(wait=True, cancel_futures=bool(report["error"]))

    def _record_parallel_failure(
        self,
        report,
        step,
        message,
        pending,
        active_output_vars,
        lifetime_plan,
    ):
        step_id = str(step.get("step_id") or "")
        report_entry = self._build_step_report(
            step,
            "error",
            error=message,
        )
        report["steps"].append(report_entry)
        self._emit_step_result(report_entry)
        if not report.get("_primary_error"):
            report["_primary_error"] = message
            report["error"] = message
            if self._cancel_event is not None:
                self._cancel_event.set()
            for future, (queued_step, output_var) in list(pending.items()):
                if not future.cancel():
                    continue
                pending.pop(future, None)
                if output_var:
                    active_output_vars.pop(output_var, None)
                self._record_skipped_step(
                    report,
                    queued_step,
                    lifetime_plan,
                )
        self._emit_step_status(step_id, "error", message)
        self.logger.error(f"[{step_id}] エラー発生: {message}")

    def _record_skipped_step(self, report, step, lifetime_plan):
        step_id = str(step.get("step_id") or "")
        if any(
            str(item.get("step_id") or "") == step_id
            for item in report.get("steps") or []
        ):
            return
        report_entry = self._build_step_report(
            step,
            "skipped",
            error="先行する失敗またはキャンセルにより実行されませんでした。",
        )
        report["steps"].append(report_entry)
        self._emit_step_result(report_entry)
        report_step_map = (lifetime_plan or {}).get(
            "report_entry_by_step_id"
        )
        if isinstance(report_step_map, dict):
            report_step_map[step_id] = report_entry
        self._emit_step_status(
            step_id,
            "skipped",
            "実行されませんでした。",
        )
        self._decrement_lifetime_after_step(
            step_id,
            lifetime_plan,
            report,
        )

    def _is_cancel_requested(self):
        return bool(self._cancel_event and self._cancel_event.is_set())

    def _mark_cancelled(self, report, message="実行がキャンセルされました。"):
        if report.get("_primary_error"):
            return
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

        self._index_loop_children(config)
        self._inline_loop_children_enabled = True

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
            self._inline_loop_children_enabled = (
                str(target_step.get("node_type") or "task").strip()
                == "loop"
            )
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
        steps_for_lifetime = runtime["steps"] if runtime["mode"] == "sequential" else [
            runtime["step_by_id"][step_id]
            for step_id in sorted(list(runtime.get("reachable", set())), key=lambda k: runtime.get("visit_rank", {}).get(k, 0))
            if step_id in runtime["step_by_id"]
        ]
        lifetime_plan = self._build_sequential_lifetime_plan(steps_for_lifetime)
        producer_step_meta = {}
        for step in steps_for_lifetime:
            sid = str(step.get("step_id") or "").strip()
            output_var = str(step.get("output_variable") or "").strip()
            if sid and output_var:
                producer_step_meta[sid] = output_var
        lifetime_plan["producer_step_meta"] = producer_step_meta
        lifetime_plan["report_entry_by_step_id"] = {}
        lifetime_plan["retain_producer_ids"] = (
            {str(only_step_id)}
            if only_step_id
            else set()
        )

        if runtime["mode"] == "sequential":
            for index, step in enumerate(runtime["steps"]):
                error = self._run_step_sequential(step, report, lifetime_plan=lifetime_plan)
                if error:
                    for skipped_step in runtime["steps"][index + 1:]:
                        self._record_skipped_step(
                            report,
                            skipped_step,
                            lifetime_plan,
                        )
                    if report.get("cancelled"):
                        return report
                    return report
        else:
            error = self._run_ready_queue(runtime, report, lifetime_plan=lifetime_plan)
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
