from abc import ABC, abstractmethod
import json
import re

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
    def attach_dataframe_schema(dataframe: pd.DataFrame, schema_override=None) -> pd.DataFrame:
        if isinstance(dataframe, pd.DataFrame):
            from core.type_registry import build_dataframe_schema

            schema_items = (
                BaseConnector.parse_schema_definition(schema_override)
                if schema_override is not None and str(schema_override).strip() != ""
                else build_dataframe_schema(dataframe)
            )
            dataframe = BaseConnector.apply_schema_to_dataframe(dataframe, schema_items)
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
    def apply_schema_to_dataframe(dataframe: pd.DataFrame, schema_items) -> pd.DataFrame:
        if not isinstance(dataframe, pd.DataFrame):
            return dataframe
        if not isinstance(schema_items, list):
            return dataframe

        normalized_df = dataframe.copy()
        selected_columns = []
        selected_items = []
        seen_columns = set()
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
            normalized_df[source_name] = BaseConnector._coerce_series_by_ziz_type(
                normalized_df[source_name],
                target_type,
            )
            renamed = str(item.get("new_name") or item.get("name_en") or "").strip()
            if renamed and renamed != source_name:
                normalized_df = normalized_df.rename(columns={source_name: renamed})
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
    def _coerce_series_by_ziz_type(series: pd.Series, ziz_type: str) -> pd.Series:
        if ziz_type == "STRING":
            return series.astype("string")
        if ziz_type == "INT64":
            return pd.to_numeric(series, errors="coerce").astype("Int64")
        if ziz_type == "FLOAT64":
            return pd.to_numeric(series, errors="coerce")
        if ziz_type == "BOOL":
            return series.map(BaseConnector._to_bool_or_na).astype("boolean")
        if ziz_type == "DATE":
            parsed = pd.to_datetime(series.map(BaseConnector._normalize_temporal_text), errors="coerce")
            return parsed.dt.normalize()
        if ziz_type == "DATETIME":
            return pd.to_datetime(series.map(BaseConnector._normalize_temporal_text), errors="coerce")
        if ziz_type == "TIMESTAMP":
            return pd.to_datetime(series.map(BaseConnector._normalize_temporal_text), errors="coerce", utc=True)
        if ziz_type == "TIME":
            return series.map(BaseConnector._to_time_or_na)
        return series

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
        return text

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
