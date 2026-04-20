from __future__ import annotations

import copy
import math
import os
import re
from typing import Any

import pandas as pd

from connectors.base_connector import BaseConnector


class DataintegrationConnector(BaseConnector):
    _PRE_RENAME_CLEANING_OPTIONS = {
        "remove_spaces",
        "remove_newlines",
        "to_halfwidth_alnum",
        "symbols_to_snake",
    }
    _POST_RENAME_CLEANING_OPTIONS = {
        "exclude_japanese_columns",
    }
    _HALFWIDTH_SYMBOL_PATTERN = re.compile(r"[!\"#$%&'()*+,\-./:;<=>?@\[\\\]^`{|}~]+")
    _JAPANESE_CHAR_PATTERN = re.compile(r"[\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]")

    _STRING_OPERATOR_CODES = {
        "exact": "完全一致",
        "prefix": "前方一致",
        "suffix": "後方一致",
        "contains": "部分一致",
        "regex": "正規表現",
        "range": "範囲一致",
        "is_null": "空(null)",
    }

    def execute(self, action: str, params: dict[str, Any], context: dict[str, Any]):
        if action == "replace_fields_forrenamelist":
            return self.replace_fields_forrenamelist(params, context)
        if action == "filter_rows":
            return self.filter_rows(params, context)
        raise ValueError(f"Unknown action: {action}")

    def replace_fields_forrenamelist(self, params: dict[str, Any], context: dict[str, Any]) -> pd.DataFrame:
        dataframe = self._resolve_input_dataframe(params, context)
        pre_cleaning = self._parse_cleansing_options(
            params.get("pre_rename_cleansing"),
            self._PRE_RENAME_CLEANING_OPTIONS,
        )
        post_cleaning = self._parse_cleansing_options(
            params.get("post_rename_cleansing"),
            self._POST_RENAME_CLEANING_OPTIONS,
        )
        rename_list_path = str(params.get("rename_list_path") or "").strip()
        if not rename_list_path:
            raise ValueError("rename_list_path は必須です。")

        rename_mappings = self._load_rename_mappings(rename_list_path)
        if not rename_mappings:
            self.log_execution("RENAME リストに有効な定義が無いため入力データをそのまま返します。", level="warning")
            return self.attach_dataframe_schema(dataframe)

        if pre_cleaning:
            dataframe = self._apply_pre_rename_cleansing_to_dataframe(dataframe, pre_cleaning)
            rename_mappings = self._apply_pre_rename_cleansing_to_mappings(rename_mappings, pre_cleaning)

        rename_map = {item["origin_name"]: item["new_name"] for item in rename_mappings}
        renamed = dataframe.rename(columns=rename_map).copy()
        if "exclude_japanese_columns" in post_cleaning:
            renamed, excluded_columns = self._exclude_japanese_columns(renamed)
            if excluded_columns:
                self.log_execution(
                    f"リネーム後クレンジングを適用しました: 日本語列を除外 {len(excluded_columns)} 件",
                    level="info",
                )
        schema_items = self._build_schema_after_rename(renamed, rename_mappings)
        result = self.apply_schema_to_dataframe(renamed, schema_items)
        result.attrs["ziz_schema"] = copy.deepcopy(schema_items)
        self.log_execution(f"RENAME リストを適用しました: {len(rename_mappings)} 件")
        return result

    def filter_rows(self, params: dict[str, Any], context: dict[str, Any]) -> pd.DataFrame:
        dataframe = self._resolve_input_dataframe(params, context)
        conditions = self._parse_conditions(params.get("conditions"))
        if not conditions:
            self.log_execution("条件が未指定のため入力データをそのまま返します。", level="warning")
            return self.attach_dataframe_schema(dataframe, dataframe.attrs.get("ziz_schema"))

        mask = pd.Series(True, index=dataframe.index)
        for condition in conditions:
            condition_mask = self._build_condition_mask(dataframe, condition)
            apply_mode = str(condition.get("apply") or "include").strip().lower()
            if apply_mode == "exclude":
                mask &= ~condition_mask
            else:
                mask &= condition_mask

        filtered = dataframe.loc[mask].copy()
        schema_items = copy.deepcopy(dataframe.attrs.get("ziz_schema") or [])
        if schema_items:
            filtered.attrs["ziz_schema"] = schema_items
        else:
            filtered = self.attach_dataframe_schema(filtered)
        self.log_execution(f"条件指定を適用しました: {len(conditions)} 条件 / {len(filtered)} 行")
        return filtered

    def _resolve_input_dataframe(self, params: dict[str, Any], context: dict[str, Any]) -> pd.DataFrame:
        ref_name = str(params.get("input_data") or "").strip()
        if not ref_name:
            raise ValueError("input_data は必須です。")
        if ref_name not in context:
            raise ValueError(f"参照データが見つかりません: {ref_name}")
        return self.to_dataframe(context[ref_name])

    def _parse_conditions(self, raw_value: Any) -> list[dict[str, str]]:
        if raw_value is None or raw_value == "":
            return []
        if isinstance(raw_value, list):
            parsed = raw_value
        elif isinstance(raw_value, str):
            parsed = self.parse_schema_definition(raw_value)
        else:
            raise ValueError("conditions は JSON 配列で指定してください。")

        conditions = []
        for item in parsed:
            if not isinstance(item, dict):
                continue
            field_name = str(item.get("field") or "").strip()
            operator = str(item.get("operator") or "").strip().lower()
            apply_mode = str(item.get("apply") or item.get("target") or "include").strip().lower()
            value = str(item.get("value") or "")
            value_to = str(item.get("value_to") or "")
            if not field_name or not operator:
                continue
            if apply_mode not in {"include", "exclude"}:
                apply_mode = "include"
            conditions.append({
                "field": field_name,
                "operator": operator,
                "apply": apply_mode,
                "value": value,
                "value_to": value_to,
            })
        return conditions

    def _build_condition_mask(self, dataframe: pd.DataFrame, condition: dict[str, str]) -> pd.Series:
        field_name = condition["field"]
        operator = condition["operator"]
        value = condition["value"]
        value_to = condition["value_to"]

        if field_name not in dataframe.columns:
            raise ValueError(f"対象フィールドが存在しません: {field_name}")
        if operator not in self._STRING_OPERATOR_CODES:
            raise ValueError(f"未対応の演算子です: {operator}")

        series = dataframe[field_name]
        if operator == "range":
            if str(value).strip() == "" or str(value_to).strip() == "":
                raise ValueError("範囲一致では値を2つ指定してください。")
            return self._range_mask(series, value, value_to)
        if operator == "is_null":
            normalized = series.fillna("").astype(str).str.strip()
            return series.isna() | normalized.eq("")

        normalized = series.fillna("").astype(str)
        if operator == "exact":
            return normalized == str(value)
        if operator == "prefix":
            return normalized.str.startswith(str(value), na=False)
        if operator == "suffix":
            return normalized.str.endswith(str(value), na=False)
        if operator == "contains":
            return normalized.str.contains(str(value), na=False, regex=False)
        if operator == "regex":
            try:
                return normalized.str.contains(str(value), na=False, regex=True)
            except Exception as error:
                raise ValueError(f"正規表現が不正です: {error}") from error
        raise ValueError(f"未対応の演算子です: {operator}")

    def _range_mask(self, series: pd.Series, start_value: str, end_value: str) -> pd.Series:
        numeric_series = pd.to_numeric(series, errors="coerce")
        start_numeric = self._to_float_or_none(start_value)
        end_numeric = self._to_float_or_none(end_value)
        if start_numeric is not None and end_numeric is not None and not numeric_series.isna().all():
            return numeric_series.between(start_numeric, end_numeric, inclusive="both").fillna(False)

        datetime_series = pd.to_datetime(series, errors="coerce")
        start_datetime = pd.to_datetime(start_value, errors="coerce")
        end_datetime = pd.to_datetime(end_value, errors="coerce")
        if not pd.isna(start_datetime) and not pd.isna(end_datetime) and not datetime_series.isna().all():
            return datetime_series.between(start_datetime, end_datetime, inclusive="both").fillna(False)

        normalized = series.fillna("").astype(str)
        return normalized.between(str(start_value), str(end_value), inclusive="both")

    def _load_rename_mappings(self, rename_list_path: str) -> list[dict[str, str]]:
        normalized_path = os.path.abspath(str(rename_list_path))
        if not os.path.exists(normalized_path):
            raise ValueError(f"RENAME リストファイルが見つかりません: {rename_list_path}")

        dataframe = pd.read_csv(normalized_path, dtype=str).fillna("")
        normalized_columns = {str(column).strip().lower(): column for column in dataframe.columns}

        def resolve_column(*candidates: str) -> str | None:
            for candidate in candidates:
                key = str(candidate).strip().lower()
                if key in normalized_columns:
                    return normalized_columns[key]
            return None

        origin_col = resolve_column("origin_name", "元フィールド名")
        target_col = resolve_column("replaced_name", "new_name", "新フィールド名")
        description_col = resolve_column("description", "説明", "日本語名")
        datatype_col = resolve_column("ziz_datatype", "datatype", "データ型")

        if not origin_col or not target_col:
            raise ValueError("RENAME リストには origin_name と replaced_name（または new_name）が必要です。")

        mappings = []
        for _, row in dataframe.iterrows():
            origin_name = str(row.get(origin_col, "")).strip()
            new_name = str(row.get(target_col, "")).strip()
            if not origin_name or not new_name:
                continue
            mappings.append({
                "origin_name": origin_name,
                "new_name": new_name,
                "description": str(row.get(description_col, "")).strip() if description_col else "",
                "ziz_datatype": str(row.get(datatype_col, "")).strip().upper() if datatype_col else "",
            })
        return mappings

    def _build_schema_after_rename(self, dataframe: pd.DataFrame, rename_mappings: list[dict[str, str]]) -> list[dict[str, str]]:
        schema_items = self.attach_dataframe_schema(dataframe).attrs.get("ziz_schema") or []
        mapping_by_new_name = {
            str(item.get("new_name") or "").strip(): item
            for item in rename_mappings
            if str(item.get("new_name") or "").strip()
        }

        merged = []
        for item in schema_items:
            if not isinstance(item, dict):
                continue
            column_name = str(item.get("new_name") or item.get("origin_name") or "").strip()
            rename_item = mapping_by_new_name.get(column_name)
            merged_item = copy.deepcopy(item)
            if rename_item:
                # RENAME 適用後は「現在の列名」を基準にそろえる
                canonical_name = str(rename_item["new_name"] or "").strip()
                if canonical_name:
                    merged_item["origin_name"] = canonical_name
                    merged_item["new_name"] = canonical_name
                if rename_item.get("description"):
                    merged_item["description"] = rename_item["description"]
                else:
                    merged_item["description"] = rename_item["new_name"]
                if rename_item.get("ziz_datatype"):
                    merged_item["ziz_datatype"] = rename_item["ziz_datatype"]
            else:
                canonical_name = str(merged_item.get("new_name") or merged_item.get("origin_name") or "").strip()
                if canonical_name:
                    merged_item["origin_name"] = canonical_name
                    merged_item["new_name"] = canonical_name
            merged.append(merged_item)
        return merged

    def _parse_cleansing_options(self, raw_value: Any, allowed_options: set[str]) -> set[str]:
        if not raw_value:
            return set()
        values: list[str] = []
        if isinstance(raw_value, list):
            values = [str(item or "").strip() for item in raw_value]
        elif isinstance(raw_value, dict):
            values = [str(key or "").strip() for key, enabled in raw_value.items() if bool(enabled)]
        elif isinstance(raw_value, str):
            text = raw_value.strip()
            if not text:
                return set()
            try:
                parsed = self.parse_schema_definition(text)
                if isinstance(parsed, list):
                    values = [str(item or "").strip() for item in parsed]
            except Exception:
                values = [item.strip() for item in text.split(",")]
        else:
            values = [str(raw_value).strip()]
        return {value for value in values if value in allowed_options}

    def _apply_pre_rename_cleansing_to_dataframe(self, dataframe: pd.DataFrame, options: set[str]) -> pd.DataFrame:
        if dataframe.empty and not list(dataframe.columns):
            return dataframe
        cleaned_columns = []
        for index, column in enumerate(dataframe.columns):
            cleaned = self._cleanse_column_name(str(column), options).strip()
            if not cleaned:
                cleaned = f"column_{index + 1}"
            cleaned_columns.append(cleaned)
        duplicates = sorted({
            name
            for name in cleaned_columns
            if cleaned_columns.count(name) > 1
        })
        if duplicates:
            raise ValueError(f"リネーム前クレンジング後にカラム名が重複しました: {', '.join(duplicates)}")
        cleaned_df = dataframe.copy()
        cleaned_df.columns = cleaned_columns
        return cleaned_df

    def _apply_pre_rename_cleansing_to_mappings(
        self,
        rename_mappings: list[dict[str, str]],
        options: set[str],
    ) -> list[dict[str, str]]:
        normalized: list[dict[str, str]] = []
        for item in rename_mappings:
            origin_name = self._cleanse_column_name(str(item.get("origin_name") or ""), options).strip()
            new_name = str(item.get("new_name") or "").strip()
            if not origin_name or not new_name:
                continue
            next_item = copy.deepcopy(item)
            next_item["origin_name"] = origin_name
            normalized.append(next_item)
        return normalized

    def _cleanse_column_name(self, name: str, options: set[str]) -> str:
        text = str(name or "")
        if "remove_spaces" in options:
            text = re.sub(r"[ \u3000]+", "", text)
        if "remove_newlines" in options:
            text = re.sub(r"[\r\n]+", "", text)
        if "to_halfwidth_alnum" in options:
            text = self._to_halfwidth_alnum(text)
        if "symbols_to_snake" in options:
            text = self._HALFWIDTH_SYMBOL_PATTERN.sub("_", text)
            text = re.sub(r"_+", "_", text).strip("_")
        return text

    def _exclude_japanese_columns(self, dataframe: pd.DataFrame) -> tuple[pd.DataFrame, list[str]]:
        excluded = [
            str(column)
            for column in dataframe.columns
            if self._JAPANESE_CHAR_PATTERN.search(str(column))
        ]
        if not excluded:
            return dataframe, []
        filtered = dataframe.drop(columns=excluded, errors="ignore").copy()
        return filtered, excluded

    @staticmethod
    def _to_halfwidth_alnum(text: str) -> str:
        output = []
        for char in str(text or ""):
            code = ord(char)
            if 0xFF10 <= code <= 0xFF19:
                output.append(chr(code - 0xFEE0))
            elif 0xFF21 <= code <= 0xFF3A:
                output.append(chr(code - 0xFEE0))
            elif 0xFF41 <= code <= 0xFF5A:
                output.append(chr(code - 0xFEE0))
            else:
                output.append(char)
        return "".join(output)

    @staticmethod
    def _to_float_or_none(value: Any) -> float | None:
        text = str(value or "").strip()
        if not text:
            return None
        try:
            number = float(text)
        except ValueError:
            return None
        if math.isnan(number):
            return None
        return number
