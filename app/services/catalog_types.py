import copy
from dataclasses import dataclass
from types import MappingProxyType


class CatalogValidationError(ValueError):
    def __init__(self, source, field_path, message):
        self.source = str(source)
        self.field_path = str(field_path)
        self.reason = str(message)
        super().__init__(f"{self.source}: {self.field_path}: {self.reason}")


def freeze_catalog_value(value):
    if isinstance(value, dict):
        return MappingProxyType({
            key: freeze_catalog_value(item)
            for key, item in value.items()
        })
    if isinstance(value, list):
        return tuple(freeze_catalog_value(item) for item in value)
    return value


def thaw_catalog_value(value):
    if isinstance(value, MappingProxyType):
        return {
            key: thaw_catalog_value(item)
            for key, item in value.items()
        }
    if isinstance(value, tuple):
        return [thaw_catalog_value(item) for item in value]
    return copy.deepcopy(value)


@dataclass(frozen=True)
class CatalogSnapshot:
    version: int
    app_modes: tuple
    connectors: tuple
    actions: tuple
    forms: tuple
    data_area_policies: tuple
    execution_metadata_columns: tuple
    security_profiles: tuple
    connector_index: MappingProxyType
    action_index: MappingProxyType
    form_index: MappingProxyType
    data_area_policy_index: MappingProxyType
    security_profile_index: MappingProxyType
