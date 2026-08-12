import copy
import re
from pathlib import Path

import yaml

from app.services.catalog_types import (
    CatalogSnapshot,
    CatalogValidationError,
    freeze_catalog_value,
)


_CONNECTOR_CATEGORIES = {"data", "workflow"}
_ACTION_SUBCATEGORIES = {
    "data": {"input", "transform", "output"},
    "workflow": {"static", "dynamic", "control"},
}
_RESULT_KINDS = {"data_body", "execution_metadata"}
_JOB_ID_KINDS = {"none", "bigquery_job_id", "web_session_id"}
_NODE_TYPES = {"task", "loop"}
_SECURITY_RISKS = {"read", "read_path", "write", "execute", "host"}
_SENSITIVE_FIELD_PATTERN = re.compile(
    r"(^|_)(password|secret|token|api_key|private_key|credential|credentials)($|_)",
    re.IGNORECASE,
)


class CatalogLoader:
    def __init__(self, catalog_root=None):
        default_root = Path(__file__).resolve().parents[2] / "config" / "catalog"
        self.catalog_root = Path(catalog_root or default_root).resolve()

    def load(self):
        return self._load_snapshot()

    def _load_snapshot(self):
        app_modes_doc = self._load_yaml("app_modes.yaml")
        connectors_doc = self._load_yaml("connectors.yaml")
        actions_doc = self._load_yaml("actions.yaml")
        data_area_doc = self._load_yaml("data_area_policy.yaml")
        security_doc = self._load_yaml("security_profiles.yaml")
        form_docs = self._load_forms()

        version = self._positive_int(
            app_modes_doc.get("version", 1),
            "app_modes.yaml",
            "version",
        )
        app_modes = self._normalize_modes(app_modes_doc.get("app_modes"))
        connectors = self._normalize_connectors(connectors_doc.get("connectors"))
        actions = self._normalize_actions(actions_doc.get("actions"))
        forms = self._normalize_forms(form_docs)
        policies, metadata_columns = self._normalize_data_area_policies(data_area_doc)
        profiles = self._normalize_security_profiles(security_doc.get("profiles"))

        connector_index = self._index_unique(connectors, "connector_id", "connectors.yaml")
        action_index = {}
        for action in actions:
            action_key = (action["connector_id"], action["action_id"])
            if action_key in action_index:
                self._error("actions.yaml", f"actions.{action_key}", "action IDが重複しています。")
            action_index[action_key] = action
        form_index = self._index_unique(forms, "form_schema_id", "forms")
        policy_index = self._index_unique(
            policies,
            "data_area_policy_id",
            "data_area_policy.yaml",
        )
        profile_index = self._index_unique(
            profiles,
            "security_profile_id",
            "security_profiles.yaml",
        )

        connector_aliases = {}
        for connector in connectors:
            for alias in (connector["connector_id"], connector["export_id"]):
                if alias in connector_aliases:
                    self._error("connectors.yaml", alias, "connector aliasが重複しています。")
                connector_aliases[alias] = connector

        actions_by_connector = {connector["connector_id"]: [] for connector in connectors}
        for index, action in enumerate(actions):
            connector_id = action["connector_id"]
            if connector_id not in connector_index:
                self._error(
                    "actions.yaml",
                    f"actions[{index}].connector_id",
                    "参照先connectorが存在しません。",
                )
            connector = connector_index[connector_id]
            if action["category"] != connector["category"]:
                self._error(
                    "actions.yaml",
                    f"actions[{index}].category",
                    "connector categoryと一致しません。",
                )
            if action["form_schema_id"] not in form_index:
                self._error(
                    "actions.yaml",
                    f"actions[{index}].form_schema_id",
                    "参照先form schemaが存在しません。",
                )
            if action["data_area_policy_id"] not in policy_index:
                self._error(
                    "actions.yaml",
                    f"actions[{index}].data_area_policy_id",
                    "参照先data area policyが存在しません。",
                )
            if action["security_profile_id"] not in profile_index:
                self._error(
                    "actions.yaml",
                    f"actions[{index}].security_profile_id",
                    "参照先security profileが存在しません。",
                )
            self._validate_result_contract(action, index)
            self._validate_standalone_document(
                action,
                form_index[action["form_schema_id"]],
                index,
            )
            actions_by_connector[connector_id].append(action["action_id"])

        action_form_ids = {action["form_schema_id"] for action in actions}
        orphan_forms = sorted(set(form_index) - action_form_ids)
        if orphan_forms:
            self._error("forms", "form_schema_id", f"未参照formがあります: {', '.join(orphan_forms)}")

        normalized_connectors = []
        for connector in connectors:
            normalized = dict(connector)
            normalized["actions"] = actions_by_connector[connector["connector_id"]]
            normalized_connectors.append(normalized)

        for mode_index, mode in enumerate(app_modes):
            for connector_id in mode["connector_ids"]:
                if connector_id not in connector_index:
                    self._error(
                        "app_modes.yaml",
                        f"app_modes[{mode_index}].connector_ids",
                        f"参照先connectorが存在しません: {connector_id}",
                    )
            defaults = mode["node_defaults"]
            self._validate_default_action(
                defaults["initial_connector_id"],
                defaults["initial_action_id"],
                action_index,
                f"app_modes[{mode_index}].node_defaults.initial",
            )
            self._validate_default_action(
                defaults["preferred_connector_id"],
                defaults["preferred_action_id"],
                action_index,
                f"app_modes[{mode_index}].node_defaults.preferred",
            )
            self._validate_default_action(
                defaults["loop_connector_id"],
                defaults["loop_action_id"],
                action_index,
                f"app_modes[{mode_index}].node_defaults.loop",
            )

        alias_action_index = {}
        for connector_alias, connector in connector_aliases.items():
            connector_id = connector["connector_id"]
            for action_id in actions_by_connector[connector_id]:
                alias_action_index[(connector_alias, action_id)] = action_index[
                    (connector_id, action_id)
                ]

        return CatalogSnapshot(
            version=version,
            app_modes=freeze_catalog_value(app_modes),
            connectors=freeze_catalog_value(normalized_connectors),
            actions=freeze_catalog_value(actions),
            forms=freeze_catalog_value(forms),
            data_area_policies=freeze_catalog_value(policies),
            execution_metadata_columns=tuple(metadata_columns),
            security_profiles=freeze_catalog_value(profiles),
            connector_index=freeze_catalog_value(connector_aliases),
            action_index=freeze_catalog_value(alias_action_index),
            form_index=freeze_catalog_value(form_index),
            data_area_policy_index=freeze_catalog_value(policy_index),
            security_profile_index=freeze_catalog_value(profile_index),
        )

    def _load_yaml(self, file_name):
        path = self.catalog_root / file_name
        if not path.is_file():
            raise FileNotFoundError(f"catalog定義fileが見つかりません: {path}")
        try:
            loaded = yaml.safe_load(path.read_text(encoding="utf-8"))
        except yaml.YAMLError as error:
            raise CatalogValidationError(path.name, "$", f"YAML parse error: {error}") from error
        if not isinstance(loaded, dict):
            self._error(path.name, "$", "rootはmappingで指定してください。")
        return loaded

    def _load_forms(self):
        forms_root = self.catalog_root / "forms"
        if not forms_root.is_dir():
            raise FileNotFoundError(f"catalog form directoryが見つかりません: {forms_root}")
        forms = []
        for path in sorted(forms_root.glob("*.yaml")):
            loaded = self._load_yaml(str(Path("forms") / path.name))
            if "forms" in loaded:
                entries = loaded["forms"]
                if not isinstance(entries, list):
                    self._error(path.name, "forms", "配列で指定してください。")
                forms.extend(entries)
            else:
                forms.append(loaded)
        if not forms:
            self._error("forms", "$", "form schemaが1件もありません。")
        return forms

    def _normalize_modes(self, values):
        items = self._require_list(values, "app_modes.yaml", "app_modes")
        normalized = []
        for index, item in enumerate(items):
            source = f"app_modes[{index}]"
            mapping = self._require_mapping(item, "app_modes.yaml", source)
            defaults = self._require_mapping(
                mapping.get("node_defaults"),
                "app_modes.yaml",
                f"{source}.node_defaults",
            )
            normalized.append({
                "mode_id": self._required_text(mapping, "mode_id", "app_modes.yaml", source),
                "label": self._required_text(mapping, "label", "app_modes.yaml", source),
                "default_flow_name": self._required_text(
                    mapping,
                    "default_flow_name",
                    "app_modes.yaml",
                    source,
                ),
                "file_extension": self._required_text(
                    mapping,
                    "file_extension",
                    "app_modes.yaml",
                    source,
                ),
                "node_defaults": {
                    key: self._required_text(defaults, key, "app_modes.yaml", f"{source}.node_defaults")
                    for key in (
                        "initial_connector_id",
                        "initial_action_id",
                        "preferred_connector_id",
                        "preferred_action_id",
                        "loop_connector_id",
                        "loop_action_id",
                    )
                },
                "connector_ids": self._text_list(
                    mapping.get("connector_ids"),
                    "app_modes.yaml",
                    f"{source}.connector_ids",
                ),
            })
        self._index_unique(normalized, "mode_id", "app_modes.yaml")
        return normalized

    def _normalize_connectors(self, values):
        items = self._require_list(values, "connectors.yaml", "connectors")
        normalized = []
        for index, item in enumerate(items):
            source = f"connectors[{index}]"
            mapping = self._require_mapping(item, "connectors.yaml", source)
            category = self._required_text(mapping, "category", "connectors.yaml", source)
            if category not in _CONNECTOR_CATEGORIES:
                self._error("connectors.yaml", f"{source}.category", "dataまたはworkflowを指定してください。")
            connector = {
                "connector_id": self._required_text(mapping, "connector_id", "connectors.yaml", source),
                "label": self._required_text(mapping, "label", "connectors.yaml", source),
                "export_id": self._required_text(mapping, "export_id", "connectors.yaml", source),
                "category": category,
                "icon": str(mapping.get("icon") or ""),
            }
            normalized.append(connector)
        return normalized

    def _normalize_actions(self, values):
        items = self._require_list(values, "actions.yaml", "actions")
        normalized = []
        for index, item in enumerate(items):
            source = f"actions[{index}]"
            mapping = self._require_mapping(item, "actions.yaml", source)
            category = self._required_text(mapping, "category", "actions.yaml", source)
            subcategory = self._required_text(mapping, "subcategory", "actions.yaml", source)
            if category not in _CONNECTOR_CATEGORIES:
                self._error("actions.yaml", f"{source}.category", "dataまたはworkflowを指定してください。")
            if subcategory not in _ACTION_SUBCATEGORIES[category]:
                self._error(
                    "actions.yaml",
                    f"{source}.subcategory",
                    f"{category} connectorで使用できないsubcategoryです。",
                )
            node_type = str(mapping.get("node_type") or "task")
            if node_type not in _NODE_TYPES:
                self._error("actions.yaml", f"{source}.node_type", "taskまたはloopを指定してください。")
            contract = self._require_mapping(
                mapping.get("result_contract"),
                "actions.yaml",
                f"{source}.result_contract",
            )
            action = {
                "action_id": self._required_text(mapping, "action_id", "actions.yaml", source),
                "connector_id": self._required_text(mapping, "connector_id", "actions.yaml", source),
                "label": self._required_text(mapping, "label", "actions.yaml", source),
                "category": category,
                "subcategory": subcategory,
                "node_type": node_type,
                "form_schema_id": self._required_text(
                    mapping,
                    "form_schema_id",
                    "actions.yaml",
                    source,
                ),
                "data_area_policy_id": self._required_text(
                    mapping,
                    "data_area_policy_id",
                    "actions.yaml",
                    source,
                ),
                "security_profile_id": self._required_text(
                    mapping,
                    "security_profile_id",
                    "actions.yaml",
                    source,
                ),
                "result_contract": dict(contract),
                "standalone_allowed": bool(mapping.get("standalone_allowed", False)),
                "standalone_result_modes": self._optional_text_list(
                    mapping.get("standalone_result_modes"),
                    "actions.yaml",
                    f"{source}.standalone_result_modes",
                ),
                "export_allowed": bool(mapping.get("export_allowed", False)),
                "standalone_export_modes": self._optional_text_list(
                    mapping.get("standalone_export_modes"),
                    "actions.yaml",
                    f"{source}.standalone_export_modes",
                ),
            }
            if "dry_run" in mapping:
                action["dry_run"] = dict(self._require_mapping(
                    mapping["dry_run"],
                    "actions.yaml",
                    f"{source}.dry_run",
                ))
            if "standalone_document" in mapping:
                action["standalone_document"] = (
                    self._normalize_standalone_document(
                        mapping["standalone_document"],
                        source,
                    )
                )
            if "detail_modal" in mapping:
                action["detail_modal"] = copy.deepcopy(self._require_mapping(
                    mapping["detail_modal"],
                    "actions.yaml",
                    f"{source}.detail_modal",
                ))
            normalized.append(action)
        return normalized

    def _normalize_forms(self, values):
        normalized = []
        for index, item in enumerate(values):
            source = f"forms[{index}]"
            mapping = self._require_mapping(item, "forms", source)
            form_schema_id = self._required_text(mapping, "form_schema_id", "forms", source)
            fields = self._require_list(mapping.get("fields"), "forms", f"{source}.fields")
            normalized_fields = []
            seen_keys = set()
            for field_index, field in enumerate(fields):
                field_path = f"{source}.fields[{field_index}]"
                field_mapping = copy.deepcopy(
                    self._require_mapping(field, "forms", field_path)
                )
                key = self._required_text(field_mapping, "key", "forms", field_path)
                if key in seen_keys:
                    self._error("forms", f"{field_path}.key", "field keyが重複しています。")
                seen_keys.add(key)
                self._required_text(field_mapping, "label", "forms", field_path)
                self._required_text(field_mapping, "kind", "forms", field_path)
                self._validate_secret_default(form_schema_id, field_mapping, field_path)
                normalized_fields.append(field_mapping)
            normalized.append({
                "form_schema_id": form_schema_id,
                "fields": normalized_fields,
            })
        return normalized

    def _normalize_standalone_document(self, value, source):
        field_path = f"{source}.standalone_document"
        mapping = self._require_mapping(
            value,
            "actions.yaml",
            field_path,
        )
        extensions = [
            item.lower().lstrip(".")
            for item in self._text_list(
                mapping.get("extensions"),
                "actions.yaml",
                f"{field_path}.extensions",
            )
        ]
        source_kind = self._required_text(
            mapping,
            "source_kind",
            "actions.yaml",
            field_path,
        )
        if source_kind not in {"editor_content", "saved_file", "none"}:
            self._error(
                "actions.yaml",
                f"{field_path}.source_kind",
                "editor_content、saved_file、noneのいずれかを指定してください。",
            )
        source_param = str(mapping.get("source_param") or "").strip()
        if source_kind == "none" and source_param:
            self._error(
                "actions.yaml",
                f"{field_path}.source_param",
                "source_kindがnoneの場合は指定できません。",
            )
        if source_kind != "none" and not source_param:
            self._error(
                "actions.yaml",
                f"{field_path}.source_param",
                "source_kindがnone以外の場合は必須です。",
            )
        return {
            "extensions": extensions,
            "source_kind": source_kind,
            "source_param": source_param,
        }

    def _validate_standalone_document(self, action, form, index):
        definition = action.get("standalone_document")
        if action.get("standalone_allowed") and not definition:
            self._error(
                "actions.yaml",
                f"actions[{index}].standalone_document",
                "standalone_allowed actionでは必須です。",
            )
        if not definition:
            return
        if not action.get("standalone_allowed"):
            self._error(
                "actions.yaml",
                f"actions[{index}].standalone_document",
                "standalone_allowedでないactionには指定できません。",
            )
        source_param = str(definition.get("source_param") or "")
        if not source_param:
            return
        form_keys = {
            str(field.get("exportKey") or field["key"])
            for field in form["fields"]
        }
        if source_param not in form_keys:
            self._error(
                "actions.yaml",
                f"actions[{index}].standalone_document.source_param",
                "参照先parameterがform schemaに存在しません。",
            )

    def _normalize_data_area_policies(self, document):
        items = self._require_list(
            document.get("policies"),
            "data_area_policy.yaml",
            "policies",
        )
        normalized = []
        for index, item in enumerate(items):
            source = f"policies[{index}]"
            mapping = self._require_mapping(item, "data_area_policy.yaml", source)
            normalized.append({
                "data_area_policy_id": self._required_text(
                    mapping,
                    "data_area_policy_id",
                    "data_area_policy.yaml",
                    source,
                ),
                "schema": self._required_text(mapping, "schema", "data_area_policy.yaml", source),
                "schema_json": self._required_text(
                    mapping,
                    "schema_json",
                    "data_area_policy.yaml",
                    source,
                ),
                "data_output": self._required_text(
                    mapping,
                    "data_output",
                    "data_area_policy.yaml",
                    source,
                ),
                "log": self._required_text(mapping, "log", "data_area_policy.yaml", source),
            })
        columns = self._text_list(
            document.get("execution_metadata_columns"),
            "data_area_policy.yaml",
            "execution_metadata_columns",
        )
        expected = ["job_id", "target", "path", "executed_at"]
        if columns != expected:
            self._error(
                "data_area_policy.yaml",
                "execution_metadata_columns",
                f"次の順序で指定してください: {', '.join(expected)}",
            )
        return normalized, columns

    def _normalize_security_profiles(self, values):
        items = self._require_list(values, "security_profiles.yaml", "profiles")
        normalized = []
        for index, item in enumerate(items):
            source = f"profiles[{index}]"
            mapping = self._require_mapping(item, "security_profiles.yaml", source)
            risk = self._required_text(mapping, "risk", "security_profiles.yaml", source)
            if risk not in _SECURITY_RISKS:
                self._error("security_profiles.yaml", f"{source}.risk", "未対応のriskです。")
            normalized.append({
                "security_profile_id": self._required_text(
                    mapping,
                    "security_profile_id",
                    "security_profiles.yaml",
                    source,
                ),
                "risk": risk,
                "validation": self._required_text(
                    mapping,
                    "validation",
                    "security_profiles.yaml",
                    source,
                ),
                "requires_confirmation": bool(mapping.get("requires_confirmation", False)),
            })
        return normalized

    def _validate_result_contract(self, action, index):
        contract = action["result_contract"]
        kind = str(contract.get("kind") or "")
        if kind not in _RESULT_KINDS:
            self._error(
                "actions.yaml",
                f"actions[{index}].result_contract.kind",
                "data_bodyまたはexecution_metadataを指定してください。",
            )
        job_id_kind = str(contract.get("job_id_kind") or "none")
        if job_id_kind not in _JOB_ID_KINDS:
            self._error(
                "actions.yaml",
                f"actions[{index}].result_contract.job_id_kind",
                "未対応のjob_id_kindです。",
            )
        contract["job_id_kind"] = job_id_kind
        expected_kind = (
            "data_body"
            if (
                action["category"] == "data"
                and action["subcategory"] in {"input", "transform"}
            ) or (
                action["category"] == "workflow"
                and action["subcategory"] == "static"
            )
            else "execution_metadata"
        )
        if kind != expected_kind and not str(contract.get("exception_reason") or "").strip():
            self._error(
                "actions.yaml",
                f"actions[{index}].result_contract.exception_reason",
                "通常contractと異なるactionには例外理由が必要です。",
            )

    def _validate_secret_default(self, form_schema_id, field, field_path):
        key = str(field.get("key") or "")
        kind = str(field.get("kind") or "")
        is_sensitive = bool(_SENSITIVE_FIELD_PATTERN.search(key)) or kind in {
            "password",
            "secret",
            "token",
        }
        if not is_sensitive or "default" not in field:
            return
        if not self._is_empty(field.get("default")):
            self._error(
                f"{form_schema_id}.yaml",
                f"{field_path}.default",
                "secret fieldにdefault値は設定できません。",
            )

    @staticmethod
    def _is_empty(value):
        return value is None or value == "" or value == [] or value == {}

    def _validate_default_action(self, connector_id, action_id, action_index, field_path):
        if (connector_id, action_id) not in action_index:
            self._error(
                "app_modes.yaml",
                field_path,
                f"参照先actionが存在しません: {connector_id}.{action_id}",
            )

    def _index_unique(self, values, key, source):
        index = {}
        for item_index, item in enumerate(values):
            value = item[key]
            if value in index:
                self._error(source, f"{key}[{item_index}]", f"{key}が重複しています: {value}")
            index[value] = item
        return index

    def _required_text(self, mapping, key, source, field_path):
        value = str(mapping.get(key) or "").strip()
        if not value:
            self._error(source, f"{field_path}.{key}", "必須です。")
        return value

    def _text_list(self, value, source, field_path):
        items = self._require_list(value, source, field_path)
        normalized = []
        for index, item in enumerate(items):
            text = str(item or "").strip()
            if not text:
                self._error(source, f"{field_path}[{index}]", "空文字は指定できません。")
            normalized.append(text)
        return normalized

    def _optional_text_list(self, value, source, field_path):
        if value is None:
            return []
        return self._text_list(value, source, field_path)

    def _positive_int(self, value, source, field_path):
        try:
            number = int(value)
        except (TypeError, ValueError) as error:
            raise CatalogValidationError(source, field_path, "整数で指定してください。") from error
        if number < 1:
            self._error(source, field_path, "1以上で指定してください。")
        return number

    def _require_list(self, value, source, field_path):
        if not isinstance(value, list):
            self._error(source, field_path, "配列で指定してください。")
        return value

    def _require_mapping(self, value, source, field_path):
        if not isinstance(value, dict):
            self._error(source, field_path, "mappingで指定してください。")
        return value

    @staticmethod
    def _error(source, field_path, message):
        raise CatalogValidationError(source, field_path, message)
