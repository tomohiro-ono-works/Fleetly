import os
from typing import Any
import pandas as pd
from connectors.base_connector import BaseConnector

class CSVConnector(BaseConnector):
    def _resolve_usecols_from_schema_origin(self, schema: Any):
        if schema is None or str(schema).strip() == "":
            return None
        items = self.parse_schema_definition(schema)
        if not isinstance(items, list):
            return None
        usecols = []
        for item in items:
            if not isinstance(item, dict):
                continue
            origin_name = str(item.get("origin_name") or "").strip()
            if origin_name and origin_name not in usecols:
                usecols.append(origin_name)
        return usecols or None

    def _resolve_input_path(self, file_path: str, context: dict[str, Any]) -> str:
        normalized = self.normalize_file_path(file_path)
        if not normalized:
            return ""
        if os.path.isabs(normalized):
            return normalized

        bases = []
        workspace_root = str((context or {}).get("__workspace_root") or "").strip()
        flow_dir = str((context or {}).get("__flow_dir") or "").strip()
        if workspace_root:
            bases.append(workspace_root)
        if flow_dir:
            bases.append(flow_dir)
        bases.append(os.getcwd())

        for base in bases:
            candidate = os.path.normpath(os.path.join(base, normalized))
            if os.path.exists(candidate):
                return candidate.replace("\\", "/")
        return normalized
    
    def execute(self, action: str, params: dict[str, Any], context: dict[str, Any]) -> Any:
        if action == "read_csv":
            file_path = params.get('file_path')
            if not file_path:
                raise ValueError("file_path は必須です。")
            resolved_input_path = self._resolve_input_path(str(file_path), context or {})
            return self.read_csv(
                path=resolved_input_path,
                encoding=str(params.get('encoding', 'utf-8')),
                delimiter=str(params.get('delimiter', ',')),
                header_row=int(params.get('header_row', 1)),
                data_start_row=int(params.get('data_start_row', 2)),
                schema=params.get('schema'),
                date_cleansing=self._to_bool_flag(params.get("date_cleansing", True)),
            )
        elif action == "write_csv":
            input_data = params.get('input_data')
            output_path = self._resolve_output_path(params)
            if not input_data:
                raise ValueError("input_data は必須です。")
            if not output_path:
                raise ValueError("output_path は必須です。")
            return self.write_csv(
                str(input_data),
                str(output_path), 
                str(params.get('encoding', 'utf-8-sig')),
                str(params.get('delimiter', ',')),
                context,
                params.get('schema'),
            )

    def _resolve_output_path(self, params: dict[str, Any]) -> str | None:
        explicit = params.get("output_path")
        if explicit:
            return str(explicit)

        output_folder = str(params.get("output_folder") or "").strip()
        file_name = str(params.get("file_name") or "").strip()
        if not output_folder or not file_name:
            return None

        if not os.path.splitext(file_name)[1]:
            file_name = f"{file_name}.csv"
        return os.path.join(output_folder, file_name)

    # --- 内部ロジック ---
    def _normalize_delimiter(self, delimiter: str) -> str:
        raw = str(delimiter or ",")
        if raw in ("\\t", "tab", "TAB"):
            return "\t"
        return raw

    def read_csv(
        self,
        path: str,
        encoding: str,
        delimiter: str,
        header_row: int,
        data_start_row: int,
        schema: Any = None,
        date_cleansing: bool = True,
    ):
        normalized_path = self.normalize_file_path(path)
        if normalized_path is None:
            raise ValueError("file_path は必須です。")
        if header_row < 1:
            raise ValueError("header_row は 1 以上で指定してください。")
        if data_start_row < header_row:
            raise ValueError("data_start_row は header_row 以上で指定してください。")

        skiprows = list(range(header_row, data_start_row - 1)) if data_start_row > header_row + 1 else None
        usecols = self._resolve_usecols_from_schema_origin(schema)

        try:
            df = pd.read_csv(
                normalized_path,
                encoding=encoding,
                sep=self._normalize_delimiter(delimiter),
                header=header_row - 1,
                skiprows=skiprows,
                dtype=object,
                usecols=usecols,
            )
        except pd.errors.EmptyDataError:
            result = self.attach_dataframe_schema(
                pd.DataFrame(),
                schema_override=schema,
                date_serial_system="excel_1900",
                date_cleansing=date_cleansing,
            )
            self.log_date_parse_metrics(result)
            return result
        except ValueError as exc:
            if usecols:
                missing = ", ".join(usecols)
                raise ValueError(f"schema適用エラー(列存在チェック): 指定列が存在しません [{missing}]") from exc
            raise

        result = self.attach_dataframe_schema(
            df,
            schema_override=schema,
            date_serial_system="excel_1900",
            date_cleansing=date_cleansing,
        )
        self.log_date_parse_metrics(result)
        return result

    def write_csv(self, input_var: str, output_path: str, encoding: str, delimiter: str, context: dict[str, Any], schema: Any = None):
        normalized_output_path = self.normalize_file_path(output_path)
        if normalized_output_path is None:
            raise ValueError("output_path は必須です。")
        data = context.get(input_var)
        if data is None:
            raise ValueError("データが空です")
        df = self.to_dataframe(data)
        if df.empty:
            raise ValueError("データが空です")
        if schema is not None and str(schema).strip() != "":
            schema_items = self.parse_schema_definition(schema)
            df = self.apply_schema_to_dataframe(df, schema_items)
        df.to_csv(normalized_output_path, index=False, encoding=encoding, sep=self._normalize_delimiter(delimiter))
        return f"CSV保存完了: {normalized_output_path}"
