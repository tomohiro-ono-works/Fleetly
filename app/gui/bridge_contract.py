import json
import re
from dataclasses import dataclass
from datetime import datetime, timezone


PROTOCOL_VERSION = "1"
COMMAND_FIELDS = {"v", "kind", "id", "type", "ts", "payload"}
MAX_COMMAND_BYTES = 8 * 1024 * 1024
MESSAGE_ID_PATTERN = re.compile(r"[A-Za-z0-9_.:-]{1,128}")
MESSAGE_TYPE_PATTERN = re.compile(r"[A-Za-z][A-Za-z0-9_.-]{0,127}")


def _iso_now():
    return datetime.now(timezone.utc).isoformat()


def _safe_text(value):
    return str(value or "").strip()


@dataclass(frozen=True)
class CommandEnvelope:
    version: str
    message_id: str
    message_type: str
    timestamp: str
    payload: dict


class ContractValidationError(Exception):
    def __init__(self, code, message, *, message_id=None, message_type="unknown"):
        super().__init__(str(message or ""))
        self.code = str(code or "E_VALIDATION")
        self.message = str(message or "")
        self.message_id = _safe_text(message_id) or None
        self.message_type = _safe_text(message_type) or "unknown"


def peek_command_identity(raw_text):
    try:
        message = json.loads(str(raw_text or ""))
    except Exception:
        return None, "unknown"
    if not isinstance(message, dict):
        return None, "unknown"
    return (
        _safe_text(message.get("id")) or None,
        _safe_text(message.get("type")) or "unknown",
    )


def parse_command(raw_text, *, protocol_version=PROTOCOL_VERSION):
    raw_message = str(raw_text or "")
    message_id, message_type = peek_command_identity(raw_text)
    if len(raw_message.encode("utf-8", errors="replace")) > MAX_COMMAND_BYTES:
        raise ContractValidationError(
            "E_VALIDATION",
            "メッセージサイズが上限を超えています。",
            message_id=message_id,
            message_type=message_type,
        )
    try:
        message = json.loads(raw_message)
    except Exception as error:
        raise ContractValidationError(
            "E_VALIDATION",
            "メッセージが JSON ではありません。",
            message_id=message_id,
            message_type=message_type,
        ) from error

    if not isinstance(message, dict):
        raise ContractValidationError(
            "E_VALIDATION",
            "メッセージはオブジェクトで指定してください。",
            message_id=message_id,
            message_type=message_type,
        )

    unknown_fields = sorted(set(message) - COMMAND_FIELDS)
    if unknown_fields:
        raise ContractValidationError(
            "E_VALIDATION",
            f"未知のmessage fieldです: {', '.join(unknown_fields)}",
            message_id=message_id,
            message_type=message_type,
        )

    version = _safe_text(message.get("v"))
    if version != str(protocol_version):
        raise ContractValidationError(
            "E_CONTRACT_VERSION_MISMATCH",
            "プロトコルバージョンが一致しません。",
            message_id=message_id,
            message_type=message_type,
        )
    if _safe_text(message.get("kind")) != "cmd":
        raise ContractValidationError(
            "E_VALIDATION",
            "cmd メッセージのみ受け付けます。",
            message_id=message_id,
            message_type=message_type,
        )
    if not message_id:
        raise ContractValidationError(
            "E_VALIDATION",
            "command id は必須です。",
            message_type=message_type,
        )
    if MESSAGE_ID_PATTERN.fullmatch(message_id) is None:
        raise ContractValidationError(
            "E_VALIDATION",
            "command id の形式が不正です。",
            message_id=message_id,
            message_type=message_type,
        )
    if message_type == "unknown":
        raise ContractValidationError(
            "E_VALIDATION",
            "command type は必須です。",
            message_id=message_id,
        )
    if MESSAGE_TYPE_PATTERN.fullmatch(message_type) is None:
        raise ContractValidationError(
            "E_VALIDATION",
            "command type の形式が不正です。",
            message_id=message_id,
            message_type=message_type,
        )

    timestamp = _safe_text(message.get("ts"))
    if not timestamp:
        raise ContractValidationError(
            "E_VALIDATION",
            "command ts は必須です。",
            message_id=message_id,
            message_type=message_type,
        )
    try:
        datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
    except ValueError as error:
        raise ContractValidationError(
            "E_VALIDATION",
            "command ts はISO 8601形式で指定してください。",
            message_id=message_id,
            message_type=message_type,
        ) from error

    payload = message.get("payload")
    if not isinstance(payload, dict):
        raise ContractValidationError(
            "E_VALIDATION",
            "command payload はオブジェクトで指定してください。",
            message_id=message_id,
            message_type=message_type,
        )

    return CommandEnvelope(
        version=version,
        message_id=message_id,
        message_type=message_type,
        timestamp=timestamp,
        payload=payload,
    )


def build_success_response(message_id, message_type, data, trace_id, *, protocol_version=PROTOCOL_VERSION):
    return {
        "v": str(protocol_version),
        "kind": "res",
        "id": _safe_text(message_id) or None,
        "type": _safe_text(message_type) or "unknown",
        "ts": _iso_now(),
        "ok": True,
        "data": data if data is not None else {},
        "trace_id": _safe_text(trace_id),
    }


def build_failure_response(
    message_id,
    message_type,
    code,
    message,
    trace_id,
    *,
    detail=None,
    protocol_version=PROTOCOL_VERSION,
):
    return {
        "v": str(protocol_version),
        "kind": "res",
        "id": _safe_text(message_id) or None,
        "type": _safe_text(message_type) or "unknown",
        "ts": _iso_now(),
        "ok": False,
        "error": {
            "code": _safe_text(code) or "E_INTERNAL",
            "message": str(message or ""),
            "detail": detail if isinstance(detail, dict) else {},
        },
        "trace_id": _safe_text(trace_id),
    }


def build_event(message_type, payload, *, protocol_version=PROTOCOL_VERSION):
    return {
        "v": str(protocol_version),
        "kind": "evt",
        "type": _safe_text(message_type) or "unknown",
        "ts": _iso_now(),
        "payload": payload if isinstance(payload, dict) else {},
    }


def serialize_message(message):
    return json.dumps(message, ensure_ascii=False, separators=(",", ":"))
