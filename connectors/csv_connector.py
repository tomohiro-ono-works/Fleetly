import os
from typing import Any
import pandas as pd
from connectors.base_connector import BaseConnector

class CSVConnector(BaseConnector):
    
    def execute(self, action: str, params: dict[str, Any], context: dict[str, Any]) -> Any:
        if action == "read_csv":
            file_path = params.get('file_path')
            if not file_path:
                raise ValueError("file_path は必須です。")
            return self.read_csv(
                path=str(file_path),
                encoding=str(params.get('encoding', 'utf-8')),
                delimiter=str(params.get('delimiter', ',')),
                header_row=int(params.get('header_row', 1)),
                data_start_row=int(params.get('data_start_row', 2)),
                schema=params.get('schema'),
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

    def read_csv(self, path: str, encoding: str, delimiter: str, header_row: int, data_start_row: int, schema: Any = None):
        normalized_path = self.normalize_file_path(path)
        if normalized_path is None:
            raise ValueError("file_path は必須です。")
        if header_row < 1:
            raise ValueError("header_row は 1 以上で指定してください。")
        if data_start_row < header_row:
            raise ValueError("data_start_row は header_row 以上で指定してください。")

        skiprows = list(range(header_row, data_start_row - 1)) if data_start_row > header_row + 1 else None

        try:
            df = pd.read_csv(
                normalized_path,
                encoding=encoding,
                sep=self._normalize_delimiter(delimiter),
                header=header_row - 1,
                skiprows=skiprows,
                dtype=object,
            )
        except pd.errors.EmptyDataError:
            return self.attach_dataframe_schema(pd.DataFrame(), schema_override=schema)

        return self.attach_dataframe_schema(df, schema_override=schema)

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
