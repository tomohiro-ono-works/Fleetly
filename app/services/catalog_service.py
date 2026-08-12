from app.services.catalog_loader import CatalogLoader
from app.services.catalog_param_validator import CatalogParameterValidator
from app.services.catalog_types import (
    CatalogValidationError,
    thaw_catalog_value,
)


class CatalogService:
    def __init__(self, catalog_root=None):
        self.snapshot = CatalogLoader(catalog_root=catalog_root).load()
        self._parameter_validator = CatalogParameterValidator(self.snapshot)

    def get_connectors(self):
        return {
            "version": self.snapshot.version,
            "app_modes": thaw_catalog_value(self.snapshot.app_modes),
            "connectors": thaw_catalog_value(self.snapshot.connectors),
        }

    def get_actions(self):
        return {"actions": thaw_catalog_value(self.snapshot.actions)}

    def get_forms(self):
        return {"forms": thaw_catalog_value(self.snapshot.forms)}

    def get_data_area_policy(self):
        return {
            "policies": thaw_catalog_value(self.snapshot.data_area_policies),
            "execution_metadata_columns": list(self.snapshot.execution_metadata_columns),
        }

    def get_security_policy_summary(self):
        return {"profiles": thaw_catalog_value(self.snapshot.security_profiles)}

    def validate_action_params(self, connector_id, action_id, params):
        return self._parameter_validator.validate(connector_id, action_id, params)

    def get_action_definition(self, connector_id, action_id):
        key = (
            str(connector_id or "").strip(),
            str(action_id or "").strip(),
        )
        action = self.snapshot.action_index.get(key)
        if action is None:
            raise CatalogValidationError(
                "actions.yaml",
                f"actions.{key[0]}.{key[1]}",
                "connector／actionがcatalogに存在しません。",
            )
        return thaw_catalog_value(action)

    def get_connector_definition(self, connector_id):
        key = str(connector_id or "").strip()
        connector = self.snapshot.connector_index.get(key)
        if connector is None:
            raise CatalogValidationError(
                "connectors.yaml",
                f"connectors.{key}",
                "connectorがcatalogに存在しません。",
            )
        return thaw_catalog_value(connector)


__all__ = ["CatalogService", "CatalogValidationError"]
