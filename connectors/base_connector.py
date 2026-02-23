from abc import ABC, abstractmethod

class BaseConnector(ABC):
    @staticmethod
    def normalize_file_path(file_path):
        if file_path is None:
            return None
        normalized = str(file_path).replace("\\\\", "/")
        return normalized.replace("\\", "/")

    @abstractmethod
    def execute(self, action: str, params: dict, context: dict):
        pass
