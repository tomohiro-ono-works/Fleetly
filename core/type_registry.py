from dataclasses import dataclass
from datetime import date, datetime, time
from decimal import Decimal

import pandas as pd
from pandas.api.types import (
    is_bool_dtype,
    is_datetime64_any_dtype,
    is_datetime64tz_dtype,
    is_float_dtype,
    is_integer_dtype,
    is_timedelta64_dtype,
    is_string_dtype,
)


@dataclass(frozen=True)
class TypeSpec:
    ziz_datatype: str
    pandas_type: str
    bigquery_type: str


SCALAR_TYPE_SPECS = {
    "INT64": TypeSpec("INT64", "Int64", "INT64"),
    "FLOAT64": TypeSpec("FLOAT64", "float64", "FLOAT64"),
    "NUMERIC": TypeSpec("NUMERIC", "decimal.Decimal", "NUMERIC"),
    "STRING": TypeSpec("STRING", "string", "STRING"),
    "BYTES": TypeSpec("BYTES", "object(bytes)", "BYTES"),
    "DATE": TypeSpec("DATE", "datetime64[ns]", "DATE"),
    "DATETIME": TypeSpec("DATETIME", "datetime64[ns]", "DATETIME"),
    "TIMESTAMP": TypeSpec("TIMESTAMP", "datetime64[ns, UTC]", "TIMESTAMP"),
    "TIME": TypeSpec("TIME", "object(datetime.time)", "TIME"),
    "INTERVAL": TypeSpec("INTERVAL", "timedelta64[ns]", "INTERVAL"),
    "BOOL": TypeSpec("BOOL", "boolean", "BOOL"),
}

CONTAINER_TYPE_SPECS = {
    "ARRAY": TypeSpec("ARRAY", "object(list)", "ARRAY"),
    "STRUCT": TypeSpec("STRUCT", "object(dict)", "STRUCT"),
}

ZIZ_DATATYPES = tuple(SCALAR_TYPE_SPECS.keys()) + tuple(CONTAINER_TYPE_SPECS.keys())


def normalize_ziz_datatype(ziz_datatype: str) -> str:
    return str(ziz_datatype or "").strip().upper()


def get_scalar_type_spec(ziz_datatype: str) -> TypeSpec:
    normalized = normalize_ziz_datatype(ziz_datatype)
    spec = SCALAR_TYPE_SPECS.get(normalized)
    if spec:
        return spec
    raise KeyError(f"未対応の ziz_datatype です: {ziz_datatype}")


def resolve_pandas_type(ziz_datatype: str) -> str:
    normalized = str(ziz_datatype or "").strip()
    if normalized.startswith("ARRAY<") and normalized.endswith(">"):
        return CONTAINER_TYPE_SPECS["ARRAY"].pandas_type
    if normalized.startswith("STRUCT<") and normalized.endswith(">"):
        return CONTAINER_TYPE_SPECS["STRUCT"].pandas_type
    return get_scalar_type_spec(normalized).pandas_type


def resolve_bigquery_type(ziz_datatype: str) -> str:
    normalized = str(ziz_datatype or "").strip()
    if normalized.startswith("ARRAY<") and normalized.endswith(">"):
        inner = normalized[len("ARRAY<"):-1].strip()
        return f"ARRAY<{resolve_bigquery_type(inner)}>"
    if normalized.startswith("STRUCT<") and normalized.endswith(">"):
        body = normalized[len("STRUCT<"):-1].strip()
        fields = []
        for raw_field in split_top_level(body):
            name, raw_type = split_struct_field(raw_field)
            fields.append(f"{name} {resolve_bigquery_type(raw_type)}")
        return f"STRUCT<{', '.join(fields)}>"
    return get_scalar_type_spec(normalized).bigquery_type


def build_schema_item(origin_name: str, new_name: str, description: str, ziz_datatype: str) -> dict:
    normalized = str(ziz_datatype or "").strip()
    return {
        "origin_name": str(origin_name or ""),
        "new_name": str(new_name or ""),
        "description": str(description or ""),
        "ziz_datatype": normalized,
        "pandas_type": resolve_pandas_type(normalized),
        "bigquery_type": resolve_bigquery_type(normalized),
    }


