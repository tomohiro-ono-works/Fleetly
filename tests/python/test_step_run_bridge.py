import logging
import unittest

import pandas as pd

from connectors.base_connector import BaseConnector
from core.workflow_engine import WorkflowEngine


class _DummyConnector(BaseConnector):
    def execute(self, action, params, context):
        if action != "consume_input":
            raise ValueError(f"unsupported action: {action}")
        input_ref = str((params or {}).get("input_data") or "").strip()
        if input_ref not in context:
            raise ValueError(f"missing context: {input_ref}")
        df = self.to_dataframe(context[input_ref])
        output = df.copy()
        output["consumed"] = True
        return output


class _DummyConnectorFactory:
    def create(self, connector_id):
        if connector_id != "DummyConnector":
            raise RuntimeError(f"unexpected connector: {connector_id}")
        return _DummyConnector()


class StepRunBridgeTests(unittest.TestCase):
    def test_run_flow_from_config_can_execute_only_requested_step_with_seed_context(self):
        engine = WorkflowEngine(logging.getLogger("ziz.test.step_run"))
        engine.connector_factory = _DummyConnectorFactory()

        config = {
            "metadata": {"name": "単体実行テスト"},
            "variables": {},
            "steps": [
                {
                    "step_id": "step1",
                    "connector": "MissingConnector",
                    "action": "noop",
                    "params": {},
                    "output_variable": "step1",
                },
                {
                    "step_id": "step2",
                    "connector": "DummyConnector",
                    "action": "consume_input",
                    "params": {"input_data": "{{step1}}"},
                    "output_variable": "step2",
                },
            ],
            "flows": {},
        }
        seed_df = pd.DataFrame([{"name": "Alice"}])

        report = engine.run_flow_from_config(
            config,
            flow_path="<gui>",
            initial_context={"step1": seed_df},
            only_step_id="step2",
        )

        self.assertEqual(report["status"], "success")
        self.assertEqual(len(report["steps"]), 1)
        self.assertEqual(report["steps"][0]["step_id"], "step2")
        self.assertIsNone(report["steps"][0]["result"])
        ui_cache = report["steps"][0].get("ui_cache") or {}
        self.assertEqual(ui_cache["preview"]["rows"][0][0], "Alice")

        result_df = engine.context["step2"]
        self.assertEqual(result_df.iloc[0]["name"], "Alice")
        self.assertTrue(bool(result_df.iloc[0]["consumed"]))


if __name__ == "__main__":
    unittest.main()
