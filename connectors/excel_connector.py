import os
from datetime import datetime, date, time
from typing import Any

from openpyxl import load_workbook, Workbook

from connectors.base_connector import BaseConnector

class ExcelConnector(BaseConnector):

    def execute(self, action, params, context) -> Any:
        if action == "read_excel":
            path_val = self.normalize_file_path(params.get('file_path')) or ""
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
            return self.write_excel(
                params.get('input_data'),
                self.normalize_file_path(params.get('output_path')),
                params.get('sheet_name', 'Sheet1'),
                context)

    # --- 内部ロジック ---

    def read_excel(self, path: str, sheet_name: str, header_row: int, data_start_row: int):
            path = self.normalize_file_path(path)
            if not path or not os.path.exists(path):
                raise FileNotFoundError(f"ファイルが見つかりません: {path}")
            
            # data_only=Trueで数式ではなく値を取得
            wb = load_workbook(path, data_only=True)
            # シートの取得
            target_ws = wb[sheet_name] if sheet_name else wb.active
            
            # Pylance対策：wsがNoneでないことを厳格にチェック
            if target_ws is None:
                raise ValueError(f"シートが見つかりませんでした。")
            
            # 変数を上書きして、ここからは target_ws が絶対にある前提にする
            ws = target_ws 

            # 1. ヘッダー行の取得
            headers = [str(cell.value) if cell.value is not None else f"col_{i}" 
                    for i, cell in enumerate(ws[header_row])]
            
            data = []
            # 2. データの取得
            for row in ws.iter_rows(min_row=data_start_row, values_only=True):
                if any(row):
                    row_dict = dict(zip(headers, row))
                    
                    # --- 日付の変換処理（ここがエラーの火種でした） ---
                    for key in row_dict:
                        val = row_dict[key]
                        
                        # datetime型かdate型の場合だけ処理
                        if isinstance(val, (datetime, date)):
                            # タイムゾーンがあれば消す
                            if isinstance(val, datetime) and val.tzinfo is not None:
                                val = val.replace(tzinfo=None)
                            
                            iso_str = val.isoformat()
                            
                            # "T00:00:00" で終わるか、date型なら日付のみ(10文字)にする
                            if iso_str.endswith("T00:00:00") or not isinstance(val, datetime):
                                row_dict[key] = iso_str[:10]
                            else:
                                row_dict[key] = iso_str
                    # ----------------------------------------------
                    
                    data.append(row_dict)
            return data

    def write_excel(self, input_var, output_path, sheet_name, context, mode='create_or_replace'):
        """
        mode:
        'create_or_replace': 指定シートを「初期化」して書き込む（他のシートは維持）
        'insert_or_replace': 指定シートの「末尾に追記」して書き込む（他のシートは維持）
        """
        output_path = self.normalize_file_path(output_path)
        data = context.get(input_var)
        if not data:
            raise ValueError("データが空です")

        # 1. ワークブックの準備（ファイルが存在するかどうか）
        if os.path.exists(output_path):
            # 既存ファイルを基準にする
            wb = load_workbook(output_path)
            is_new_file = False
        else:
            # あたらしくファイルを作成
            wb = Workbook()
            is_new_file = True

        # 2. シートの準備
        is_new_sheet = False
        
        if is_new_file:
            # 新規ファイルなら最初のシートの名前を変える
            ws = wb.worksheets[0]
            ws.title = sheet_name
            is_new_sheet = True
        else:
            # 既存ファイルの場合、シートが存在するか確認
            if sheet_name in wb.sheetnames:
                if mode == 'create_or_replace':
                    # 置換：一旦消して作り直す
                    del wb[sheet_name]
                    ws = wb.create_sheet(sheet_name)
                    is_new_sheet = True
                else:
                    # 挿入：既存のシートを取得
                    ws = wb[sheet_name]
                    is_new_sheet = False
            else:
                # 既存ファイルに「あたらしくシートを作成」
                ws = wb.create_sheet(sheet_name)
                is_new_sheet = True

        # 3. データの書き込み
        headers = list(data[0].keys())

        # 新規シート、または置換モードの場合はヘッダーを書き込む
        if is_new_sheet:
            ws.append(headers)

        # データの追加
        for row in data:
            # row.get(h) で値を取り出し、appendで末尾に追加
            ws.append([row.get(h) for h in headers])

        # 4. 保存
        wb.save(output_path)
        return f"Excel保存完了 [{mode}]: {output_path} (Sheet: {sheet_name})"
