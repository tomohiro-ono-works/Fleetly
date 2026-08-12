from collections.abc import Mapping


class CatalogParameterValidator:
    def __init__(self, snapshot):
        self._snapshot = snapshot

    def validate(self, connector_id, action_id, params):
        action = self._resolve_action(connector_id, action_id)
        if not isinstance(params, dict):
            raise ValueError("params はオブジェクトで指定してください。")

        form = self._snapshot.form_index[action["form_schema_id"]]
        fields = form["fields"]
        effective_params = {
            str(field.get("exportKey") or field["key"]): field["default"]
            for field in fields
            if "default" in field
        }
        effective_params.update(params)
        known_keys = {
            str(field.get("exportKey") or field["key"])
            for field in fields
        }
        unknown_keys = sorted(str(key) for key in params if key not in known_keys)
        if unknown_keys:
            raise ValueError(
                f"{connector_id}.{action_id} に未定義のparameterがあります: "
                + ", ".join(unknown_keys)
            )

        for field in fields:
            if not self._is_field_visible(field, effective_params):
                continue
            key = str(field.get("exportKey") or field["key"])
            value = params.get(key)
            has_default = "default" in field
            if field.get("required") and not has_default and self._is_empty(value):
                raise ValueError(f"{connector_id}.{action_id}.{key} は必須です。")
            if key not in params or self._is_empty(value):
                continue
            self._validate_value(connector_id, action_id, field, value)
        return action

    def _resolve_action(self, connector_id, action_id):
        key = (str(connector_id or "").strip(), str(action_id or "").strip())
        action = self._snapshot.action_index.get(key)
        if action is None:
            raise ValueError(f"catalogに未定義のconnector/actionです: {key[0]}.{key[1]}")
        return action

    def _validate_value(self, connector_id, action_id, field, value):
        kind = str(field.get("kind") or "")
        key = str(field.get("exportKey") or field["key"])
        if isinstance(value, str) and "{{" in value and "}}" in value:
            return
        if kind == "number":
            try:
                number = float(value)
            except (TypeError, ValueError) as error:
                raise ValueError(f"{connector_id}.{action_id}.{key} は数値で指定してください。") from error
            if "min" in field and number < float(field["min"]):
                raise ValueError(f"{connector_id}.{action_id}.{key} が最小値未満です。")
            if "max" in field and number > float(field["max"]):
                raise ValueError(f"{connector_id}.{action_id}.{key} が最大値を超えています。")
        elif kind == "checkbox":
            if not isinstance(value, bool) and str(value).lower() not in {
                "true",
                "false",
                "1",
                "0",
                "yes",
                "no",
                "on",
                "off",
            }:
                raise ValueError(f"{connector_id}.{action_id}.{key} はbooleanで指定してください。")
        elif kind == "checklist" and not isinstance(value, (list, tuple, str)):
            raise ValueError(f"{connector_id}.{action_id}.{key} は配列で指定してください。")

        options = field.get("options")
        if not isinstance(options, (list, tuple)) or kind != "combo":
            return
        allowed = {
            option.get("value") if isinstance(option, Mapping) else option
            for option in options
        }
        if value not in allowed and not bool(field.get("allowCustom", False)):
            raise ValueError(f"{connector_id}.{action_id}.{key} は定義済みoptionから選択してください。")

    @staticmethod
    def _is_field_visible(field, params):
        condition = field.get("visible_if")
        if not isinstance(condition, Mapping):
            return True
        source_value = params.get(condition.get("key"))
        if "equals" in condition:
            return source_value == condition["equals"]
        if "in" in condition and isinstance(condition["in"], (list, tuple)):
            return source_value in condition["in"]
        return True

    @staticmethod
    def _is_empty(value):
        return value is None or value == "" or value == [] or value == {}
