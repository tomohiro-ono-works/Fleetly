from abc import ABC, abstractmethod

class BaseConnector(ABC):
    @abstractmethod
    def execute(self, action: str, params: dict, context: dict):
        pass