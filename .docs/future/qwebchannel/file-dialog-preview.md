# 202607 file dialog / preview Bridge Command Schema

## 対象

file dialog、Excel/CSV preview を扱う。

file dialog は host 依存操作であり、外部ブラウザでは capability によって無効化できる。

## command `file.pickFile`

Request:

```json
{
  "doc_session_id": "docsession_...",
  "title": "ファイルを選択",
  "filters": [
    {
      "label": "Excel",
      "patterns": ["*.xlsx", "*.xls"]
    }
  ],
  "current_ref": "{{hidden.step.file_path_1}}",
  "current_value": "",
  "step_name": "load_excel",
  "field_key": "file_path"
}
```

Response `data`:

```json
{
  "selected": true,
  "ref": "{{hidden.load_excel.file_path_1}}",
  "display_name": "input.xlsx",
  "display_hint": "C:/.../input.xlsx"
}
```

キャンセル時は `{ "selected": false }` を返す。

## command `file.pickFolder`

Request:

```json
{
  "doc_session_id": "docsession_...",
  "title": "フォルダを選択",
  "current_ref": "{{hidden.step.folder_path_1}}",
  "current_value": "",
  "step_name": "export_csv",
  "field_key": "folder_path"
}
```

Response `data`:

```json
{
  "selected": true,
  "ref": "{{hidden.export_csv.folder_path_1}}",
  "display_name": "output",
  "display_hint": "C:/.../output"
}
```

## command `preview.readExcel`

Request:

```json
{
  "doc_session_id": "docsession_...",
  "field_key": "file_path",
  "current_ref": "{{hidden.load_excel.file_path_1}}",
  "current_value": "",
  "sheet_name": "Sheet1"
}
```

Response `data`:

```json
{
  "ref": "{{hidden.load_excel.file_path_1}}",
  "display_name": "input.xlsx",
  "display_hint": "C:/.../input.xlsx",
  "file_name": "input.xlsx",
  "sheets": ["Sheet1"],
  "sheet_name": "Sheet1",
  "columns": ["A", "B"],
  "rows2d": [["id", "name"], ["1", "Alice"]],
  "schema_rows2d": [["id", "name"], ["1", "Alice"]],
  "base_row": 0,
  "col_count": 2
}
```

## command `preview.readCsv`

Request:

```json
{
  "doc_session_id": "docsession_...",
  "field_key": "file_path",
  "current_ref": "{{hidden.load_csv.file_path_1}}",
  "current_value": "",
  "encoding": "utf-8",
  "delimiter": ","
}
```

Response `data`:

```json
{
  "ref": "{{hidden.load_csv.file_path_1}}",
  "display_name": "input.csv",
  "display_hint": "C:/.../input.csv",
  "file_name": "input.csv",
  "encoding": "utf-8",
  "delimiter": ",",
  "columns": ["A", "B"],
  "rows2d": [["id", "name"], ["1", "Alice"]],
  "schema_rows2d": [["id", "name"], ["1", "Alice"]],
  "base_row": 0,
  "col_count": 2
}
```
