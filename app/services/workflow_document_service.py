import copy
import re
from dataclasses import dataclass


CANONICAL_ID_PATTERN = re.compile(
    r"(?:0[1-9]|[1-9][0-9]|[1-9][0-9]{2,})"
)


def _safe_text(value):
    return str(value or "").strip()


@dataclass(frozen=True)
class WorkflowRunPlan:
    document: dict
    execution_config: dict
    flow_id: str
    flow_name: str
    step_ids: tuple
    requested_step_id: str


class WorkflowDocumentService:
    def __init__(self, catalog_service):
        self.catalog_service = catalog_service

    def prepare_run(self, document, *, flow_id, step_id=None):
        snapshot = copy.deepcopy(document)
        if not isinstance(snapshot, dict):
            raise ValueError("document はオブジェクトで指定してください。")
        normalized_flow_id = self._require_id(flow_id, "flow_id")
        flows = snapshot.get("flows")
        if not isinstance(flows, dict) or "edges" in flows:
            raise ValueError(
                "flows はflow_idをkeyとする202607形式で指定してください。"
            )
        self._validate_unassigned(snapshot.get("unassigned"))
        step_by_id = self._validate_steps(snapshot, flows)
        self._validate_all_flows(flows, step_by_id)
        self._validate_loops(snapshot, step_by_id, flows)

        flow = flows.get(normalized_flow_id)
        if not isinstance(flow, dict):
            raise ValueError(
                f"指定flow_idがdocumentに存在しません: {normalized_flow_id}"
            )
        selected_steps = [
            step
            for step in snapshot.get("steps") or []
            if _safe_text(step.get("flow_id")) == normalized_flow_id
        ]
        selected_step_ids = tuple(
            _safe_text(step.get("step_id")) for step in selected_steps
        )
        requested_step_id = _safe_text(step_id)
        if requested_step_id:
            self._require_id(requested_step_id, "step_id")
            target = step_by_id.get(requested_step_id)
            if (
                not target
                or _safe_text(target.get("flow_id")) != normalized_flow_id
            ):
                raise ValueError(
                    "指定step_idは対象flowに存在しません。"
                )
            if _safe_text(target.get("loop_owner_id")):
                raise ValueError("loop内stepは単独実行できません。")

        compiled_steps = [
            self._compile_step(step)
            for step in selected_steps
        ]
        metadata = copy.deepcopy(snapshot.get("metadata") or {})
        flow_name = (
            _safe_text(flow.get("label"))
            or _safe_text(metadata.get("name"))
            or "Untitled"
        )
        metadata["name"] = flow_name
        execution_config = {
            "metadata": metadata,
            "variables": {
                "start": copy.deepcopy(
                    ((flow.get("start") or {}).get("variables") or [])
                )
            },
            "steps": compiled_steps,
            "flows": {
                "start": "START",
                "end": "END",
                "edges": copy.deepcopy(flow.get("edges") or []),
            },
        }
        loop_flows = copy.deepcopy(
            ((snapshot.get("loop") or {}).get("flows") or {})
        )
        selected_loop_flows = {
            owner_id: owner_flow
            for owner_id, owner_flow in loop_flows.items()
            if owner_id in selected_step_ids
        }
        if selected_loop_flows:
            execution_config["loop"] = {"flows": selected_loop_flows}

        return WorkflowRunPlan(
            document=snapshot,
            execution_config=execution_config,
            flow_id=normalized_flow_id,
            flow_name=flow_name,
            step_ids=selected_step_ids,
            requested_step_id=requested_step_id,
        )

    def _validate_steps(self, document, flows):
        steps = document.get("steps")
        if not isinstance(steps, list):
            raise ValueError("steps は配列で指定してください。")
        step_by_id = {}
        for index, step in enumerate(steps):
            if not isinstance(step, dict):
                raise ValueError(
                    f"steps[{index}] はオブジェクトで指定してください。"
                )
            if "output_variable" in step:
                raise ValueError(
                    f"steps[{index}].output_variableは202607形式では使用しません。"
                )
            step_id = self._require_id(
                step.get("step_id"),
                f"steps[{index}].step_id",
            )
            if step_id in step_by_id:
                raise ValueError(f"step_idが重複しています: {step_id}")
            flow_id = self._require_id(
                step.get("flow_id"),
                f"steps[{index}].flow_id",
            )
            if flow_id not in flows:
                raise ValueError(
                    f"steps[{index}].flow_idの参照先が存在しません。"
                )
            connector_id = _safe_text(step.get("connector_id"))
            action_id = _safe_text(step.get("action_id"))
            if not connector_id or not action_id:
                raise ValueError(
                    f"steps[{index}].connector_id／action_idは必須です。"
                )
            params = step.get("params")
            if params is None:
                params = {}
            if not isinstance(params, dict):
                raise ValueError(
                    f"steps[{index}].paramsはオブジェクトで指定してください。"
                )
            if "schema" in params:
                raise ValueError(
                    f"steps[{index}].params.schemaは202607形式では使用しません。"
                )
            action = self.catalog_service.get_action_definition(
                connector_id,
                action_id,
            )
            node_type = _safe_text(step.get("node_type")) or "task"
            if node_type != _safe_text(action.get("node_type")):
                raise ValueError(
                    f"steps[{index}].node_typeがcatalogと一致しません。"
                )
            self.catalog_service.validate_action_params(
                connector_id,
                action_id,
                params,
            )
            step_by_id[step_id] = step
        return step_by_id

    def _validate_all_flows(self, flows, step_by_id):
        for raw_flow_id, flow in flows.items():
            flow_id = self._require_id(raw_flow_id, "flowsのflow_id")
            if not isinstance(flow, dict):
                raise ValueError(
                    f"flows.{flow_id}はオブジェクトで指定してください。"
                )
            self._validate_terminal_node(flow, flow_id, "start")
            self._validate_terminal_node(flow, flow_id, "end")
            main_ids = {
                step_id
                for step_id, step in step_by_id.items()
                if _safe_text(step.get("flow_id")) == flow_id
                and not _safe_text(step.get("loop_owner_id"))
            }
            self._validate_graph(
                flow.get("edges"),
                allowed_ids=main_ids,
                graph_name=f"flows.{flow_id}",
                require_all=main_ids,
                allow_parallel=True,
            )

    def _validate_loops(self, document, step_by_id, flows):
        loop = document.get("loop")
        loop_flows = (
            loop.get("flows")
            if isinstance(loop, dict)
            else {}
        )
        if loop_flows is None:
            loop_flows = {}
        if not isinstance(loop_flows, dict):
            raise ValueError("loop.flowsはオブジェクトで指定してください。")

        child_ids_by_owner = {}
        for step_id, step in step_by_id.items():
            owner_id = _safe_text(step.get("loop_owner_id"))
            if not owner_id:
                continue
            owner = step_by_id.get(owner_id)
            if not owner or _safe_text(owner.get("node_type")) != "loop":
                raise ValueError(
                    f"loop_owner_idの参照先がloopではありません: {step_id}"
                )
            if _safe_text(owner.get("flow_id")) != _safe_text(
                step.get("flow_id")
            ):
                raise ValueError("loop ownerとchildのflow_idが一致しません。")
            child_ids_by_owner.setdefault(owner_id, set()).add(step_id)

        for owner_id, child_ids in child_ids_by_owner.items():
            owner_flow = loop_flows.get(owner_id)
            if not isinstance(owner_flow, dict):
                raise ValueError(
                    f"loop.flows.{owner_id}が存在しません。"
                )
            self._validate_graph(
                owner_flow.get("edges"),
                allowed_ids=child_ids,
                graph_name=f"loop.flows.{owner_id}",
                require_all=child_ids,
                allow_parallel=False,
            )
        extra_owner_ids = set(loop_flows) - set(child_ids_by_owner)
        if extra_owner_ids:
            raise ValueError(
                "loop.flowsに対応するchild stepがありません: "
                + ", ".join(sorted(extra_owner_ids))
            )

    def _validate_graph(
        self,
        edges,
        *,
        allowed_ids,
        graph_name,
        require_all,
        allow_parallel,
    ):
        if not isinstance(edges, list):
            raise ValueError(f"{graph_name}.edgesは配列で必須です。")
        allowed = set(allowed_ids) | {"START", "END"}
        adjacency = {node_id: [] for node_id in allowed}
        incoming = {node_id: 0 for node_id in allowed}
        seen = set()
        for index, edge in enumerate(edges):
            if not isinstance(edge, dict):
                raise ValueError(
                    f"{graph_name}.edges[{index}]はオブジェクトで指定してください。"
                )
            from_id = _safe_text(edge.get("from"))
            to_id = _safe_text(edge.get("to"))
            if (
                from_id not in allowed
                or to_id not in allowed
                or from_id == "END"
                or to_id == "START"
                or from_id == to_id
            ):
                raise ValueError(
                    f"{graph_name}.edges[{index}]の参照が不正です。"
                )
            edge_key = (from_id, to_id)
            if edge_key in seen:
                raise ValueError(
                    f"{graph_name}.edgesに重複edgeがあります。"
                )
            seen.add(edge_key)
            adjacency[from_id].append(to_id)
            incoming[to_id] += 1
        if not allow_parallel:
            if any(len(targets) > 1 for targets in adjacency.values()):
                raise ValueError("loop内部では並列分岐を使用できません。")
            if any(
                count > 1
                for node_id, count in incoming.items()
                if node_id != "END"
            ):
                raise ValueError("loop内部では合流を使用できません。")

        visited = set()
        visiting = set()

        def visit(node_id):
            if node_id in visiting:
                raise ValueError(f"{graph_name}.edgesに循環があります。")
            if node_id in visited:
                return
            visiting.add(node_id)
            for next_id in adjacency.get(node_id, []):
                visit(next_id)
            visiting.remove(node_id)
            visited.add(node_id)

        visit("START")
        missing = set(require_all) - visited
        if missing:
            raise ValueError(
                f"{graph_name}にSTARTから到達不能なstepがあります: "
                + ", ".join(sorted(missing))
            )
        if "END" not in visited:
            raise ValueError(f"{graph_name}のENDへ到達できません。")

    def _compile_step(self, step):
        compiled = copy.deepcopy(step)
        compiled["connector"] = _safe_text(compiled.get("connector_id"))
        compiled["action"] = _safe_text(compiled.get("action_id"))
        compiled["output_variable"] = _safe_text(compiled.get("step_id"))
        params = copy.deepcopy(compiled.get("params") or {})
        schema = compiled.get("schema")
        if isinstance(schema, dict) and isinstance(
            schema.get("columns"),
            list,
        ):
            params["schema"] = copy.deepcopy(schema["columns"])
        compiled["params"] = params
        return compiled

    def _validate_terminal_node(self, flow, flow_id, key):
        terminal = flow.get(key)
        if not isinstance(terminal, dict):
            raise ValueError(f"flows.{flow_id}.{key}は必須です。")
        position = terminal.get("ui_position")
        if not isinstance(position, dict):
            raise ValueError(
                f"flows.{flow_id}.{key}.ui_positionは必須です。"
            )

    def _validate_unassigned(self, unassigned):
        if not isinstance(unassigned, dict):
            return
        if unassigned.get("step_ids"):
            raise ValueError(
                "未所属stepがあるdocumentは実行できません。"
            )

    def _require_id(self, value, field_name):
        text = _safe_text(value)
        if CANONICAL_ID_PATTERN.fullmatch(text) is None:
            raise ValueError(
                f"{field_name}は正規化済み10進IDで指定してください。"
            )
        return text
