import json
import re
from typing import Any

from connectors.base_connector import BaseConnector


class OperationConnector(BaseConnector):
    VARIABLE_NAME_PATTERN = re.compile(r"^[a-zA-Z0-9_]+$")
    SYSTEM_FIXED_VARIABLES = {"current_date", "user_name"}

    def execute(self, action: str, params: dict, context: dict) -> Any:
        if action == "define_values":
            return self.define_values(
                params.get("define_values"),
                context
            )
        if action == "execute_rename":
            return self.execute_rename(
                params.get("input_var") or params.get("input_data"),
                params.get("input_var_rename") or params.get("input_data_rename"),
                context
            )
        else:
            raise ValueError(f"Unknown action: {action}")

    def _normalize_define_values(self, raw_define_values):
        if raw_define_values is None:
            return []

        parsed = raw_define_values
        if isinstance(parsed, str):
            text = parsed.strip()
            if not text:
                return []
            try:
                parsed = json.loads(text)
            except json.JSONDecodeError as error:
                raise ValueError(f"define_values は JSON 形式で指定してください: {error}") from error

        if isinstance(parsed, dict):
            parsed = [
                {"name": key, "value": value}
                for key, value in parsed.items()
            ]

        if not isinstance(parsed, list):
            raise ValueError("define_values は配列で指定してください。")

        rows = []
        for item in parsed:
            if not isinstance(item, dict):
                raise ValueError("define_values の各要素はオブジェクトで指定してください。")
            rows.append({
                "name": str(item.get("name") or item.get("key") or "").strip(),
                "value": item.get("value", item.get("val"))
            })
        return rows

    def _validate_define_values(self, rows):
        seen = set()
        for row in rows:
            name = str(row.get("name") or "").strip()
            if not name:
                continue
            if not self.VARIABLE_NAME_PATTERN.fullmatch(name):
                raise ValueError(f"変数名 '{name}' は無効です。英数字と _ のみ使用できます。")
            if name in seen:
                raise ValueError(f"同一ステップ内で変数名 '{name}' が重複しています。")
            seen.add(name)

    def define_values(self, define_values, context):
        rows = self._normalize_define_values(define_values)
        self._validate_define_values(rows)

        output_rows = []
        for row in rows:
            name = str(row.get("name") or "").strip()
            if not name:
                # 空名は「未定義」とみなし対象外
                continue
            if name in self.SYSTEM_FIXED_VARIABLES:
                fixed_value = context.get(name, row.get("value"))
                context[name] = fixed_value
                output_rows.append({"name": name, "value": fixed_value})
                continue

            value = row.get("value")
            context[name] = value
            output_rows.append({"name": name, "value": value})

        return self.to_dataframe(output_rows)

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
