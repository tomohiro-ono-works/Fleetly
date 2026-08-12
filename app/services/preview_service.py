import codecs
import csv
from pathlib import Path

from connectors.excel_connector import ExcelConnector


def _safe_text(value):
    return str(value or "").strip()


class PreviewService:
    PREVIEW_ROW_LIMIT = 30
    SCHEMA_ROW_LIMIT = 100

    def __init__(self, *, excel_connector_factory=None):
        self._excel_connector_factory = (
            excel_connector_factory or ExcelConnector
        )

    def read_excel(self, *, file_path, sheet_name=None):
        path = self._resolve_file(file_path)
        preview = self._excel_connector_factory().preview_excel(
            str(path),
            sheet_name=_safe_text(sheet_name),
            max_rows=self.PREVIEW_ROW_LIMIT,
        )
        return {
            "file_name": path.name,
            **preview,
        }

    def read_csv(
        self,
        *,
        file_path,
        encoding=None,
        delimiter=None,
    ):
        path = self._resolve_file(file_path)
        normalized_encoding = self._normalize_encoding(encoding)
        normalized_delimiter = self._normalize_delimiter(delimiter)
        rows = self._load_csv_rows(
            path,
            normalized_encoding,
            normalized_delimiter,
        )
        preview_rows = rows[:self.PREVIEW_ROW_LIMIT]
        col_count = max((len(row) for row in rows), default=0)
        columns = [
            self._column_letters(index)
            for index in range(col_count)
        ]
        return {
            "file_name": path.name,
            "encoding": normalized_encoding,
            "delimiter": normalized_delimiter,
            "columns": columns,
            "rows2d": [
                self._pad_row(row, col_count)
                for row in preview_rows
            ],
            "schema_rows2d": [
                self._pad_row(row, col_count)
                for row in rows
            ],
            "base_row": 0,
            "col_count": col_count,
        }

    def _resolve_file(self, value):
        text = _safe_text(value)
        if not text:
            raise ValueError("対象ファイルが選択されていません。")
        path = Path(text).resolve()
        if not path.exists() or not path.is_file():
            raise FileNotFoundError(f"ファイルが見つかりません: {path}")
        return path

    def _load_csv_rows(self, path, encoding, delimiter):
        rows = []
        with path.open(
            "r",
            encoding=encoding,
            newline="",
        ) as handle:
            reader = csv.reader(handle, delimiter=delimiter)
            for row_index, row in enumerate(reader):
                if row_index >= self.SCHEMA_ROW_LIMIT:
                    break
                rows.append([
                    cell if cell != "" else None
                    for cell in row
                ])
        return rows

    def _normalize_encoding(self, value):
        raw = _safe_text(value).lower() or "utf-8"
        aliases = {"utf8": "utf-8"}
        normalized = aliases.get(raw, raw)
        try:
            codecs.lookup(normalized)
        except LookupError as error:
            raise ValueError("encoding が不正です。") from error
        return normalized

    def _normalize_delimiter(self, value):
        raw = str(value or ",")
        if raw == "\\t" or raw.lower() == "tab":
            return "\t"
        if len(raw) != 1 or ord(raw) < 32:
            raise ValueError(
                "delimiter は表示可能な1文字またはtabで指定してください。"
            )
        return raw

    def _column_letters(self, index):
        number = int(index) + 1
        output = ""
        while number > 0:
            remainder = (number - 1) % 26
            output = chr(65 + remainder) + output
            number = (number - 1) // 26
        return output

    def _pad_row(self, row, col_count):
        return [
            row[index] if index < len(row) else None
            for index in range(col_count)
        ]
