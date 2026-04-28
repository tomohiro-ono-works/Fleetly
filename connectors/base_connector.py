from abc import ABC, abstractmethod
import json
import math
import re
from decimal import Decimal, InvalidOperation

import pandas as pd

class BaseConnector(ABC):
    def __init__(self) -> None:
        self._execution_logger = None
        self._execution_step_id = None

    @staticmethod
    def normalize_file_path(file_path):
        if file_path is None:
            return None
        normalized = str(file_path).replace("\\\\", "/")
        return normalized.replace("\\", "/")

    @staticmethod
    def is_tabular_data(value):
        return isinstance(value, (pd.DataFrame, list, dict))

    @staticmethod
    def to_dataframe(value):
        if isinstance(value, pd.DataFrame):
            return value.copy()
        if isinstance(value, list):
            return pd.DataFrame(value)
        if isinstance(value, dict):
            return pd.DataFrame([value])
        raise TypeError(f"表データとして扱えない型です: {type(value).__name__}")

    @staticmethod
    def to_records(value):
        if isinstance(value, pd.DataFrame):
            return value.to_dict(orient="records")
        if isinstance(value, list):
            return value
        if isinstance(value, dict):
            return [value]
        raise TypeError(f"レコード配列へ変換できない型です: {type(value).__name__}")

    def set_execution_logger(self, logger, step_id: str | None = None) -> None:
        self._execution_logger = logger
        self._execution_step_id = step_id

    def clear_execution_logger(self) -> None:
        self._execution_logger = None
        self._execution_step_id = None

    @staticmethod
    def attach_dataframe_schema(
        dataframe: pd.DataFrame,
        schema_override=None,
        date_field_mode: str = "speed",
        keep_raw_date_field=False,
        date_serial_system: str = "excel_1900",
    ) -> pd.DataFrame:
        if isinstance(dataframe, pd.DataFrame):
            from core.type_registry import build_dataframe_schema

            schema_items = (
                BaseConnector.parse_schema_definition(schema_override)
                if schema_override is not None and str(schema_override).strip() != ""
                else build_dataframe_schema(dataframe)
            )
            dataframe = BaseConnector.apply_schema_to_dataframe(
                dataframe,
                schema_items,
                date_field_mode=date_field_mode,
                keep_raw_date_field=keep_raw_date_field,
                date_serial_system=date_serial_system,
            )
            dataframe.attrs["ziz_schema"] = schema_items
        return dataframe

    @staticmethod
    def parse_schema_definition(schema_value):
        if isinstance(schema_value, list):
            return schema_value
        if isinstance(schema_value, str):
            text = schema_value.strip()
            if not text:
                return []
            parsed = json.loads(text)
            if not isinstance(parsed, list):
                raise ValueError("schema は JSON 配列で指定してください。")
            return parsed
        raise ValueError("schema は JSON 配列文字列または配列で指定してください。")

    @staticmethod
    def apply_schema_to_dataframe(
        dataframe: pd.DataFrame,
        schema_items,
        date_field_mode: str = "speed",
        keep_raw_date_field=False,
        date_serial_system: str = "excel_1900",
    ) -> pd.DataFrame:
        if not isinstance(dataframe, pd.DataFrame):
            return dataframe
        if not isinstance(schema_items, list):
            return dataframe

        normalized_mode = BaseConnector._normalize_date_field_mode(date_field_mode)
        keep_raw = BaseConnector._to_bool_flag(keep_raw_date_field)
        normalized_df = dataframe.copy()
        selected_columns = []
        selected_items = []
        seen_columns = set()
        metrics = {
            "mode": normalized_mode,
            "target_columns": 0,
            "raw_shadow_columns": 0,
            "serial_fallback_count": 0,
            "text_fallback_count": 0,
            "parse_failure_count": 0,
        }
        for item in schema_items:
            if not isinstance(item, dict):
                continue
            source_name = BaseConnector._resolve_schema_source_column(normalized_df, item)
            if not source_name:
                continue
            if source_name in seen_columns:
                continue
            selected_columns.append(source_name)
            selected_items.append(item)
            seen_columns.add(source_name)

        if selected_columns:
            normalized_df = normalized_df.loc[:, selected_columns].copy()

        for item in selected_items:
            source_name = BaseConnector._resolve_schema_source_column(normalized_df, item)
            if not source_name:
                continue
            target_type = str(item.get("ziz_datatype") or "").strip().upper()
            if not target_type:
                continue
            raw_series = normalized_df[source_name].copy()
            coerced_series, coercion_meta = BaseConnector._coerce_series_by_ziz_type(
                raw_series,
                target_type,
                date_field_mode=normalized_mode,
                date_serial_system=date_serial_system,
                return_meta=True,
            )
            normalized_df[source_name] = coerced_series
            if BaseConnector._is_temporal_target_type(target_type):
                metrics["target_columns"] += 1
                metrics["serial_fallback_count"] += int(coercion_meta.get("serial_fallback_count") or 0)
                metrics["text_fallback_count"] += int(coercion_meta.get("text_fallback_count") or 0)
                metrics["parse_failure_count"] += int(coercion_meta.get("parse_failure_count") or 0)
            renamed = str(item.get("new_name") or item.get("name_en") or "").strip()
            final_name = source_name
            if renamed and renamed != source_name:
                normalized_df = normalized_df.rename(columns={source_name: renamed})
                final_name = renamed
            if keep_raw and BaseConnector._is_temporal_target_type(target_type):
                raw_column = BaseConnector._build_raw_shadow_column_name(normalized_df, final_name)
                normalized_df[raw_column] = raw_series.astype("object")
                metrics["raw_shadow_columns"] += 1
        normalized_df.attrs["ziz_date_parse_metrics"] = metrics
        return normalized_df

    @staticmethod
    def _resolve_schema_source_column(dataframe: pd.DataFrame, item: dict):
        origin_name = str(item.get("origin_name") or item.get("name_ja") or "").strip()
        new_name = str(item.get("new_name") or item.get("name_en") or "").strip()
        if origin_name and origin_name in dataframe.columns:
            return origin_name
        if new_name and new_name in dataframe.columns:
            return new_name
        return None

    @staticmethod
    def _coerce_series_by_ziz_type(
        series: pd.Series,
        ziz_type: str,
        date_field_mode: str = "speed",
        date_serial_system: str = "excel_1900",
        return_meta: bool = False,
    ) -> pd.Series | tuple[pd.Series, dict]:
        meta = {
            "serial_fallback_count": 0,
            "text_fallback_count": 0,
            "parse_failure_count": 0,
        }
        if ziz_type == "STRING":
            coerced = series.astype("string")
            return (coerced, meta) if return_meta else coerced
        if ziz_type == "INT64":
            coerced = pd.to_numeric(series, errors="coerce").astype("Int64")
            return (coerced, meta) if return_meta else coerced
        if ziz_type == "FLOAT64":
            coerced = pd.to_numeric(series, errors="coerce")
            return (coerced, meta) if return_meta else coerced
        if ziz_type == "NUMERIC":
            coerced = series.map(BaseConnector._to_decimal_or_na)
            return (coerced, meta) if return_meta else coerced
        if ziz_type == "BOOL":
            coerced = series.map(BaseConnector._to_bool_or_na).astype("boolean")
            return (coerced, meta) if return_meta else coerced
        if ziz_type in {"DATE", "DATETIME", "TIMESTAMP"}:
            coerced, temporal_meta = BaseConnector._coerce_temporal_series(
                series,
                ziz_type,
                date_field_mode=date_field_mode,
                date_serial_system=date_serial_system,
            )
            if return_meta:
                return coerced, temporal_meta
            return coerced
        if ziz_type == "TIME":
            coerced = series.map(BaseConnector._to_time_or_na)
            return (coerced, meta) if return_meta else coerced
        return (series, meta) if return_meta else series

    @staticmethod
    def _to_bool_or_na(value):
        if value is None or pd.isna(value):
            return pd.NA
        if isinstance(value, bool):
            return value
        text = str(value).strip().lower()
        if text in {"1", "true", "yes", "on"}:
            return True
        if text in {"0", "false", "no", "off"}:
            return False
        return pd.NA

    @staticmethod
    def _to_decimal_or_na(value):
        if value is None or pd.isna(value):
            return None
        if isinstance(value, Decimal):
            return value
        if isinstance(value, bool):
            return None
        if isinstance(value, int):
            return Decimal(value)
        if isinstance(value, float):
            if pd.isna(value):
                return None
            return Decimal(str(value))

        text = str(value).strip()
        if not text:
            return None
        text = text.replace(",", "")
        try:
            return Decimal(text)
        except (InvalidOperation, ValueError):
            return None

    @staticmethod
    def _normalize_temporal_text(value):
        if value is None or pd.isna(value):
            return None
        if not isinstance(value, str):
            return value
        text = value.strip()
        if not text:
            return None
        text = text.replace("年", "-").replace("月", "-").replace("日", "")
        text = text.replace("/", "-")
        text = re.sub(r"\s+", " ", text)
        compact_date_match = re.fullmatch(r"(\d{4})(\d{2})(\d{2})", text)
        if compact_date_match:
            return f"{compact_date_match.group(1)}-{compact_date_match.group(2)}-{compact_date_match.group(3)}"
        return text

    @staticmethod
    def _normalize_date_field_mode(mode: str) -> str:
        text = str(mode or "").strip().lower()
        return text if text in {"speed", "cleansing"} else "speed"

    @staticmethod
    def _to_bool_flag(value) -> bool:
        if isinstance(value, bool):
            return value
        text = str(value or "").strip().lower()
        return text in {"1", "true", "yes", "on"}

    @staticmethod
    def _is_temporal_target_type(ziz_type: str) -> bool:
        return str(ziz_type or "").strip().upper() in {"DATE", "DATETIME", "TIMESTAMP"}

    @staticmethod
    def _build_raw_shadow_column_name(dataframe: pd.DataFrame, base_name: str) -> str:
        candidate = f"{base_name}__raw"
        if candidate not in dataframe.columns:
            return candidate
        suffix = 2
        while True:
            next_name = f"{candidate}_{suffix}"
            if next_name not in dataframe.columns:
                return next_name
            suffix += 1

    @staticmethod
    def _coerce_temporal_series(
        series: pd.Series,
        ziz_type: str,
        date_field_mode: str = "speed",
        date_serial_system: str = "excel_1900",
    ) -> tuple[pd.Series, dict]:
        mode = BaseConnector._normalize_date_field_mode(date_field_mode)
        normalized = series.map(BaseConnector._normalize_temporal_text)
        parse_with_utc = ziz_type == "TIMESTAMP"
        parsed_primary = pd.to_datetime(normalized, errors="coerce", utc=parse_with_utc)
        parsed_secondary = None
        if mode == "cleansing":
            parsed_secondary = pd.to_datetime(series, errors="coerce", utc=parse_with_utc)

        combined = parsed_primary.copy()
        text_fallback_count = 0
        if parsed_secondary is not None:
            text_fallback_mask = combined.isna() & parsed_secondary.notna()
            text_fallback_count = int(text_fallback_mask.sum())
            if text_fallback_count > 0:
                combined = combined.where(~text_fallback_mask, parsed_secondary)

        serial_parsed = BaseConnector._coerce_excel_serial_series(series, date_serial_system=date_serial_system)
        serial_fallback_mask = combined.isna() & serial_parsed.notna()
        serial_fallback_count = int(serial_fallback_mask.sum())
        if serial_fallback_count > 0:
            combined = combined.where(~serial_fallback_mask, serial_parsed)

        coerced = BaseConnector._coerce_to_target_temporal_type(combined, ziz_type)
        parse_failure_count = int(((~series.map(BaseConnector._is_empty_scalar)) & pd.isna(coerced)).sum())
        return coerced, {
            "serial_fallback_count": serial_fallback_count,
            "text_fallback_count": text_fallback_count,
            "parse_failure_count": parse_failure_count,
        }

    @staticmethod
    def _coerce_to_target_temporal_type(parsed: pd.Series, ziz_type: str) -> pd.Series:
        if ziz_type == "DATE":
            normalized = pd.to_datetime(parsed, errors="coerce")
            return normalized.dt.normalize()
        if ziz_type == "DATETIME":
            normalized = pd.to_datetime(parsed, errors="coerce")
            if hasattr(normalized.dt, "tz") and normalized.dt.tz is not None:
                return normalized.dt.tz_convert("UTC").dt.tz_localize(None)
            return normalized
        return pd.to_datetime(parsed, errors="coerce", utc=True)

    @staticmethod
    def _coerce_excel_serial_series(series: pd.Series, date_serial_system: str = "excel_1900") -> pd.Series:
        serial_values = series.map(BaseConnector._to_excel_serial_number)
        numeric_series = pd.to_numeric(serial_values, errors="coerce")
        if numeric_series.notna().sum() == 0:
            return pd.Series(pd.NaT, index=series.index, dtype="datetime64[ns]")
        valid_range_mask = numeric_series.between(-100000, 2958465)
        numeric_series = numeric_series.where(valid_range_mask)
        origin = BaseConnector._get_excel_serial_origin(date_serial_system)
        return pd.to_datetime(numeric_series, unit="D", origin=origin, errors="coerce")

    @staticmethod
    def _get_excel_serial_origin(date_serial_system: str) -> str:
        text = str(date_serial_system or "").strip().lower()
        if text in {"excel_1904", "1904"}:
            return "1904-01-01"
        return "1899-12-30"

    @staticmethod
    def _to_excel_serial_number(value):
        if value is None:
            return None
        if BaseConnector._is_na_value(value):
            return None
        if isinstance(value, bool):
            return None
        if isinstance(value, (int, float, Decimal)):
            numeric = float(value)
            if not math.isfinite(numeric):
                return None
            return numeric
        if isinstance(value, str):
            text = value.strip().replace(",", "")
            if not text or not re.fullmatch(r"-?\d+(?:\.\d+)?", text):
                return None
            try:
                numeric = float(text)
            except ValueError:
                return None
            if not math.isfinite(numeric):
                return None
            return numeric
        return None

    @staticmethod
    def _is_empty_scalar(value) -> bool:
        if value is None or BaseConnector._is_na_value(value):
            return True
        if isinstance(value, str) and not value.strip():
            return True
        return False

    @staticmethod
    def _is_na_value(value) -> bool:
        try:
            marker = pd.isna(value)
        except Exception:
            return False
        return isinstance(marker, bool) and marker

    def log_date_parse_metrics(self, dataframe: pd.DataFrame) -> None:
        if not isinstance(dataframe, pd.DataFrame):
            return
        metrics = dataframe.attrs.get("ziz_date_parse_metrics")
        if not isinstance(metrics, dict):
            return
        target_columns = int(metrics.get("target_columns") or 0)
        if target_columns <= 0:
            return
        mode = str(metrics.get("mode") or "speed")
        serial_count = int(metrics.get("serial_fallback_count") or 0)
        text_count = int(metrics.get("text_fallback_count") or 0)
        failed_count = int(metrics.get("parse_failure_count") or 0)
        raw_columns = int(metrics.get("raw_shadow_columns") or 0)
        self.log_execution(
            f"日付変換 mode={mode} 対象列={target_columns} serial補完={serial_count} text補完={text_count} 失敗={failed_count} raw保持列={raw_columns}"
        )

    @staticmethod
    def _to_time_or_na(value):
        normalized = BaseConnector._normalize_temporal_text(value)
        if normalized is None:
            return None
        if hasattr(normalized, "hour") and hasattr(normalized, "minute") and hasattr(normalized, "second"):
            return getattr(normalized, "time", lambda: normalized)()
        parsed = pd.to_datetime(str(normalized), errors="coerce")
        if pd.isna(parsed):
            return None
        return parsed.time()

    def log_execution(self, message: str, level: str = "info") -> None:
        if not self._execution_logger or not message:
            return
        log_message = f"[{self._execution_step_id}] {message}" if self._execution_step_id else message
        getattr(self._execution_logger, level, self._execution_logger.info)(log_message)

    @abstractmethod
    def execute(self, action: str, params: dict, context: dict):
        pass
