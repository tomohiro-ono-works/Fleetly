from abc import ABC, abstractmethod

import pandas as pd

class BaseConnector(ABC):
    @staticmethod
    def normalize_file_path(file_path):
        if file_path is None:
            return None
        normalized = str(file_path).replace("\\\\", "/")
        return normalized.replace("\\", "/")

    @staticmethod
    def is_tabular_data(value):
        return isinstance(value, (pd.DataFrame, list, dict))

    @staticmethod
    def to_dataframe(value):
        if isinstance(value, pd.DataFrame):
            return value.copy()
        if isinstance(value, list):
            return pd.DataFrame(value)
        if isinstance(value, dict):
            return pd.DataFrame([value])
        raise TypeError(f"表データとして扱えない型です: {type(value).__name__}")

    @staticmethod
    def to_records(value):
        if isinstance(value, pd.DataFrame):
            return value.to_dict(orient="records")
        if isinstance(value, list):
            return value
        if isinstance(value, dict):
            return [value]
        raise TypeError(f"レコード配列へ変換できない型です: {type(value).__name__}")

    @abstractmethod
    def execute(self, action: str, params: dict, context: dict):
        pass
