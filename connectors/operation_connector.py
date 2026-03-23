from typing import Any

from connectors.base_connector import BaseConnector


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
        rename_data = context.get(input_var_rename)
        if rename_data is None:
            raise ValueError(f"変数 '{input_var_rename}' にリネーム定義がありません。")
        rename_rows = self.to_records(rename_data)
        mapping_dict = {
            item['old_key']: item['new_key']
            for item in rename_rows
        }

        raw_data = context.get(input_var)
        if raw_data is None:
            return self.to_dataframe([])
        data_list = self.to_records(raw_data)

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

        return self.to_dataframe(result)
