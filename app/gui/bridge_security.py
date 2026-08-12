import re
from dataclasses import dataclass
from pathlib import PurePosixPath, PureWindowsPath
from urllib.parse import urlsplit

from app.services.errors import ApplicationServiceError


READ = "read"
READ_PATH = "read_path"
WRITE = "write"
EXECUTE = "execute"
HOST = "host"
SECURITY_PROFILES = frozenset({READ, READ_PATH, WRITE, EXECUTE, HOST})


@dataclass(frozen=True)
class FieldRule:
    types: tuple
    required: bool = False
    allow_none: bool = False
    non_empty: bool = False
    enum: frozenset | None = None
    pattern: str | None = None
    max_length: int | None = None


@dataclass(frozen=True)
class CommandSecurityRule:
    profile: str
    fields: dict


def _field(
    *types,
    required=False,
    allow_none=False,
    non_empty=False,
    enum=None,
    pattern=None,
    max_length=None,
):
    return FieldRule(
        types=tuple(types),
        required=required,
        allow_none=allow_none,
        non_empty=non_empty,
        enum=frozenset(enum) if enum is not None else None,
        pattern=pattern,
        max_length=max_length,
    )


def _rule(profile, **fields):
    return CommandSecurityRule(profile=profile, fields=fields)


STRING = _field(str, max_length=4096)
OPTIONAL_STRING = _field(str, allow_none=True, max_length=4096)
NON_EMPTY_STRING = _field(str, required=True, non_empty=True, max_length=4096)
WORKSPACE_SCOPE = _field(str, enum={"root", "workspace", "config"}, max_length=16)
MODE = _field(str, enum={"dataflow"}, max_length=32)


