import pandas as pd

from connectors.base_connector import BaseConnector


class DummyConnector(BaseConnector):
    def execute(self, action: str, params: dict, context: dict):
        if action != "show_connector_icon":
            raise ValueError(f"未対応のアクションです: {action}")

        selected_icon = str(params.get("selected_connector_icon") or "").strip()
        self.log_execution(f"ダミーコネクタを実行しました: icon={selected_icon or '-'}")

        return pd.DataFrame([
            {
                "connector": "DummyConnector",
                "action": action,
                "selected_connector_icon": selected_icon,
            }
        ])