def infer_ziz_datatype_from_series(series: pd.Series) -> str:
    non_null = series.dropna()
    if non_null.empty:
        return "STRING"

    sample_values = [value for value in non_null.head(100).tolist() if value != ""]
    if not sample_values:
        return "STRING"

    if is_bool_dtype(series):
        return "BOOL"
    if is_integer_dtype(series):
        return "INT64"
    if is_float_dtype(series):
        return "FLOAT64"
    if is_timedelta64_dtype(series):
        return "INTERVAL"
    if is_datetime64tz_dtype(series):
        return "TIMESTAMP"
    if is_datetime64_any_dtype(series):
        return _infer_datetime_family(sample_values)
    if is_string_dtype(series) and all(isinstance(value, str) for value in sample_values):
        return _infer_string_family(sample_values)

    if all(isinstance(value, Decimal) for value in sample_values):
        return "NUMERIC"
    if all(isinstance(value, (bytes, bytearray)) for value in sample_values):
        return "BYTES"
    if all(isinstance(value, time) and not isinstance(value, datetime) for value in sample_values):
        return "TIME"
    if all(isinstance(value, list) for value in sample_values):
        return "ARRAY<STRING>"
    if all(isinstance(value, dict) for value in sample_values):
        return "STRUCT"
    if all(isinstance(value, (datetime, pd.Timestamp)) for value in sample_values):
        return _infer_datetime_family(sample_values)
    if all(isinstance(value, date) and not isinstance(value, datetime) for value in sample_values):
        return "DATE"
    if all(isinstance(value, str) for value in sample_values):
        return _infer_string_family(sample_values)
    return "STRING"


def build_dataframe_schema(dataframe: pd.DataFrame) -> list[dict]:
    return [
        build_schema_item(
            str(column),
            str(column),
            str(column),
            infer_ziz_datatype_from_series(dataframe[column]),
        )
        for column in dataframe.columns
    ]


def split_struct_field(field_expr: str) -> tuple[str, str]:
    if ":" not in field_expr:
        raise ValueError(f"STRUCT フィールド定義が不正です: {field_expr}")
    name, raw_type = field_expr.split(":", 1)
    field_name = str(name or "").strip()
    field_type = str(raw_type or "").strip()
    if not field_name or not field_type:
        raise ValueError(f"STRUCT フィールド定義が不正です: {field_expr}")
    return field_name, field_type


def split_top_level(text: str) -> list[str]:
    items = []
    current = []
    depth = 0
    for ch in str(text or ""):
        if ch == "<":
            depth += 1
        elif ch == ">":
            depth = max(0, depth - 1)
        elif ch == "," and depth == 0:
            item = "".join(current).strip()
            if item:
                items.append(item)
            current = []
            continue
        current.append(ch)
    tail = "".join(current).strip()
    if tail:
        items.append(tail)
    return items


def _infer_datetime_family(values: list) -> str:
    normalized_values = []
    for value in values:
        if isinstance(value, pd.Timestamp):
            normalized_values.append(value)
        elif isinstance(value, datetime):
            normalized_values.append(pd.Timestamp(value))
        elif isinstance(value, date):
            normalized_values.append(pd.Timestamp(value))
        else:
            return "STRING"

    if any(getattr(value, "tzinfo", None) is not None for value in normalized_values):
        return "TIMESTAMP"
    if all(
        value.hour == 0 and value.minute == 0 and value.second == 0 and value.microsecond == 0 and value.nanosecond == 0
        for value in normalized_values
    ):
        return "DATE"
    return "DATETIME"


def _infer_string_family(values: list[str]) -> str:
    stripped = [str(value).strip() for value in values if str(value).strip()]
    if not stripped:
        return "STRING"
    if all(_looks_like_date(value) for value in stripped):
        return "DATE"
    if all(_looks_like_timestamp(value) for value in stripped):
        return "TIMESTAMP"
    if all(_looks_like_datetime(value) for value in stripped):
        return "DATETIME"
    if all(_looks_like_time(value) for value in stripped):
        return "TIME"
    return "STRING"


def _looks_like_date(value: str) -> bool:
    normalized = value.replace("年", "-").replace("月", "-").replace("日", "")
    normalized = normalized.replace("/", "-")
    parts = normalized.split("-")
    if len(parts) != 3:
        return False
    return all(part.isdigit() for part in parts)


def _looks_like_datetime(value: str) -> bool:
    text = value.strip().replace("T", " ")
    if " " not in text:
        return False
    date_part, time_part = text.split(" ", 1)
    return _looks_like_date(date_part) and _looks_like_time(time_part)


def _looks_like_timestamp(value: str) -> bool:
    text = value.strip()
    if text.endswith("Z"):
        return _looks_like_datetime(text[:-1])
    if "+" in text[10:] or "-" in text[10:]:
        base = text.replace("T", " ")
        if "+" in base[10:]:
            base = base.rsplit("+", 1)[0]
            return _looks_like_datetime(base)
        base_parts = base.rsplit("-", 1)
        if len(base_parts) == 2 and ":" in base_parts[1]:
            return _looks_like_datetime(base_parts[0])
    return False


def _looks_like_time(value: str) -> bool:
    parts = value.strip().split(":")
    if len(parts) not in {2, 3}:
        return False
    head = parts[:2]
    if not all(part.isdigit() for part in head):
        return False
    if len(parts) == 3:
        seconds = parts[2].split(".", 1)[0]
        return seconds.isdigit()
    return True
