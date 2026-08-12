import io
import unittest

import yaml

from app.services.yaml_document_serializer import dump_workflow_document


class WorkflowDocumentSerializerTests(unittest.TestCase):
    def test_uses_canonical_yaml_style(self):
        document = {
            "metadata": {
                "mode": "dataflow",
                "name": "Sales flow",
                "default_flow_id": "01",
                "description": "first line\nsecond line",
            },
            "steps": [{
                "step_id": "01",
                "flow_id": "01",
                "connector_id": "WindowsConnector",
                "action_id": "define_values",
                "params": {},
            }],
            "flows": {
                "01": {
                    "start": {
                        "ui_position": {"x": 80, "y": 220},
                        "variables": [],
                    },
                    "end": {
                        "ui_position": {"x": 660, "y": 220},
                    },
                    "edges": [
                        {"from": "START", "to": "01", "order": 1},
                        {"from": "01", "to": "END", "order": 1},
                    ],
                },
            },
            "loop": {"flows": {}},
            "notes": [],
        }
        output = io.StringIO()

        dump_workflow_document(document, output)

        serialized = output.getvalue()
        self.assertIn("mode: 'dataflow'", serialized)
        self.assertIn("  '01':", serialized)
        self.assertIn("description: |-", serialized)
        self.assertNotIn("params:", serialized)
        self.assertNotIn("loop:", serialized)
        self.assertNotIn("{}", serialized)
        parsed = yaml.safe_load(serialized)
        self.assertEqual(parsed["flows"]["01"]["edges"][0]["from"], "START")
        self.assertEqual(
            parsed["metadata"]["description"],
            "first line\nsecond line",
        )


if __name__ == "__main__":
    unittest.main()
