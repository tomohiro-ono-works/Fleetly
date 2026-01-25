import os
from openpyxl import load_workbook, Workbook
from connectors.base_connector import BaseConnector
from typing import Any

class ExcelConnector(BaseConnector):
    def get_definition(self) -> dict:
        """GUIに表示する設定画面の定義"""
        return {
            "name": "📂 ファイル操作",
            "color": "border-l-blue-500",
            "actions": {
                "read_excel": {
                    "label": "Excel読み込み (詳細設定)",
                    "fields": [
                        {"id": "file_path", "label": "Excelファイルパス", "type": "string"},
                        {"id": "sheet_name", "label": "シート名 (空なら左端)", "type": "string"},
                        {"id": "header_row", "label": "ヘッダー行 (1開始)", "type": "number", "default": 1},
                        {"id": "data_start_row", "label": "データ開始行 (1開始)", "type": "number", "default": 2}
                    ]
                },
                "write_excel": {
                    "label": "Excel書き出し",
                    "fields": [
                        {"id": "input_data", "label": "入力変数名", "type": "string"},
                        {"id": "output_path", "label": "保存先パス(.xlsx)", "type": "string"},
                        {"id": "sheet_name", "label": "シート名", "type": "string", "default": "Sheet1"}
                    ]
                }
            }
        }

    def execute(self, action, params, context) -> Any:
        if action == "read_excel":
            path_val = str(params.get('file_path', ""))
            sheet_val = str(params.get('sheet_name', ""))
            # 必須チェック（パスが空ならここでエラーにする）
            if not path_val:
                raise ValueError("file_path が指定されていません。")
            return self.read_excel(
                path=path_val,
                sheet_name=sheet_val,
                header_row=int(params.get('header_row', 1)),
                data_start_row=int(params.get('data_start_row', 2))
            )
        elif action == "write_excel":
            return self.write_excel(params.get('input_data'), params.get('output_path'), params.get('sheet_name', 'Sheet1'), context)

    # --- 内部ロジック ---

    def read_excel(self, path: str, sheet_name: str, header_row: int, data_start_row: int):
        if not path or not os.path.exists(path):
            raise FileNotFoundError(f"ファイルが見つかりません: {path}")
        wb = load_workbook(path, data_only=True)
        ws = wb[sheet_name] if sheet_name else wb.active
        if ws is None:
            raise ValueError(f"シートが見つかりませんでした: {sheet_name}")
        # 1. ヘッダー行の取得 (指定された header_row 行目のセルの値をリスト化)
        # openpyxlの iter_rows は 1-indexed (1から始まる)
        headers = []
        for cell in ws[header_row]:
            headers.append(cell.value)
        # 2. データの取得 (指定された data_start_row から最後まで読み取り)
        data = []
        # min_row で開始行を指定
        for row in ws.iter_rows(min_row=data_start_row, values_only=True):
            # ヘッダーと値を結びつけて辞書形式にする
            # (値がすべて空の行はスキップする処理を入れるとより綺麗です)
            if any(row): 
                data.append(dict(zip(headers, row)))
        return data

    def write_excel(self, input_var, output_path, sheet_name, context):
        data = context.get(input_var)
        if not data: raise ValueError("データが空です")
        wb = Workbook()
        ws = wb.active
        if ws is None:
            ws = wb.create_sheet(sheet_name)
        else:
            ws.title = sheet_name
        headers = list(data[0].keys())
        ws.append(headers)
        for row in data:
            ws.append([row.get(h) for h in headers])
        wb.save(output_path)
        return f"Excel保存完了: {output_path}"