DEFAULT_COMMAND_RULES = {
    "app.getStatus": _rule(READ),
    "app.logUiEvent": _rule(
        WRITE,
        action=_field(str, max_length=128),
        source=_field(str, max_length=128),
        elapsed_ms=_field(int, float),
        detail=_field(dict),
    ),
    "app.windowControl": _rule(
        HOST,
        action=_field(
            str,
            required=True,
            enum={"minimize", "maximize", "close", "drag"},
            max_length=16,
        ),
    ),
    "mouse.coordinateCapture.start": _rule(
        HOST,
        capture_id=_field(str, required=True, non_empty=True, max_length=128),
    ),
    "app.openExternal": _rule(
        HOST,
        url=_field(str, required=True, non_empty=True, max_length=4096),
        prefer=_field(str, enum={"chrome", "default", "default-browser"}, max_length=32),
    ),
    "app.googleAuthLogin": _rule(
        EXECUTE,
        mode=_field(str, enum={"application-default"}, max_length=32),
    ),
    "app.googleAuthStatus": _rule(
        READ,
        mode=_field(str, enum={"application-default"}, max_length=32),
    ),
    "app.getSuggestIndex": _rule(
        READ,
        connector=_field(
            str,
            required=True,
            non_empty=True,
            pattern=r"[A-Za-z0-9_]+",
            max_length=128,
        ),
    ),
    "documents.list": _rule(
        READ,
        scope=_field(str, enum={"local", "workspace"}, max_length=16),
        kind=_field(str, enum={"recent", "template"}, max_length=16),
    ),
    "documents.load": _rule(
        READ_PATH,
        doc_session_id=_field(str, required=True, non_empty=True, max_length=128),
        document_token=OPTIONAL_STRING,
        scope=WORKSPACE_SCOPE,
        rel_path=STRING,
    ),
    "documents.save": _rule(
        WRITE,
        doc_session_id=_field(str, required=True, non_empty=True, max_length=128),
        mode=MODE,
        document_ref=OPTIONAL_STRING,
        document=_field(dict, required=True),
        scope=WORKSPACE_SCOPE,
        rel_path=STRING,
        file_name=_field(str, max_length=255),
    ),
    "run.start": _rule(
        EXECUTE,
        doc_session_id=_field(
            str,
            required=True,
            non_empty=True,
            max_length=128,
        ),
        run_kind=_field(str, enum={"standalone"}, max_length=32),
        mode=MODE,
        document_ref=OPTIONAL_STRING,
        flow_id=_field(str, max_length=32),
        document=_field(dict),
        step_id=_field(str, max_length=32),
        connector_id=_field(str, max_length=128),
        action_id=_field(str, max_length=128),
        result_mode=_field(
            str,
            enum={"preview", "excel", "metadata", "text"},
            max_length=32,
        ),
        dry_run=_field(bool),
        params=_field(dict),
        result_export=_field(dict),
    ),
    "documents.close": _rule(
        WRITE,
        doc_session_id=_field(str, required=True, non_empty=True, max_length=128),
    ),
    "run.cancel": _rule(
        WRITE,
        run_id=_field(str, required=True, non_empty=True, max_length=128),
    ),
    "result.getSummary": _rule(
        READ,
        run_id=_field(str, required=True, non_empty=True, max_length=128),
    ),
    "result.getSchema": _rule(
        READ,
        run_id=_field(str, required=True, non_empty=True, max_length=128),
        step_id=_field(str, required=True, non_empty=True, max_length=128),
    ),
    "result.getPreview": _rule(
        READ,
        run_id=_field(str, required=True, non_empty=True, max_length=128),
        step_id=_field(str, required=True, non_empty=True, max_length=128),
    ),
    "result.getLogs": _rule(
        READ,
        run_id=_field(str, required=True, non_empty=True, max_length=128),
        before_seq=_field(int),
        after_seq=_field(int),
    ),
    "result.invalidateSteps": _rule(
        WRITE,
        doc_session_id=_field(
            str,
            required=True,
            non_empty=True,
            max_length=128,
        ),
        step_ids=_field(list, required=True),
    ),
    "file.pickFile": _rule(
        HOST,
        workspace_tab_id=_field(str, required=True, non_empty=True, max_length=128),
        title=_field(str, max_length=256),
        filters=_field(list),
        current_ref=OPTIONAL_STRING,
        current_value=OPTIONAL_STRING,
        step_name=_field(str, max_length=128),
        field_key=_field(str, max_length=128),
    ),
    "file.pickFolder": _rule(
        HOST,
        workspace_tab_id=_field(str, required=True, non_empty=True, max_length=128),
        title=_field(str, max_length=256),
        current_ref=OPTIONAL_STRING,
        current_value=OPTIONAL_STRING,
        step_name=_field(str, max_length=128),
        field_key=_field(str, max_length=128),
    ),
    "workspace.pickRoot": _rule(
        HOST,
        title=_field(str, max_length=256),
        current_value=OPTIONAL_STRING,
    ),
    "workspace.getRoot": _rule(READ),
    "workspace.setRoot": _rule(
        WRITE,
        root_path=_field(str, required=True, max_length=32768),
    ),
    "workspace.list": _rule(
        READ_PATH,
        scope=WORKSPACE_SCOPE,
        rel_path=STRING,
    ),
    "workspace.stat": _rule(
        READ_PATH,
        scope=WORKSPACE_SCOPE,
        rel_path=NON_EMPTY_STRING,
    ),
    "workspace.readText": _rule(
        READ_PATH,
        scope=WORKSPACE_SCOPE,
        rel_path=NON_EMPTY_STRING,
    ),
    "workspace.writeText": _rule(
        WRITE,
        scope=WORKSPACE_SCOPE,
        rel_path=NON_EMPTY_STRING,
        content=_field(str, required=True, max_length=8 * 1024 * 1024),
        force=_field(bool),
        expected_mtime_ns=_field(str, int, allow_none=True, max_length=64),
    ),
    "workspace.mkdir": _rule(
        WRITE,
        scope=WORKSPACE_SCOPE,
        rel_path=NON_EMPTY_STRING,
    ),
    "workspace.delete": _rule(
        WRITE,
        scope=WORKSPACE_SCOPE,
        rel_path=NON_EMPTY_STRING,
        recursive=_field(bool),
    ),
    "preview.readExcel": _rule(
        READ_PATH,
        workspace_tab_id=_field(str, required=True, non_empty=True, max_length=128),
        field_key=_field(str, max_length=128),
        current_ref=OPTIONAL_STRING,
        current_value=OPTIONAL_STRING,
        sheet_name=_field(str, max_length=255),
    ),
    "preview.readCsv": _rule(
        READ_PATH,
        workspace_tab_id=_field(str, required=True, non_empty=True, max_length=128),
        field_key=_field(str, max_length=128),
        current_ref=OPTIONAL_STRING,
        current_value=OPTIONAL_STRING,
        encoding=_field(str, pattern=r"[A-Za-z0-9_.-]+", max_length=64),
        delimiter=_field(str, max_length=4),
    ),
    "catalog.getConnectors": _rule(READ),
    "catalog.getActions": _rule(READ),
    "catalog.getForms": _rule(READ),
    "catalog.getDataAreaPolicy": _rule(READ),
    "catalog.getSecurityPolicySummary": _rule(READ),
}


def is_safe_external_url(value):
    text = str(value or "").strip()
    if not text or any(ord(char) < 32 for char in text):
        return False
    try:
        parsed = urlsplit(text)
    except ValueError:
        return False
    if parsed.scheme.lower() not in {"http", "https"}:
        return False
    if not parsed.hostname or parsed.username or parsed.password:
        return False
    return True


def _is_absolute_path(value):
    text = str(value or "").strip()
    return PureWindowsPath(text).is_absolute() or PurePosixPath(text).is_absolute()


