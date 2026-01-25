import csv
from connectors.base_connector import BaseConnector
from typing import Any

class CSVConnector(BaseConnector):
    def get_definition(self) -> dict:
        """GUIに表示する設定画面の定義"""
        return {
            "name": "📂 ファイル操作",
            "color": "border-l-blue-500",
            "actions": {
                "read_csv": {
                    "label": "CSV読み込み (詳細設定)",
                    "fields": [
                        {"id": "file_path", "label": "CSVファイルパス", "type": "string"},
                        {"id": "encoding", "label": "文字コード", "type": "select", "options": ["utf-8", "cp932", "utf-8-sig"], "default": "utf-8"},
                        {"id": "header_row", "label": "ヘッダー行 (1開始)", "type": "number", "default": 1},
                        {"id": "data_start_row", "label": "データ開始行 (1開始)", "type": "number", "default": 2},
                        {"id": "selected_columns", "label": "取得カラム (カンマ区切り / 空なら全取得)", "type": "string"}
                    ]
                },
                "write_csv": {
                    "label": "CSV書き出し",
                    "fields": [
                        {"id": "input_data", "label": "入力変数名", "type": "string"},
                        {"id": "output_path", "label": "保存先パス", "type": "string"},
                        {"id": "encoding", "label": "文字コード", "type": "select", "options": ["utf-8-sig", "cp932"]}
                    ]
                }
            }
        }

    def execute(self, action, params, context) -> Any:
        if action == "read_csv":
            return self.read_csv(
                path=params.get('file_path'),
                encoding=params.get('encoding', 'utf-8'),
                header_row=int(params.get('header_row', 1)),
                data_start_row=int(params.get('data_start_row', 2)),
                selected_columns=params.get('selected_columns')
            )
        elif action == "write_csv":
            return self.write_csv(params.get('input_data'), params.get('output_path'), params.get('encoding', 'utf-8-sig'), context)

    # --- 内部ロジック ---
    def read_csv(self, path, encoding, header_row, data_start_row, selected_columns):
        result = []
        with open(path, 'r', encoding=encoding) as f:
            reader = csv.reader(f)
            all_rows = list(reader)
            # 1. ヘッダーの取得 (ユーザー指定行)
            if len(all_rows) < header_row:
                raise ValueError(f"指定されたヘッダー行({header_row})がファイル内に存在しません。")
            headers = all_rows[header_row - 1]
            # 2. データの取得 (ユーザー指定開始行から最後まで)
            data_rows = all_rows[data_start_row - 1:]
            # 3. カラム指定のパース
            target_cols = [c.strip() for c in selected_columns.split(',')] if selected_columns else None
            # 4. 辞書形式への変換
            for row in data_rows:
                # ヘッダーとデータを結合
                row_dict = dict(zip(headers, row))
                # 特定のカラムだけ抽出する場合
                if target_cols:
                    filtered_dict = {k: v for k, v in row_dict.items() if k in target_cols}
                    result.append(filtered_dict)
                else:
                    result.append(row_dict)
        return result

    def write_csv(self, input_var, output_path, encoding, context):
        data = context.get(input_var)
        if not data: raise ValueError("データが空です")
        with open(output_path, 'w', encoding=encoding, newline='') as f:
            writer = csv.DictWriter(f, fieldnames=data[0].keys())
            writer.writeheader()
            writer.writerows(data)
        return f"CSV保存完了: {output_path}"