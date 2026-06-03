from __future__ import annotations

from typing import Any

from connectors.windows_connector import WindowsConnector


class OperationConnector(WindowsConnector):
    """
    旧 operation_connector 互換。
    変数定義は WindowsConnector.define_values を利用する。
    """

    def execute(self, action: str, params: dict[str, Any], context: dict[str, Any]):
        if action == "define_values":
            return self.define_values(params.get("define_values"), context)
        raise ValueError(f"Unknown action: {action}")
