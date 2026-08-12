import json
import shutil
import tempfile
import unittest
from pathlib import Path

import yaml

from app.gui.bridge import BridgeRuntime
from app.services.catalog_service import CatalogService, CatalogValidationError


CATALOG_ROOT = Path(__file__).resolve().parents[2] / "config" / "catalog"


def _command(message_type):
    return json.dumps({
        "v": "1",
        "kind": "cmd",
        "id": "catalog_test",
        "type": message_type,
        "ts": "2026-07-29T00:00:00Z",
        "payload": {},
    })


class CatalogServiceTests(unittest.TestCase):
    def test_loads_complete_immutable_catalog(self):
        service = CatalogService(CATALOG_ROOT)

        self.assertEqual(len(service.get_connectors()["connectors"]), 12)
        self.assertEqual(len(service.get_actions()["actions"]), 39)
        self.assertEqual(len(service.get_forms()["forms"]), 39)
        self.assertEqual(
            service.get_data_area_policy()["execution_metadata_columns"],
            ["job_id", "target", "path", "executed_at"],
        )
        with self.assertRaises(TypeError):
            service.snapshot.action_index[("BQConnector", "execute_sql")] = {}

    def test_validates_alias_required_unknown_and_option_parameters(self):
        service = CatalogService(CATALOG_ROOT)

        action = service.validate_action_params(
            "csv_connector",
            "read_csv",
            {"file_path": "input.csv"},
        )
        self.assertEqual(action["connector_id"], "CSVConnector")
        service.validate_action_params(
            "bigquery_connector",
            "load_data",
            {"input_data": "{{step1}}", "schema": "[]"},
        )

        with self.assertRaisesRegex(ValueError, "未定義"):
            service.validate_action_params(
                "CSVConnector",
                "read_csv",
                {"file_path": "input.csv", "unknown": True},
            )
        with self.assertRaisesRegex(ValueError, "必須"):
            service.validate_action_params(
                "WindowsConnector",
                "create_markdown_file",
                {"write_mode": "replace"},
            )
        with self.assertRaisesRegex(ValueError, r"\.x は必須"):
            service.validate_action_params(
                "WindowsConnector",
                "mouse_click",
                {},
            )
        with self.assertRaisesRegex(ValueError, "option"):
            service.validate_action_params(
                "SeleniumConnector",
                "navigate",
                {"url": "https://example.com", "tab_mode": "invalid"},
            )
        with self.assertRaisesRegex(ValueError, "env_path"):
            service.validate_action_params(
                "PythonConnector",
                "execute_python",
                {"script": "def main():\n    return None", "env_path": "other"},
            )

    def test_standalone_document_binding_and_export_modes_are_catalog_data(self):
        service = CatalogService(CATALOG_ROOT)

        inline_action = service.get_action_definition(
            "BQConnector",
            "execute_sql",
        )
        file_action = service.get_action_definition(
            "DuckConnector",
            "execute_sql_file",
        )
        export_action = service.get_action_definition(
            "ExcelConnector",
            "write_excel",
        )

        self.assertEqual(inline_action["standalone_document"], {
            "extensions": ["sql"],
            "source_kind": "editor_content",
            "source_param": "sql",
        })
        self.assertEqual(
            file_action["standalone_document"]["source_kind"],
            "saved_file",
        )
        self.assertEqual(export_action["standalone_export_modes"], ["excel"])

    def test_rejects_unknown_standalone_source_parameter(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            copied_root = Path(temp_dir) / "catalog"
            shutil.copytree(CATALOG_ROOT, copied_root)
            actions_path = copied_root / "actions.yaml"
            actions = yaml.safe_load(actions_path.read_text(encoding="utf-8"))
            actions["actions"][0]["standalone_document"][
                "source_param"
            ] = "missing_source"
            actions_path.write_text(
                yaml.safe_dump(
                    actions,
                    allow_unicode=True,
                    sort_keys=False,
                ),
                encoding="utf-8",
            )

            with self.assertRaisesRegex(
                CatalogValidationError,
                "参照先parameter",
            ):
                CatalogService(copied_root)

    def test_rejects_broken_reference_and_secret_default(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            copied_root = Path(temp_dir) / "catalog"
            shutil.copytree(CATALOG_ROOT, copied_root)

            actions_path = copied_root / "actions.yaml"
            actions = yaml.safe_load(actions_path.read_text(encoding="utf-8"))
            actions["actions"][0]["form_schema_id"] = "missing.form"
            actions_path.write_text(
                yaml.safe_dump(actions, allow_unicode=True, sort_keys=False),
                encoding="utf-8",
            )
            with self.assertRaisesRegex(CatalogValidationError, "form schema"):
                CatalogService(copied_root)

            shutil.rmtree(copied_root)
            shutil.copytree(CATALOG_ROOT, copied_root)
            form_path = copied_root / "forms" / "BQConnector.yaml"
            forms = yaml.safe_load(form_path.read_text(encoding="utf-8"))
            forms["forms"][0]["fields"].append({
                "key": "access_token",
                "label": "Token",
                "kind": "secret",
                "default": "do-not-store",
            })
            form_path.write_text(
                yaml.safe_dump(forms, allow_unicode=True, sort_keys=False),
                encoding="utf-8",
            )
            with self.assertRaisesRegex(CatalogValidationError, "secret field"):
                CatalogService(copied_root)


class CatalogBridgeIntegrationTests(unittest.TestCase):
    def test_catalog_commands_use_common_envelope(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            runtime = BridgeRuntime(base_dir=Path(temp_dir), catalog_root=CATALOG_ROOT)
            expected_keys = {
                "catalog.getConnectors": "connectors",
                "catalog.getActions": "actions",
                "catalog.getForms": "forms",
                "catalog.getDataAreaPolicy": "policies",
                "catalog.getSecurityPolicySummary": "profiles",
            }
            for command_type, data_key in expected_keys.items():
                response = runtime.handle_message(_command(command_type))
                self.assertTrue(response["ok"])
                self.assertEqual(response["kind"], "res")
                self.assertEqual(response["id"], "catalog_test")
                self.assertIn(data_key, response["data"])


if __name__ == "__main__":
    unittest.main()
