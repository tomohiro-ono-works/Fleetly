import secrets
import time
import uuid


RUN_PREFIXES = {
    ("gui", "flow"): "gui_flw_",
    ("gui", "step"): "gui_stp_",
    ("gui", "standalone"): "gui_std_",
    ("cli", "flow"): "cli_flw_",
}


def new_uuid7():
    timestamp_ms = time.time_ns() // 1_000_000
    if timestamp_ms >= 1 << 48:
        raise OverflowError("UUIDv7 timestampが範囲外です。")
    random_a = secrets.randbits(12)
    random_b = secrets.randbits(62)
    value = (
        (timestamp_ms << 80)
        | (0x7 << 76)
        | (random_a << 64)
        | (0b10 << 62)
        | random_b
    )
    return uuid.UUID(int=value)


def new_run_id(execution_source, run_kind):
    key = (
        str(execution_source or "").strip().lower(),
        str(run_kind or "").strip().lower(),
    )
    prefix = RUN_PREFIXES.get(key)
    if not prefix:
        raise ValueError("execution_source／run_kindの組み合わせが不正です。")
    return f"{prefix}{new_uuid7()}"


def new_trace_id():
    return f"trace_{new_uuid7()}"


def new_session_id():
    return f"session_{new_uuid7()}"
