import importlib
import inspect
import os
import pkgutil
import re
import threading

from connectors.base_connector import BaseConnector


class ConnectorFactory:
    def __init__(self, *, logger=None):
        self.logger = logger
        self._connector_classes = {}
        self._lock = threading.Lock()

    def create(self, connector_id):
        connector_class = self.get_class(connector_id)
        return connector_class()

    def get_class(self, connector_id):
        normalized_id = str(connector_id or "").strip()
        if not normalized_id:
            raise ValueError("コネクタ名が指定されていません。")

        with self._lock:
            connector_class = self._connector_classes.get(normalized_id)
            if connector_class:
                return connector_class

            for module_name in self._module_candidates(normalized_id):
                full_module_name = f"connectors.{module_name}"
                try:
                    module = importlib.import_module(full_module_name)
                except ModuleNotFoundError as error:
                    if error.name == full_module_name:
                        continue
                    raise
                connector_class = self._resolve_from_module(
                    module,
                    cache_keys=(normalized_id, module_name),
                )
                if connector_class:
                    self._log_loaded(normalized_id, module_name)
                    return connector_class
                raise RuntimeError(
                    f"コネクタ '{normalized_id}' は見つかりましたが、"
                    "BaseConnector実装がありません。"
                )

            connector_class, module_name = self._scan_by_class_name(
                normalized_id
            )
            if connector_class:
                self._log_loaded(normalized_id, module_name)
                return connector_class

        raise RuntimeError(f"コネクタ '{normalized_id}' が見つかりません。")

    def _module_candidates(self, connector_id):
        snake_name = self._to_snake_case(connector_id)
        candidates = []
        for name in (
            connector_id,
            snake_name,
            (
                f"{snake_name}_connector"
                if snake_name and not snake_name.endswith("_connector")
                else snake_name
            ),
        ):
            if name and name not in candidates:
                candidates.append(name)
        return candidates

    def _resolve_from_module(self, module, *, cache_keys=()):
        for _, candidate in inspect.getmembers(module, inspect.isclass):
            if candidate is BaseConnector:
                continue
            if not issubclass(candidate, BaseConnector):
                continue
            for key in cache_keys:
                if key:
                    self._connector_classes[key] = candidate
            return candidate
        return None

    def _scan_by_class_name(self, connector_id):
        import connectors

        package_path = os.path.dirname(str(connectors.__file__))
        for _, module_name, is_package in pkgutil.iter_modules([package_path]):
            if is_package or module_name == "base_connector":
                continue
            module = importlib.import_module(f"connectors.{module_name}")
            for name, candidate in inspect.getmembers(
                module,
                inspect.isclass,
            ):
                if candidate is BaseConnector:
                    continue
                if not issubclass(candidate, BaseConnector):
                    continue
                if name == connector_id:
                    self._connector_classes[connector_id] = candidate
                    self._connector_classes[module_name] = candidate
                    return candidate, module_name
        return None, None

    def _log_loaded(self, connector_id, module_name):
        if self.logger is not None:
            self.logger.info(
                "コネクタをロードしました: %s (module: %s)",
                connector_id,
                module_name,
            )

    @staticmethod
    def _to_snake_case(name):
        text = str(name or "")
        text = re.sub(r"([A-Z]+)([A-Z][a-z])", r"\1_\2", text)
        text = re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", text)
        return text.lower()
