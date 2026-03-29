import os
from datetime import datetime, date
from typing import Any

import pandas as pd
from openpyxl import load_workbook
from openpyxl.styles.numbers import is_date_format

from connectors.base_connector import BaseConnector

class ExcelConnector(BaseConnector):
    @staticmethod
    def _as_bool(value: Any) -> bool:
        if isinstance(value, bool):
            return value
        if isinstance(value, str):
            return value.strip().lower() in {"1", "true", "yes", "on"}
        return bool(value)

    @staticmethod
    def _normalize_excel_value(value: Any) -> Any:
        if pd.isna(value):
            return None
        if isinstance(value, datetime):
            normalized = value.replace(tzinfo=None) if value.tzinfo is not None else value
            iso_str = normalized.isoformat()
            return iso_str[:10] if iso_str.endswith("T00:00:00") else iso_str
        if isinstance(value, date):
            return value.isoformat()
        return value

    @staticmethod
    def _format_display_value(cell: Any) -> Any:
        value = cell.value
        if value is None:
            return None

        if isinstance(value, datetime):
            normalized = value.replace(tzinfo=None) if value.tzinfo is not None else value
            if is_date_format(cell.number_format):
                formatted = normalized.strftime("%Y-%m-%d %H:%M:%S")
                return formatted[:-9] if formatted.endswith(" 00:00:00") else formatted
            return normalized.isoformat()

        if isinstance(value, date):
            if is_date_format(cell.number_format):
                return value.strftime("%Y-%m-%d")
            return value.isoformat()

        if isinstance(value, (int, float)):
            number_format = str(cell.number_format or "")
            if number_format and set(number_format) <= {"0"}:
                if isinstance(value, float) and not float(value).is_integer():
                    return value
                return str(int(value)).zfill(len(number_format))
        return value

    def _read_excel_display_mode(
        self,
        normalized_path: str,
        sheet_name: str,
        header_row: int,
        data_start_row: int,
        schema: Any = None,
    ) -> pd.DataFrame:
        workbook = load_workbook(normalized_path, data_only=True)
        try:
            worksheet = workbook[sheet_name] if sheet_name else workbook.active
        except KeyError as exc:
            workbook.close()
            raise ValueError(f"シートが見つかりませんでした: {sheet_name}") from exc

        headers = [
            str(cell.value) if cell.value is not None else f"col_{index}"
            for index, cell in enumerate(worksheet[header_row])
        ]

        rows: list[dict[str, Any]] = []
        for row in worksheet.iter_rows(min_row=data_start_row):
            values = [self._format_display_value(cell) for cell in row]
            if any(value is not None and value != "" for value in values):
                rows.append(dict(zip(headers, values)))

        workbook.close()
        return self.attach_dataframe_schema(pd.DataFrame(rows), schema_override=schema)

    def _build_dataframe_from_worksheet_rows(
        self,
        rows: list[list[Any]],
        header_row: int,
        data_start_row: int,
        preserve_display: bool = False,
        schema: Any = None,
    ) -> pd.DataFrame:
        if not rows:
            return self.attach_dataframe_schema(pd.DataFrame(), schema_override=schema)
        if header_row < 1:
            raise ValueError("header_row は 1 以上で指定してください。")
        if data_start_row < header_row:
            raise ValueError("data_start_row は header_row 以上で指定してください。")
        if header_row > len(rows):
            raise ValueError("header_row が読込範囲を超えています。")
        if data_start_row > len(rows) + 1:
            raise ValueError("data_start_row が読込範囲を超えています。")

        header_cells = rows[header_row - 1]
        headers = [
            str(cell) if cell is not None and str(cell) != "" else f"col_{index}"
            for index, cell in enumerate(header_cells)
        ]

        records: list[dict[str, Any]] = []
        for raw_row in rows[data_start_row - 1:]:
            if preserve_display:
                normalized_row = raw_row
            else:
                normalized_row = [self._normalize_excel_value(value) for value in raw_row]
            if any(value is not None and value != "" for value in normalized_row):
                records.append(dict(zip(headers, normalized_row)))
        return self.attach_dataframe_schema(pd.DataFrame(records), schema_override=schema)

    def execute(self, action: str, params: dict[str, Any], context: dict[str, Any]) -> Any:
        if action == "read_excel":
            file_path = params.get('file_path')
            if not file_path:
                raise ValueError("file_path が指定されていません。")
            return self.read_excel(
                path=str(file_path),
                sheet_name=str(params.get('sheet_name', "")),
                header_row=int(params.get('header_row', 1)),
                data_start_row=int(params.get('data_start_row', 2)),
                preserve_display=self._as_bool(params.get('preserve_display', False)),
                schema=params.get('schema'),
            )
        elif action == "read_excel_range":
            file_path = params.get('file_path')
            cell_range = params.get('cell_range')
            if not file_path:
                raise ValueError("file_path が指定されていません。")
            if not cell_range:
                raise ValueError("cell_range が指定されていません。")
            return self.read_excel_range(
                path=str(file_path),
                sheet_name=str(params.get('sheet_name', "")),
                cell_range=str(cell_range),
                header_row=int(params.get('header_row', 1)),
                data_start_row=int(params.get('data_start_row', 2)),
                preserve_display=self._as_bool(params.get('preserve_display', False)),
                schema=params.get('schema'),
            )
        elif action == "write_excel":
            input_data = params.get('input_data')
            output_path = params.get('output_path')
            if not input_data:
                raise ValueError("input_data が指定されていません。")
            if not output_path:
                raise ValueError("output_path が指定されていません。")
            return self.write_excel(
                str(input_data),
                str(output_path),
                str(params.get('sheet_name', 'Sheet1')),
                context,
                str(params.get('mode', 'create_or_replace')),
            )

    # --- 内部ロジック ---

    def read_excel(
        self,
        path: str,
        sheet_name: str,
        header_row: int,
        data_start_row: int,
        preserve_display: bool = False,
        schema: Any = None,
    ) -> pd.DataFrame:
        normalized_path = self.normalize_file_path(path)
        if normalized_path is None or not os.path.exists(normalized_path):
            raise FileNotFoundError(f"ファイルが見つかりません: {normalized_path}")
        if header_row < 1:
            raise ValueError("header_row は 1 以上で指定してください。")
        if data_start_row < header_row:
            raise ValueError("data_start_row は header_row 以上で指定してください。")

        if preserve_display:
            return self._read_excel_display_mode(
                normalized_path,
                sheet_name,
                header_row,
                data_start_row,
                schema,
            )

        skiprows = list(range(header_row, data_start_row - 1)) if data_start_row > header_row + 1 else None
        target_sheet = sheet_name or 0

        try:
            df = pd.read_excel(
                normalized_path,
                sheet_name=target_sheet,
                header=header_row - 1,
                skiprows=skiprows,
                dtype=object,
                engine="openpyxl",
            )
        except ValueError as exc:
            raise ValueError(f"シートが見つかりませんでした: {sheet_name}") from exc

        if not isinstance(df, pd.DataFrame):
            raise ValueError("Excel の読み込み結果が不正です。")

        df.columns = [
            str(column) if column is not None and not pd.isna(column) else f"col_{index}"
            for index, column in enumerate(df.columns)
        ]
        normalized_df = df.apply(lambda col: col.map(self._normalize_excel_value))
        return self.attach_dataframe_schema(normalized_df, schema_override=schema)

    def read_excel_range(
        self,
        path: str,
        sheet_name: str,
        cell_range: str,
        header_row: int,
        data_start_row: int,
        preserve_display: bool = False,
        schema: Any = None,
    ) -> pd.DataFrame:
        normalized_path = self.normalize_file_path(path)
        if normalized_path is None or not os.path.exists(normalized_path):
            raise FileNotFoundError(f"ファイルが見つかりません: {normalized_path}")

        workbook = load_workbook(normalized_path, data_only=True)
        try:
            worksheet = workbook[sheet_name] if sheet_name else workbook.active
        except KeyError as exc:
            workbook.close()
            raise ValueError(f"シートが見つかりませんでした: {sheet_name}") from exc

        try:
            range_values = worksheet[cell_range]
        except ValueError as exc:
            workbook.close()
            raise ValueError(f"cell_range の指定が不正です: {cell_range}") from exc

        if not isinstance(range_values, tuple):
            range_rows = [[
                self._format_display_value(range_values) if preserve_display else range_values.value
            ]]
        else:
            range_rows = []
            for row in range_values:
                normalized_row = []
                for cell in row:
                    normalized_row.append(
                        self._format_display_value(cell) if preserve_display else cell.value
                    )
                range_rows.append(normalized_row)

        workbook.close()
        return self._build_dataframe_from_worksheet_rows(
            rows=range_rows,
            header_row=header_row,
            data_start_row=data_start_row,
            preserve_display=preserve_display,
            schema=schema,
        )

    def write_excel(self, input_var: str, output_path: str, sheet_name: str, context: dict[str, Any], mode: str = 'create_or_replace'):
        """
        mode:
        'create_or_replace': 指定シートを「初期化」して書き込む（他のシートは維持）
        'create_or_insert': 指定シートの「末尾に追記」して書き込む（他のシートは維持）
        """
        normalized_output_path = self.normalize_file_path(output_path)
        if normalized_output_path is None:
            raise ValueError("output_path が指定されていません。")
        mode = str(mode or "create_or_replace").strip()
        if mode == "insert_or_replace":
            mode = "create_or_insert"
        if mode not in {"create_or_replace", "create_or_insert"}:
            raise ValueError(f"未対応の書き込みモードです: {mode}")
        data = context.get(input_var)
        if data is None:
            raise ValueError("データが空です")
        df = self.to_dataframe(data)
        if df.empty:
            raise ValueError("データが空です")
        df_to_write = df.copy()

        if not os.path.exists(normalized_output_path):
            with pd.ExcelWriter(normalized_output_path, engine="openpyxl", mode="w") as writer:
                df_to_write.to_excel(writer, sheet_name=sheet_name, index=False)
            return f"Excel保存完了 [{mode}]: {normalized_output_path} (Sheet: {sheet_name})"

        if mode == 'create_or_replace':
            with pd.ExcelWriter(
                normalized_output_path,
                engine="openpyxl",
                mode="a",
                if_sheet_exists="replace",
            ) as writer:
                df_to_write.to_excel(writer, sheet_name=sheet_name, index=False)
            return f"Excel保存完了 [{mode}]: {normalized_output_path} (Sheet: {sheet_name})"

        workbook = load_workbook(normalized_output_path)
        try:
            if sheet_name in workbook.sheetnames:
                start_row = workbook[sheet_name].max_row
                write_header = False
            else:
                start_row = 0
                write_header = True
        finally:
            workbook.close()

        with pd.ExcelWriter(
            normalized_output_path,
            engine="openpyxl",
            mode="a",
            if_sheet_exists="overlay",
        ) as writer:
            df_to_write.to_excel(
                writer,
                sheet_name=sheet_name,
                index=False,
                header=write_header,
                startrow=start_row,
            )

        return f"Excel保存完了 [{mode}]: {normalized_output_path} (Sheet: {sheet_name})"