def _validate_relative_path(value):
    text = str(value or "").replace("\\", "/").strip()
    if not text:
        return
    if "\x00" in text or _is_absolute_path(text):
        raise ValueError("rel_path は相対パスで指定してください。")
    if ".." in PurePosixPath(text).parts:
        raise ValueError("rel_path に親フォルダ参照は指定できません。")


class BridgeSecurityPolicy:
    def __init__(self, *, command_rules=None, capabilities=None):
        self._rules = dict(command_rules or DEFAULT_COMMAND_RULES)
        self._capabilities = frozenset(str(item) for item in (capabilities or ()))

    @property
    def command_profiles(self):
        return {
            command_type: rule.profile
            for command_type, rule in self._rules.items()
        }

    def validate(self, command_type, payload):
        command = str(command_type or "").strip()
        rule = self._rules.get(command)
        if rule is None:
            raise ApplicationServiceError(
                "E_ACCESS_DENIED",
                "security profileが未定義のcommandです。",
            )
        self._validate_payload(rule, payload)
        self._validate_command(command, payload)
        return rule.profile

    def _validate_payload(self, rule, payload):
        if not isinstance(payload, dict):
            raise ValueError("command payload はオブジェクトで指定してください。")
        unknown_fields = sorted(set(payload) - set(rule.fields))
        if unknown_fields:
            raise ValueError(f"未知のpayload fieldです: {', '.join(unknown_fields)}")

        for name, field_rule in rule.fields.items():
            if field_rule.required and name not in payload:
                raise ValueError(f"{name} は必須です。")
            if name not in payload:
                continue
            value = payload[name]
            if value is None and field_rule.allow_none:
                continue
            if not self._matches_types(value, field_rule.types):
                expected = " / ".join(item.__name__ for item in field_rule.types)
                raise ValueError(f"{name} は {expected} で指定してください。")
            if isinstance(value, str):
                if "\x00" in value:
                    raise ValueError(f"{name} にNUL文字は指定できません。")
                if field_rule.non_empty and not value.strip():
                    raise ValueError(f"{name} は空文字にできません。")
                if field_rule.max_length is not None and len(value) > field_rule.max_length:
                    raise ValueError(f"{name} が長すぎます。")
                if field_rule.pattern and re.fullmatch(field_rule.pattern, value) is None:
                    raise ValueError(f"{name} の形式が不正です。")
            if field_rule.enum is not None and value not in field_rule.enum:
                raise ValueError(f"{name} の値が不正です。")

    def _matches_types(self, value, expected_types):
        if not expected_types:
            return True
        if isinstance(value, bool):
            return bool in expected_types
        return isinstance(value, expected_types)

    def _validate_command(self, command, payload):
        capability = {
            "app.windowControl": "window_control",
            "mouse.coordinateCapture.start": "coordinate_capture",
            "file.pickFile": "file_picker",
            "file.pickFolder": "folder_picker",
            "workspace.pickRoot": "folder_picker",
            "app.openExternal": "external_open",
        }.get(command)
        if capability and capability not in self._capabilities:
            raise ApplicationServiceError(
                "E_NOT_READY",
                "必要なhost capabilityが利用できません。",
            )

        if command == "documents.load":
            has_token = bool(str(payload.get("document_token") or "").strip())
            has_scope = bool(str(payload.get("scope") or "").strip())
            has_rel_path = bool(str(payload.get("rel_path") or "").strip())
            if has_scope != has_rel_path:
                raise ValueError("scope と rel_path は組で指定してください。")
            if has_token and has_scope:
                raise ValueError(
                    "document_token と scope／rel_path は同時に指定できません。"
                )
            has_location = has_token or (has_scope and has_rel_path)
            if not has_location and "open_flow_dialog" not in self._capabilities:
                raise ApplicationServiceError(
                    "E_NOT_READY",
                    "document open dialogが利用できません。",
                )

        if command == "documents.save":
            has_scope = bool(str(payload.get("scope") or "").strip())
            has_rel_path = bool(str(payload.get("rel_path") or "").strip())
            if has_scope != has_rel_path:
                raise ValueError("scope と rel_path は組で指定してください。")

        if command == "app.openExternal" and not is_safe_external_url(payload.get("url")):
            raise ValueError("url は認証情報を含まない http/https URLで指定してください。")

        if command in {
            "documents.load",
            "documents.save",
            "workspace.list",
            "workspace.stat",
            "workspace.readText",
            "workspace.writeText",
            "workspace.mkdir",
            "workspace.delete",
        } and "rel_path" in payload:
            _validate_relative_path(payload.get("rel_path"))

        if command == "workspace.setRoot":
            root_path = str(payload.get("root_path") or "").strip()
            if root_path and not _is_absolute_path(root_path):
                raise ValueError("root_path は絶対パスで指定してください。")

        if command == "file.pickFile":
            self._validate_filters(payload.get("filters"))

        if command in {"preview.readExcel", "preview.readCsv"}:
            if not str(payload.get("current_ref") or payload.get("current_value") or "").strip():
                raise ValueError("current_ref または current_value は必須です。")

        if command == "preview.readCsv":
            delimiter = str(payload.get("delimiter") or ",")
            if delimiter not in {"\\t", "tab"} and len(delimiter) != 1:
                raise ValueError("delimiter は1文字またはtabで指定してください。")

        if command == "result.getLogs":
            if "before_seq" in payload and "after_seq" in payload:
                raise ValueError(
                    "before_seq と after_seq は同時に指定できません。"
                )
            for field_name in ("before_seq", "after_seq"):
                if field_name in payload and payload[field_name] < 1:
                    raise ValueError(
                        f"{field_name} は1以上で指定してください。"
                    )

        if command == "documents.save":
            self._validate_flow(payload.get("document"))

        if command == "run.start":
            self._validate_run_start(payload)

    def _validate_run_start(self, payload):
        if payload.get("run_kind") == "standalone":
            required = (
                "connector_id",
                "action_id",
                "result_mode",
                "params",
            )
            missing = [
                field
                for field in required
                if field not in payload
                or (
                    isinstance(payload.get(field), str)
                    and not payload[field].strip()
                )
            ]
            if missing:
                raise ValueError(
                    "standalone runの必須fieldが不足しています: "
                    + ", ".join(missing)
                )
            forbidden = {
                "document_ref",
                "flow_id",
                "document",
                "step_id",
                "mode",
            } & set(payload)
            if forbidden:
                raise ValueError(
                    "standalone runにworkflow fieldは指定できません。"
                )
            return

        required = ("flow_id", "document")
        missing = [
            field
            for field in required
            if field not in payload
            or (
                isinstance(payload.get(field), str)
                and not payload[field].strip()
            )
        ]
        if missing:
            raise ValueError(
                "workflow runの必須fieldが不足しています: "
                + ", ".join(missing)
            )
        forbidden = {
            "connector_id",
            "action_id",
            "result_mode",
            "dry_run",
            "params",
            "result_export",
        } & set(payload)
        if forbidden:
            raise ValueError(
                "workflow runにstandalone fieldは指定できません。"
            )
        document = payload.get("document")
        if not isinstance(document, dict):
            raise ValueError("documentはオブジェクトで指定してください。")
        flows = document.get("flows")
        if not isinstance(flows, dict) or "edges" in flows:
            raise ValueError(
                "document.flowsはflow_id mappingで指定してください。"
            )
        self._validate_flow(document)

    def _validate_filters(self, filters):
        if filters is None:
            return
        if len(filters) > 32:
            raise ValueError("filters の件数が上限を超えています。")
        for item in filters:
            if not isinstance(item, dict):
                raise ValueError("filters の各要素はオブジェクトで指定してください。")
            unknown = set(item) - {"label", "patterns"}
            if unknown:
                raise ValueError("filters に未知のfieldがあります。")
            patterns = item.get("patterns", [])
            if patterns is None:
                patterns = []
            if not isinstance(patterns, list) or len(patterns) > 32:
                raise ValueError("filters.patterns は配列で指定してください。")
            if any(not isinstance(pattern, str) or len(pattern) > 128 for pattern in patterns):
                raise ValueError("filters.patterns の形式が不正です。")

    def _validate_flow(self, flow):
        if not isinstance(flow, dict):
            raise ValueError("flow はオブジェクトで指定してください。")
        steps = flow.get("steps", [])
        if steps is None:
            steps = []
        if not isinstance(steps, list):
            raise ValueError("flow.steps は配列で指定してください。")
        if len(steps) > 10000:
            raise ValueError("flow.steps の件数が上限を超えています。")
        for index, step in enumerate(steps):
            if not isinstance(step, dict):
                raise ValueError(f"flow.steps[{index}] はオブジェクトで指定してください。")
            step_id = str(step.get("step_id") or "").strip()
            connector = str(step.get("connector") or step.get("connector_id") or "").strip()
            action = str(step.get("action") or step.get("action_id") or "").strip()
            params = step.get("params", {})
            if params is None:
                params = {}
            if not step_id or not connector or not action:
                raise ValueError(f"flow.steps[{index}] のstep_id／connector／actionは必須です。")
            if re.fullmatch(r"[A-Za-z0-9_]+", connector) is None:
                raise ValueError(f"flow.steps[{index}].connector の形式が不正です。")
            if re.fullmatch(r"[A-Za-z0-9_]+", action) is None:
                raise ValueError(f"flow.steps[{index}].action の形式が不正です。")
            if not isinstance(params, dict):
                raise ValueError(f"flow.steps[{index}].params はオブジェクトで指定してください。")
