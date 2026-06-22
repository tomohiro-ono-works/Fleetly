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
        self._execution_perf_callback = None

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

    def set_execution_logger(self, logger, step_id: str | None = None, perf_callback=None) -> None:
        self._execution_logger = logger
        self._execution_step_id = step_id
        self._execution_perf_callback = perf_callback

    def clear_execution_logger(self) -> None:
        self._execution_logger = None
        self._execution_step_id = None
        self._execution_perf_callback = None

    def log_performance(self, event: str, payload: dict | None = None) -> None:
        callback = self._execution_perf_callback
        if not callable(callback):
            return
        detail = dict(payload or {})
        if self._execution_step_id and "step_id" not in detail:
            detail["step_id"] = self._execution_step_id
        try:
            callback(str(event or ""), detail)
        except Exception:
            return

    @staticmethod
    def attach_dataframe_schema(
        dataframe: pd.DataFrame,
        schema_override=None,
        date_serial_system: str = "excel_1900",
        date_cleansing: bool = True,
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
                date_serial_system=date_serial_system,
                date_cleansing=date_cleansing,
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
        date_serial_system: str = "excel_1900",
        date_cleansing: bool = True,
    ) -> pd.DataFrame:
        if not isinstance(dataframe, pd.DataFrame):
            return dataframe
        if not isinstance(schema_items, list):
            return dataframe

        normalized_df = dataframe.copy()
        available_columns = [str(column) for column in normalized_df.columns]
        selected_columns = []
        selected_items = []
        selected_sources = []
        seen_columns = set()
        missing_specs = []
        metrics = {
            "date_cleansing": bool(date_cleansing),
            "target_columns": 0,
            "serial_fallback_count": 0,
            "parse_failure_count": 0,
            "input_column_count": len(available_columns),
            "selected_column_count": 0,
            "renamed_column_count": 0,
            "renamed_columns": [],
            "selected_columns": [],
        }

        # 1) 列存在チェック
        for item in schema_items:
            if not isinstance(item, dict):
                continue
            origin_name, new_name = BaseConnector._extract_schema_column_candidates(item)
            if not origin_name and not new_name:
                continue
            source_name = BaseConnector._resolve_schema_source_column(normalized_df, item)
            if not source_name:
                requested = origin_name or new_name
                missing_specs.append(requested)
                continue
            if source_name in seen_columns:
                continue
            selected_columns.append(source_name)
            selected_items.append(item)
            selected_sources.append(source_name)
            seen_columns.add(source_name)

        if missing_specs:
            missing_unique = list(dict.fromkeys(missing_specs))
            available_text = ", ".join(available_columns)
            missing_text = ", ".join(missing_unique)
            raise ValueError(
                "schema適用エラー(列存在チェック): "
                f"指定列が存在しません [{missing_text}] / 利用可能列 [{available_text}]"
            )

        # 2) 列選択（未指定列は削除）
        if selected_columns:
            normalized_df = normalized_df.loc[:, selected_columns].copy()
            metrics["selected_columns"] = [str(column) for column in selected_columns]
            metrics["selected_column_count"] = len(selected_columns)

        # 3) 型変換
        string_columns_to_cast = []
        for index, item in enumerate(selected_items):
            source_name = selected_sources[index]
            target_type = str(item.get("ziz_datatype") or "").strip().upper()
            if not target_type:
                continue
            if target_type == "STRING":
                string_columns_to_cast.append(source_name)
                continue
            raw_series = normalized_df[source_name].copy()
            try:
                coerced_series, coercion_meta = BaseConnector._coerce_series_by_ziz_type(
                    raw_series,
                    target_type,
                    date_serial_system=date_serial_system,
                    date_cleansing=date_cleansing,
                    return_meta=True,
                )
            except Exception as error:
                raise ValueError(
                    "schema適用エラー(型変換): "
                    f"列 '{source_name}' を {target_type} へ変換できません: {error}"
                ) from error
            normalized_df[source_name] = coerced_series
            if BaseConnector._is_temporal_target_type(target_type):
                metrics["target_columns"] += 1
                metrics["serial_fallback_count"] += int(coercion_meta.get("serial_fallback_count") or 0)
                metrics["parse_failure_count"] += int(coercion_meta.get("parse_failure_count") or 0)

        # STRING はまとめて一括変換
        if string_columns_to_cast:
            try:
                cast_map = {column_name: "string" for column_name in string_columns_to_cast}
                normalized_df = normalized_df.astype(cast_map)
            except Exception as error:
                columns_text = ", ".join(string_columns_to_cast)
                raise ValueError(
                    "schema適用エラー(型変換): "
                    f"列 '{columns_text}' を STRING へ変換できません: {error}"
                ) from error

        # 4) リネーム
        rename_pairs = []
        for index, item in enumerate(selected_items):
            source_name = selected_sources[index]
            renamed = str(item.get("new_name") or item.get("name_en") or "").strip()
            if renamed and renamed != source_name:
                rename_pairs.append((source_name, renamed))
        if rename_pairs:
            try:
                normalized_df = normalized_df.rename(columns={source: target for source, target in rename_pairs})
            except Exception as error:
                raise ValueError(f"schema適用エラー(リネーム): {error}") from error
            metrics["renamed_column_count"] = len(rename_pairs)
            metrics["renamed_columns"] = [f"{source}->{target}" for source, target in rename_pairs]

        normalized_df.attrs["ziz_date_parse_metrics"] = metrics
        return normalized_df

    @staticmethod
    def _extract_schema_column_candidates(item: dict) -> tuple[str, str]:
        origin_name = str(item.get("origin_name") or item.get("name_ja") or "").strip()
        new_name = str(item.get("new_name") or item.get("name_en") or "").strip()
        return origin_name, new_name

    @staticmethod
    def _resolve_schema_source_column(dataframe: pd.DataFrame, item: dict):
        origin_name, new_name = BaseConnector._extract_schema_column_candidates(item)
        if origin_name and origin_name in dataframe.columns:
            return origin_name
        if new_name and new_name in dataframe.columns:
            return new_name
        return None

    @staticmethod
    def _coerce_series_by_ziz_type(
        series: pd.Series,
        ziz_type: str,
        date_serial_system: str = "excel_1900",
        date_cleansing: bool = True,
        return_meta: bool = False,
    ) -> pd.Series | tuple[pd.Series, dict]:
        meta = {
            "serial_fallback_count": 0,
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
            coerced = BaseConnector._coerce_numeric_series_fast(series)
            return (coerced, meta) if return_meta else coerced
        if ziz_type == "BOOL":
            coerced = BaseConnector._coerce_bool_series_fast(series)
            return (coerced, meta) if return_meta else coerced
        if ziz_type in {"DATE", "DATETIME", "TIMESTAMP"}:
            coerced, temporal_meta = BaseConnector._coerce_temporal_series(
                series,
                ziz_type,
                date_serial_system=date_serial_system,
                date_cleansing=date_cleansing,
            )
            if return_meta:
                return coerced, temporal_meta
            return coerced
        if ziz_type == "TIME":
            coerced = BaseConnector._coerce_time_series_fast(series)
            return (coerced, meta) if return_meta else coerced
        return (series, meta) if return_meta else series

    @staticmethod
    def _coerce_numeric_series_fast(series: pd.Series) -> pd.Series:
        text_series = series.astype("string").str.strip().str.replace(",", "", regex=False)
        numeric_series = pd.to_numeric(text_series, errors="coerce")
        coerced = pd.Series([None] * len(series), index=series.index, dtype="object")
        valid_mask = numeric_series.notna()
        if valid_mask.any():
            coerced.loc[valid_mask] = numeric_series.loc[valid_mask].map(lambda value: Decimal(str(value)))
        return coerced

    @staticmethod
    def _coerce_bool_series_fast(series: pd.Series) -> pd.Series:
        text_series = series.astype("string").str.strip().str.lower()
        coerced = pd.Series(pd.NA, index=series.index, dtype="boolean")
        true_mask = text_series.isin({"1", "true", "yes", "on"})
        false_mask = text_series.isin({"0", "false", "no", "off"})
        coerced.loc[true_mask] = True
        coerced.loc[false_mask] = False
        return coerced

    @staticmethod
    def _coerce_time_series_fast(series: pd.Series) -> pd.Series:
        parsed = pd.to_datetime(series, errors="coerce")
        coerced = pd.Series([None] * len(series), index=series.index, dtype="object")
        success_mask = parsed.notna()
        if success_mask.any():
            coerced.loc[success_mask] = parsed.loc[success_mask].dt.time

        failure_mask = (~success_mask) & (~BaseConnector._is_empty_series(series))
        if failure_mask.any():
            coerced.loc[failure_mask] = series.loc[failure_mask].map(BaseConnector._to_time_or_na)
        return coerced

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
    def _is_temporal_target_type(ziz_type: str) -> bool:
        return str(ziz_type or "").strip().upper() in {"DATE", "DATETIME", "TIMESTAMP"}

    @staticmethod
    def _to_bool_flag(value) -> bool:
        if isinstance(value, bool):
            return value
        text = str(value or "").strip().lower()
        return text in {"1", "true", "yes", "on"}

    @staticmethod
    def _coerce_temporal_series(
        series: pd.Series,
        ziz_type: str,
        date_serial_system: str = "excel_1900",
        date_cleansing: bool = True,
    ) -> tuple[pd.Series, dict]:
        serial_fallback_count = 0
        if ziz_type == "DATE" and date_cleansing:
            combined, serial_fallback_count = BaseConnector._coerce_date_series_with_cleansing(
                series,
                date_serial_system=date_serial_system,
            )
        elif ziz_type == "DATE":
            combined = pd.to_datetime(series, errors="coerce")
        else:
            parse_with_utc = ziz_type == "TIMESTAMP"
            combined = pd.to_datetime(series, errors="coerce", utc=parse_with_utc)

        coerced = BaseConnector._coerce_to_target_temporal_type(combined, ziz_type)
        parse_failure_count = int((~BaseConnector._is_empty_series(series) & pd.isna(coerced)).sum())
        return coerced, {
            "serial_fallback_count": serial_fallback_count,
            "parse_failure_count": parse_failure_count,
        }

    @staticmethod
    def _coerce_date_series_with_cleansing(
        series: pd.Series,
        date_serial_system: str = "excel_1900",
    ) -> tuple[pd.Series, int]:
        # 1) まずは素の一括パース
        result = pd.to_datetime(series, errors="coerce")

        # 2) NaT のうち和文日付のみ補完 (yyyy年mm月dd日 / yyyy年m月d日)
        na_mask = result.isna()
        if na_mask.any():
            text_series = series.astype("string")
            jp_mask = na_mask & text_series.str.match(r"^\d{4}年\d{1,2}月\d{1,2}日$", na=False)
            if jp_mask.any():
                jp_norm = (
                    text_series.loc[jp_mask]
                    .str.replace("年", "-", regex=False)
                    .str.replace("月", "-", regex=False)
                    .str.replace("日", "", regex=False)
                )
                jp_parsed = pd.to_datetime(jp_norm, errors="coerce")
                result.loc[jp_mask] = jp_parsed

        # 3) まだ NaT のうち、Excelシリアルのみ補完
        serial_fallback_count = 0
        na_mask = result.isna()
        if na_mask.any():
            serial_parsed = BaseConnector._coerce_excel_serial_series(series, date_serial_system=date_serial_system)
            serial_mask = na_mask & serial_parsed.notna()
            serial_fallback_count = int(serial_mask.sum())
            if serial_fallback_count > 0:
                result.loc[serial_mask] = serial_parsed.loc[serial_mask]

        return pd.to_datetime(result, errors="coerce"), serial_fallback_count

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
    def _is_empty_series(series: pd.Series) -> pd.Series:
        text_series = series.astype("string").str.strip()
        return series.isna() | text_series.eq("")

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
        cleansing = bool(metrics.get("date_cleansing"))
        serial_count = int(metrics.get("serial_fallback_count") or 0)
        failed_count = int(metrics.get("parse_failure_count") or 0)
        self.log_execution(
            f"日付変換 cleansing={cleansing} 対象列={target_columns} serial補完={serial_count} 失敗={failed_count}"
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
