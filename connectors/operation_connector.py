import subprocess
import os
from connectors.base_connector import BaseConnector
from typing import Any


class OperationConnector(BaseConnector):
    def execute(self, action: str, params: dict, context: dict) -> Any:
        if action == "execute_rename":
            return self.execute_rename(
                params.get("input_var"),
                params.get("input_var_rename"),
                context
            )
        else:
            raise ValueError(f"Unknown action: {action}")

    def execute_rename(self,input_var, input_var_rename, context):
        """
        input_var_rename (辞書配列) を 辞書に変換してから
        context内のデータをリネームする関数
        """
        # 1. マッピング辞書の作成（ここは前と同じ）
        mapping_dict = {
            item['old_key']: item['new_key'] 
            for item in context.get(input_var_rename)
        }
        
        # 2. contextからデータを取得
        raw_data = context.get(input_var)
        
        # 【重要】もしraw_dataが辞書単体ならリストに包む
        if isinstance(raw_data, dict):
            data_list = [raw_data]
        elif isinstance(raw_data, list):
            data_list = raw_data
        else:
            # 想定外の型（文字列など）なら空リストにする
            data_list = []

        # 3. リネーム処理（rowが辞書であることを確認しながら実行）
        result = []
        for row in data_list:
            if isinstance(row, dict):
                # 辞書の場合のみリネームを実行
                new_row = {mapping_dict.get(k, k): v for k, v in row.items()}
                result.append(new_row)
            else:
                # 辞書じゃないデータ（文字列など）が混じっていたらそのまま入れる
                result.append(row)
        
        return result